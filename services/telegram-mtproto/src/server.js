import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import express from "express";
import multer from "multer";
import { TelegramClient, Api } from "teleproto";
import { StringSession } from "teleproto/sessions";

const app = express();
const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "8788", 10);
const apiId = Number.parseInt(process.env.TG_API_ID || "", 10);
const apiHash = process.env.TG_API_HASH || "";
const sessionString = process.env.TG_SESSION_STRING || "";
const apiToken = process.env.TUBA_API_TOKEN || "";
const tempDir = process.env.TUBA_TEMP_DIR || path.join(os.tmpdir(), "tuba-uploads");
const allowedOrigins = new Set(
  (process.env.TUBA_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash || !sessionString || !apiToken) {
  throw new Error("TG_API_ID, TG_API_HASH, TG_SESSION_STRING and TUBA_API_TOKEN are required.");
}
if (apiToken.length < 32) {
  throw new Error("TUBA_API_TOKEN must be at least 32 characters; use a long random secret.");
}

await fs.promises.mkdir(tempDir, { recursive: true, mode: 0o700 });

const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
  connectionRetries: 5,
});
await client.connect();
const me = await client.getMe();
const accountMaxBytes = me?.premium ? 4_000_000_000 : 2_000_000_000;
console.log(
  `Tuba MTProto connected; account tier: ${me?.premium ? "Premium" : "standard"}; per-file cap: ${accountMaxBytes} bytes.`,
);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, tempDir),
  filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`),
});
const upload = multer({
  storage,
  limits: { fileSize: accountMaxBytes, files: 1 },
});

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const sameOrigin = origin && origin === `${forwardedProto || req.protocol}://${req.headers.host}`;
  if (origin) {
    if (!sameOrigin && !allowedOrigins.has(origin)) {
      return sendError(res, 403, "Origin is not allowed.");
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

function requireToken(req, res, next) {
  const header = req.headers.authorization || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !constantTimeEqual(supplied, apiToken)) {
    return sendError(res, 401, "Authentication required.");
  }
  next();
}

function safeFileName(value) {
  const normalized = path.basename(String(value || "file")).replace(/[\\\r\n"]/g, "_");
  return normalized.slice(0, 240) || "file";
}

async function dialogs() {
  return client.getDialogs({ limit: 500 });
}

async function resolveFolder(folderId = "me") {
  if (folderId === "me" || folderId === "" || folderId === null) return "me";
  const wanted = String(folderId);
  const found = (await dialogs()).find((dialog) => {
    const entity = dialog.entity;
    return entity?.className === "Channel" && String(entity.id) === wanted;
  });
  if (!found) throw Object.assign(new Error("Folder not found."), { status: 404 });
  return found.entity;
}

function folderSummary(entity) {
  return {
    id: String(entity.id),
    name: entity.title || "Telegram channel",
    username: entity.username || null,
    isPublic: Boolean(entity.username),
    kind: "channel",
  };
}

function documentFileName(message) {
  const attrs = message?.media?.document?.attributes || [];
  const filename = attrs.find((attr) => attr.className === "DocumentAttributeFilename");
  return filename?.fileName || `telegram-${message?.id ?? "file"}`;
}

function fileSummary(message, folderId) {
  const document = message?.media?.document;
  const photo = message?.media?.photo;
  if (!document && !photo) return null;
  return {
    id: String(message.id),
    folderId: String(folderId),
    name: document ? documentFileName(message) : `photo-${message.id}.jpg`,
    mimeType: document?.mimeType || (photo ? "image/jpeg" : "application/octet-stream"),
    size: Number(document?.size || 0),
    date: message.date ? new Date(message.date * 1000).toISOString() : null,
    caption: message.message || "",
    kind: document ? "document" : "photo",
  };
}

async function findMessage(folderId, messageId) {
  const entity = await resolveFolder(folderId);
  const id = Number.parseInt(String(messageId), 10);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw Object.assign(new Error("Invalid file ID."), { status: 400 });
  }
  const messages = await client.getMessages(entity, { ids: [id] });
  const message = messages?.[0];
  if (!message || message.className === "MessageEmpty" || (!message.media?.document && !message.media?.photo)) {
    throw Object.assign(new Error("File not found."), { status: 404 });
  }
  return { entity, message };
}

async function downloadToTemp(message) {
  const tempPath = path.join(tempDir, `${crypto.randomUUID()}.download`);
  await client.downloadMedia(message, { outputFile: tempPath });
  return tempPath;
}

app.use(express.static(path.join(serviceDir, "public"), { index: "index.html" }));

app.get("/api/v1/health", (_req, res) => {
  res.json({
    ok: true,
    storage: "telegram-mtproto",
    accountTier: me?.premium ? "premium" : "standard",
    maxFileBytes: accountMaxBytes,
  });
});

app.use("/api/v1", requireToken);

app.get("/api/v1/folders", async (_req, res, next) => {
  try {
    const entries = await dialogs();
    const folders = entries
      .map((dialog) => dialog.entity)
      .filter((entity) => entity?.className === "Channel" && entity.broadcast)
      .map(folderSummary);
    res.json([{ id: "me", name: "Saved Messages", kind: "saved-messages" }, ...folders]);
  } catch (error) {
    next(error);
  }
});

app.post("/api/v1/folders", express.json({ limit: "16kb" }), async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name || name.length > 100) return sendError(res, 400, "Folder name must be 1–100 characters.");
    const result = await client.invoke(new Api.channels.CreateChannel({
      title: name,
      about: "Tuba file folder",
      broadcast: true,
      megagroup: false,
    }));
    const entity = result.chats?.find((chat) => chat.className === "Channel");
    if (!entity) return sendError(res, 502, "Telegram did not return the created channel.");
    res.status(201).json(folderSummary(entity));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/v1/folders/:id", express.json({ limit: "16kb" }), async (req, res, next) => {
  try {
    const folderId = String(req.params.id);
    if (folderId === "me") return sendError(res, 400, "Saved Messages cannot be renamed.");
    const name = String(req.body?.name || "").trim();
    if (!name || name.length > 100) return sendError(res, 400, "Folder name must be 1–100 characters.");
    const entity = await resolveFolder(folderId);
    await client.invoke(new Api.channels.EditTitle({ channel: await client.getInputEntity(entity), title: name }));
    res.json({ ...folderSummary(entity), name });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/v1/folders/:id", async (req, res, next) => {
  try {
    const folderId = String(req.params.id);
    if (folderId === "me") return sendError(res, 400, "Saved Messages cannot be deleted.");
    const entity = await resolveFolder(folderId);
    const recent = await client.getMessages(entity, { limit: 1 });
    if (recent.length > 0) {
      return sendError(res, 409, "Folder is not empty. Move or delete its files before deleting the folder.");
    }
    await client.invoke(new Api.channels.DeleteChannel({ channel: await client.getInputEntity(entity) }));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/files", async (req, res, next) => {
  try {
    const folderId = String(req.query.folderId || "me");
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || "100"), 10) || 100, 1), 200);
    const offsetId = Math.max(Number.parseInt(String(req.query.offsetId || "0"), 10) || 0, 0);
    const entity = await resolveFolder(folderId);
    const messages = await client.getMessages(entity, { limit, ...(offsetId ? { offsetId } : {}) });
    const files = messages.map((message) => fileSummary(message, folderId)).filter(Boolean);
    res.json({ files, nextOffsetId: messages.length ? String(messages[messages.length - 1].id) : null });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/search", async (req, res, next) => {
  try {
    const query = String(req.query.q || "").trim().toLocaleLowerCase();
    if (query.length < 2) return sendError(res, 400, "Search query must contain at least 2 characters.");
    const requestedFolder = req.query.folderId ? String(req.query.folderId) : null;
    let complete = true;
    let targets;
    if (requestedFolder) {
      targets = [{ id: requestedFolder, entity: await resolveFolder(requestedFolder) }];
    } else {
      const channels = (await dialogs())
        .map((dialog) => dialog.entity)
        .filter((entity) => entity?.className === "Channel" && entity.broadcast);
      complete = channels.length <= 50;
      targets = [
        { id: "me", entity: "me" },
        ...channels.slice(0, 50).map((entity) => ({ id: String(entity.id), entity })),
      ];
    }
    const matches = [];
    for (const target of targets) {
      const messages = await client.getMessages(target.entity, { limit: 200, search: query });
      for (const message of messages) {
        const file = fileSummary(message, target.id);
        if (file && `${file.name} ${file.caption}`.toLocaleLowerCase().includes(query)) {
          matches.push(file);
        }
      }
    }
    res.json({ files: matches.slice(0, 200), complete });
  } catch (error) {
    next(error);
  }
});

app.post("/api/v1/files", upload.single("file"), async (req, res, next) => {
  const tempPath = req.file?.path;
  try {
    if (!req.file) return sendError(res, 400, "Select a file to upload.");
    if (req.file.size > accountMaxBytes) return sendError(res, 413, `File exceeds this account's ${accountMaxBytes}-byte Telegram limit.`);
    const folderId = String(req.body?.folderId || "me");
    const entity = await resolveFolder(folderId);
    const originalName = safeFileName(req.file.originalname);
    const sent = await client.sendFile(entity, {
      file: req.file.path,
      fileName: originalName,
      forceDocument: true,
      caption: String(req.body?.caption || "").slice(0, 1024),
      workers: 1,
    });
    const message = Array.isArray(sent) ? sent[0] : sent;
    res.status(201).json({ file: fileSummary(message, folderId), maxFileBytes: accountMaxBytes });
  } catch (error) {
    next(error);
  } finally {
    if (tempPath) await fs.promises.unlink(tempPath).catch(() => {});
  }
});

app.patch("/api/v1/files/:id", express.json({ limit: "16kb" }), async (req, res, next) => {
  let tempPath;
  try {
    const folderId = String(req.query.folderId || "me");
    const newName = safeFileName(req.body?.name);
    if (!req.body?.name || !newName || newName.length > 240) {
      return sendError(res, 400, "A valid new file name is required.");
    }
    const { entity, message } = await findMessage(folderId, req.params.id);
    tempPath = await downloadToTemp(message);
    const sent = await client.sendFile(entity, {
      file: tempPath,
      fileName: newName,
      forceDocument: true,
      caption: message.message || "",
      workers: 1,
    });
    const renamed = Array.isArray(sent) ? sent[0] : sent;
    await client.deleteMessages(entity, [message.id], { revoke: true });
    res.json({ file: fileSummary(renamed, folderId) });
  } catch (error) {
    next(error);
  } finally {
    if (tempPath) await fs.promises.unlink(tempPath).catch(() => {});
  }
});

app.post("/api/v1/files/:id/move", express.json({ limit: "16kb" }), async (req, res, next) => {
  try {
    const sourceFolderId = String(req.query.folderId || "me");
    const targetFolderId = String(req.body?.targetFolderId || "");
    if (!targetFolderId) return sendError(res, 400, "targetFolderId is required.");
    if (sourceFolderId === targetFolderId) return sendError(res, 400, "Source and target folders are the same.");
    const { entity: source, message } = await findMessage(sourceFolderId, req.params.id);
    const target = await resolveFolder(targetFolderId);
    const forwarded = await client.forwardMessages(target, {
      messages: [message.id],
      fromPeer: source,
    });
    const moved = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (!moved || (!moved.media?.document && !moved.media?.photo)) {
      return sendError(res, 502, "Telegram did not confirm the moved file; the source was kept.");
    }
    await client.deleteMessages(source, [message.id], { revoke: true });
    res.json({ file: fileSummary(moved, targetFolderId) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/files/:id/download", async (req, res, next) => {
  let tempPath;
  try {
    const folderId = String(req.query.folderId || "me");
    const { message } = await findMessage(folderId, req.params.id);
    tempPath = await downloadToTemp(message);
    const stat = await fs.promises.stat(tempPath);
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Content-Type", message.media?.document?.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(documentFileName(message))}"`);
    await pipeline(fs.createReadStream(tempPath), res);
  } catch (error) {
    if (!res.headersSent) next(error);
    else res.destroy(error);
  } finally {
    if (tempPath) await fs.promises.unlink(tempPath).catch(() => {});
  }
});

app.delete("/api/v1/files/:id", async (req, res, next) => {
  try {
    const folderId = String(req.query.folderId || "me");
    const { entity, message } = await findMessage(folderId, req.params.id);
    await client.deleteMessages(entity, [message.id], { revoke: true });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") {
    return sendError(res, 413, `File exceeds this account's ${accountMaxBytes}-byte Telegram limit.`);
  }
  console.error("Tuba API error:", error?.message || error);
  if (res.headersSent) return;
  const status = Number.isInteger(error?.status) ? error.status : 500;
  res.status(status).json({ error: status >= 500 ? "Telegram operation failed." : error.message });
});

const server = app.listen(port, host, () => {
  console.log(`Tuba MTProto API listening on http://${host}:${port}`);
});

async function shutdown() {
  server.close();
  await client.disconnect().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });
const ask = (label) => rl.question(label);

try {
  const apiIdText = process.env.TG_API_ID || await ask("Telegram API ID: ");
  const apiHash = process.env.TG_API_HASH || await ask("Telegram API hash: ");
  const apiId = Number.parseInt(apiIdText, 10);
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash.trim()) {
    throw new Error("A valid TG_API_ID and TG_API_HASH are required.");
  }

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => ask("Phone number (international format): "),
    phoneCode: async () => ask("Login code from Telegram: "),
    password: async () => ask("Two-step verification password (if enabled): "),
    onError: (error) => console.error("Telegram login error:", error.message),
  });

  console.log("\nLogin successful. Copy this value to TG_SESSION_STRING in your private environment:");
  console.log(client.session.save());
  console.log("\nDo not commit the session string or send it to anyone.");
  await client.disconnect();
} catch (error) {
  console.error("Login failed:", error.message);
  process.exitCode = 1;
} finally {
  rl.close();
}

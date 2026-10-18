# Tuba Telegram MTProto service

This Node.js service connects to Telegram as a **user account** through MTProto. It is separate from Cloudflare Pages because Pages Functions cannot be used as a general-purpose multi-gigabyte MTProto upload relay. The web client should send file bytes directly to this service.

## Requirements

- Node.js 20 or newer
- A Telegram account
- Telegram API ID and API hash from [my.telegram.org](https://my.telegram.org)
- A secure environment in which to keep the Telegram session and API token

## First login

1. Copy `.env.example` to `.env`.
2. Set `TG_API_ID` and `TG_API_HASH` from my.telegram.org.
3. Run `npm install`.
4. Run `npm run login`, complete the Telegram login code and optional two-step verification, and copy the printed session string into `TG_SESSION_STRING`.
5. Generate a long random token (at least 32 characters) and set `TUBA_API_TOKEN`.
6. Set `TUBA_ALLOWED_ORIGINS` to the exact origin(s) of your deployed web UI.
7. Start the service with `npm start`.

Never commit `.env`, the session string, API token, or login code. A Telegram session string grants account access; protect it as carefully as a password.

## Important deployment warning

The default bind address is `127.0.0.1` so the API is not exposed to the public internet by default. If the web UI is hosted elsewhere, put this service behind a private network or a proper access gateway such as Cloudflare Access before making it reachable. Do not rely on CORS as authentication. Do not embed the Telegram session string in frontend code.

For a browser client, the API token must be supplied securely by the user or by a protected gateway; do not bake a shared token into public JavaScript. The existing ImgBed UI has not yet been wired to this service in this milestone.

## API

All routes except `GET /api/v1/health` require:

```http
Authorization: Bearer YOUR_TUBA_API_TOKEN
```

- `GET /api/v1/health` — connection status, account tier, maximum file size
- `GET /api/v1/folders` — Saved Messages plus broadcast channels
- `POST /api/v1/folders` — create a Telegram channel used as a folder; JSON body: `{"name":"Archive"}`
- `PATCH /api/v1/folders/:id` — rename a channel folder; JSON body: `{"name":"New name"}`
- `DELETE /api/v1/folders/:id` — delete an empty channel folder only; non-empty folders are refused with HTTP 409
- `GET /api/v1/files?folderId=me&limit=100&offsetId=0` — list files in Saved Messages or a channel folder
- `GET /api/v1/search?q=invoice` — search recent files in Saved Messages and up to 50 channel folders
- `POST /api/v1/files` — multipart form with `file`, optional `folderId` and `caption`
- `PATCH /api/v1/files/:id?folderId=me` — rename a file; the service reuploads it with the new name and deletes the old message only after the new upload succeeds; JSON body: `{"name":"new-name.pdf"}`
- `POST /api/v1/files/:id/move?folderId=me` — move a file to another folder; JSON body: `{"targetFolderId":"123456789"}`
- `GET /api/v1/files/:id/download?folderId=me` — download a Telegram file
- `DELETE /api/v1/files/:id?folderId=me` — delete a Telegram message/file

Folder IDs are Telegram channel IDs as strings; use `me` for Saved Messages.

## File-size behavior

The service checks the signed-in account's Premium flag at startup and sets the cap to 2,000,000,000 bytes for standard accounts or 4,000,000,000 bytes for Premium accounts. Files above that cap are rejected with HTTP 413 before upload. Telegram may impose additional server-side limits. MTProto removes the Bot API's smaller upload ceiling; it does not make Telegram per-file limits infinite.

## Current milestone limitations

- The service API is implemented, but the existing ImgBed front end and Cloudflare upload handler still need integration.
- Folder organization is represented by Telegram broadcast channels. Moving files forwards the message to the target channel and then removes the original; Telegram may show forwarded-message attribution.
- File listing and search use bounded recent-message windows. Production use should add pagination and robust handling for Telegram rate limits.
- This service should be tested against a real Telegram account before production use.

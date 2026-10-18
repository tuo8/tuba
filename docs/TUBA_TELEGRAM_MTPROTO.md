# Tuba: Telegram MTProto storage and file management

Tuba is being built from the `artai8/CloudFlare-ImgBed` codebase, with a separate Telegram user-account connection service inspired by the organization features in `caamer20/Telegram-Drive`.

## Architecture decision

- **File bytes live in Telegram only.** The new MTProto service uploads files as messages to Saved Messages or to Telegram channels used as folders. It does not write file contents to R2 or S3.
- **Use the Telegram user API (MTProto), not Bot API.** This avoids the Bot API's much smaller upload limit.
- **Large uploads bypass Cloudflare Pages Functions.** The browser must upload directly to the MTProto service; proxying a multi-gigabyte body through a Pages Function would reintroduce platform request-size constraints.
- **Telegram is not literally unlimited per file.** The service detects the signed-in account's Premium status and enforces a hard per-file cap of 2,000,000,000 bytes for standard accounts or 4,000,000,000 bytes for Premium accounts. Telegram may apply other server-side restrictions.
- **Folder model.** Saved Messages is the default/root location. Telegram channels can be created and renamed as additional folders. File bytes remain in Telegram; the service uses temporary disk space only while transferring a file.
- **Client compatibility.** The HTTP API is suitable for a responsive desktop/mobile web UI. This first milestone adds the service API; the existing ImgBed UI is in a separate upstream repository and still needs to be connected to these endpoints.

## Service setup

See [services/telegram-mtproto/README.md](../services/telegram-mtproto/README.md).

## Current implementation scope

The service provides:
- Telegram user-session connection using a StringSession
- Authenticated folder listing and channel-folder creation/renaming
- Authenticated file listing, upload, download, and deletion
- Account-aware upload size validation before a transfer begins
- Bearer-token authentication and explicit CORS origin allowlisting

It deliberately does not provide a way to bypass Telegram's own per-file limits. Keep the service behind a trusted access layer or a private network; do not publish its API token in source control.

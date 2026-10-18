# Tuba: Telegram MTProto storage and file management

Tuba is being built from the `artai8/CloudFlare-ImgBed` codebase, with a separate Telegram user-account connection service inspired by the organization features in `caamer20/Telegram-Drive`.

## Architecture decision

- **File bytes live in Telegram only.** The MTProto service uploads files as messages to Saved Messages or Telegram channels used as folders. It does not write file contents to R2 or S3.
- **Use Telegram user API (MTProto), not Bot API.** This avoids the Bot API's smaller upload limit.
- **Large uploads bypass Cloudflare Pages Functions.** The responsive browser UI uploads directly to the MTProto service; proxying multi-gigabyte bodies through a Pages Function would reintroduce platform request-size constraints.
- **Telegram is not literally unlimited per file.** The service enforces a hard per-file cap of 2,000,000,000 bytes for standard accounts or 4,000,000,000 bytes for Premium accounts. Telegram may apply other server-side restrictions.
- **Folder model.** Saved Messages is the default/root location. Telegram channels can be created, renamed, searched, and deleted only when empty. File bytes remain in Telegram; the service uses temporary disk space only while transferring a file.
- **Client compatibility.** The new responsive web UI is suitable for desktop and phone browsers. The existing ImgBed front end is separate and has not yet been wired to the MTProto service; the new service currently provides its own file-manager UI.

## Service setup

See [services/telegram-mtproto/README.md](../services/telegram-mtproto/README.md).

## Current implementation scope

The service provides Telegram user-session connection, authenticated folder management, file listing/search/upload/download/delete, file rename and move, account-aware upload size validation, bearer-token authentication, explicit CORS origin allowlisting, and a responsive browser UI.

It deliberately does not provide a way to bypass Telegram's own per-file limits. Keep the service behind a trusted access layer or private network; do not publish its API token in source control.

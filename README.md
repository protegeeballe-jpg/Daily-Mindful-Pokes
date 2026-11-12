# Faith & Focus: Daily Armor

Faith & Focus is a local-first daily routine, reflection, and personal garden app. The Forge Room brings the Health Checklist, Personal Diary, and Little Garden together in one workspace.

## Unified account

The app uses one **Username + Passphrase** login. No email address, phone number, API key, Sync Key, App PIN, or separate cloud passphrase is required.

- Usernames are normalized in the browser and used to derive a deterministic Vault ID.
- The passphrase is processed locally with PBKDF2-HMAC-SHA-256 (600,000 iterations).
- The derived material is split into an AES-256-GCM encryption key and a separate Write Token.
- The AES key and raw Write Token remain in JavaScript memory only. They are not stored in localStorage or sessionStorage.
- The Worker receives the Write Token in a request header and stores only its SHA-256 verifier in the Vault Coordinator.
- The session locks after 15 minutes of inactivity. Locking flushes pending local writes, then drops the active encryption key and clears the Write Token from memory.
- Passphrases are limited to 128 characters and must be at least 12 characters long.

**There is no password reset or account recovery.** If you lose the passphrase, the encrypted cloud packets cannot be recovered by the maintainer. Keep a strong, unique passphrase safe.

**First-claim limitation:** A username is registered when it is first claimed at the Worker. With no email, phone, invitation, or external identity provider, the service cannot independently verify who owns an unused username. Someone else could claim an unregistered username before its intended owner. Choose a distinctive username and claim it before sharing the app publicly.

## One encrypted packet per day

Each calendar day uses one unified bundle with a `YYYY-MM-DD` date. It includes:

- Every Health Checklist checkbox and its guided/unlocked state, including checked and unchecked items.
- Diary text and private checklist reflections.
- Encrypted voice-note records.
- Location check-ins for that date.
- The Garden state and relevant progress metadata.

The browser serializes the daily bundle, compresses it with the existing native Gzip compressor when available, and encrypts the result using AES-256-GCM. A fresh 96-bit IV is generated for every packet. The packet metadata exposes only its format, version, date, encryption/compression labels, IV, and ciphertext.

The app keeps an encrypted daily packet in IndexedDB as its local sync copy. It also continues to use existing local browser records as the live application state. **Some checklist, progress, location, and Garden source records in localStorage are not encrypted at rest by the app.** The encrypted IndexedDB packet protects the sync copy and cloud copy; it does not turn every existing browser-storage record into ciphertext. Use a device-level account and screen lock, and do not use a shared browser profile for sensitive entries.

## Automatic Cloudflare sync

The Worker stores isolated per-user values in Cloudflare KV:

- `<Vault_ID>:index` maps calendar dates to their latest `updatedAt` timestamp.
- `<Vault_ID>:<YYYY-MM-DD>` stores that date's encrypted packet.

A Durable Object coordinates each Vault ID. It serializes claim and update operations, validates the Write Token verifier, checks the caller's base version to reject stale writes, and spaces KV writes to respect KV's same-key write-rate limit. The browser stores local packets first, waits five seconds after the latest change before pushing, and makes a best-effort flush when the page becomes hidden. At login, it fetches the date index and pulls newer remote dates.

If two devices change the same date independently, the Worker rejects a stale write and the app preserves the local copy instead of silently overwriting it. Review/export both copies before resolving a conflict. Cloudflare KV is an eventually consistent storage service; the Durable Object is used as the serialized authority for this app's per-vault update path.

The Worker is configured for the GitHub Pages origin:
`https://protegeeballe-jpg.github.io`

The browser connects only to:
`https://faith-focus-proxy.nine-westhigh.workers.dev`

The exact Content Security Policy on `index.html` and `home.html` allows same-origin scripts, inline styles, local/data/blob images, local/blob media, local fonts, and connections to that Worker. The bundled watercolor background and recorded-audio Blob playback remain allowed. Google scripts and Google API connections are not loaded.

## Optional local JSON export/import

Settings includes an optional local JSON export/import of already encrypted daily packets. Import requires signing in to the same account that created the file. This is a fallback file copy, not a prerequisite for automatic sync.

Google Drive and GitHub Gist sync have been removed from the active app. No OAuth script, Gist token, Sync Key, or separate backup passphrase is required.

## Cloudflare deployment setup

The repository contains the Worker code and a Wrangler configuration template. The namespace ID is intentionally a placeholder and must be configured in your Cloudflare account before deployment.

1. Create the KV namespace:
   `npx wrangler kv namespace create VAULT_PACKETS`
2. Copy the returned namespace ID into `wrangler.toml`, replacing `REPLACE_WITH_VAULT_PACKETS_NAMESPACE_ID`.
3. Deploy the Worker:
   `npx wrangler deploy`
4. Confirm the Worker is deployed at `https://faith-focus-proxy.nine-westhigh.workers.dev` or update the Worker URL in `assets/vault-sync.js` and the CORS origin in `worker.js` if you use another hostname.

The Durable Object class `VaultCoordinator` uses the SQLite-backed migration configured in `wrangler.toml`. The GitHub Pages app will not be able to create or synchronize accounts until the KV namespace and Durable Object binding are deployed.

## Legacy-device migration

The previous app used a separate Diary passphrase and stored encrypted Diary/voice-note records under a legacy key configuration. When an existing device first signs in to the unified account, it may ask once for that older Diary passphrase so existing encrypted entries and recordings can be re-encrypted under the new account key. New accounts and devices do not need a second passphrase. The original legacy records are left in place unless migration succeeds.

A device with legacy encrypted records but without its old local encryption configuration may not be able to migrate those records. Keep the original browser profile and any legacy passphrase until migration has completed and the new vault has synchronized.

## Project structure

- `index.html`: Main application and unified login UI.
- `assets/app.js`: Checklist logic, Diary UI, recorder, and delegated UI actions.
- `assets/vault-crypto.js`: Username normalization, PBKDF2 key derivation, and daily AES-GCM packet envelope.
- `assets/vault-session.js`: Unified login, 15-minute inactivity lock, and in-memory credentials.
- `assets/vault-sync.js`: Daily bundle creation, IndexedDB capture, automatic index reconciliation, and Cloudflare requests.
- `assets/vault-storage.js`: IndexedDB storage for encrypted daily packets.
- `assets/vault-crypto.js`: Vault identity and cryptographic packet handling.
- `assets/local-backup.js`: Local encrypted JSON export/import.
- `worker.js`: Origin/header/payload validation and per-vault Cloudflare Worker routes.
- `wrangler.toml`: KV and Durable Object binding template.
- `assets/voice-note-store.js`: Encrypted IndexedDB voice-note storage.
- `assets/writing-security.js`: Private-writing encryption and one-time legacy migration.
- `assets/compressor.js`: Native browser Gzip compression with a safe raw-data fallback.
- `assets/garden.js` and `assets/garden-model.js`: Forge Room and calendar-based Garden growth.
- `assets/app.css`, `assets/garden.css`, and `assets/lexend.css`: Application styles and locally bundled Lexend typography.

## Development and tests

Run the test suite with:

```sh
node --test tests/*.test.mjs
```

The app uses local Lexend variable fonts under the SIL Open Font License 1.1 (`assets/fonts/OFL-Lexend.txt`). Bundled artwork at `assets/garden-room-background.jpg` keeps the Forge Room background available offline.

The Health Checklist Reset clears checklist progress and reflection fields for the selected date, restarts the Garden planting setup, and returns to the seed-planting scene. It preserves main Personal Diary entries, voice notes, and location history.

- [Application Home](./home.html)
- [Privacy Policy](./privacy.html)
- [Terms of Service](./terms.html)

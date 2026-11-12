# Faith & Focus: Daily Armor

Faith & Focus is a local-first daily routine, reflection, and personal garden app. The Forge Room brings the Health Checklist, Personal Diary, and Little Garden together in one workspace.

## Unified account and recovery

Faith & Focus has one account for the Health Checklist, Personal Diary, voice notes, location history, and Garden. The access screen has distinct **Sign In**, **Sign Up**, and **Forgot Password / Username?** paths. Signing in never creates an account.

During sign-up, the user chooses a username and a 12–128 character passphrase, confirms it, then selects exactly three different questions from the 20-question list and supplies one-word answers. Answers cannot contain spaces and are case-sensitive.

- Each new account receives a random, permanent 256-bit Vault ID. The username is a changeable lookup name; it is not the Vault ID.
- The browser generates a random 64-byte account master key. The first 32 bytes encrypt daily packets and the Diary; the second 32 bytes are the stable vault Write Token.
- The master key is separately wrapped with AES-256-GCM under a PBKDF2-HMAC-SHA-256 passphrase-derived key (600,000 iterations) and a recovery-answer-derived key (900,000 iterations). The salts and IVs are random per envelope.
- The app stores encrypted key envelopes in the account directory. It stores the selected question IDs and a peppered HMAC lookup of the three answers, not readable answers. Answers are sent over HTTPS for transient verification; the Worker does not write the plaintext answers to storage or logs.
- Recovery is rate-limited by client IP to five attempts per 15 minutes. Successful recovery unwraps the same permanent master key, allowing a passphrase reset, username change, or both without changing the Vault ID or re-encrypting existing daily packets.
- The account master key and raw Write Token remain in browser memory only. They are not stored in localStorage or sessionStorage.
- The session locks after 15 minutes of inactivity. Locking flushes pending local writes, then drops the active account key material from memory.

**Security-question caveat:** One-word answers are convenient but can have low entropy, especially when the answer is public or easy to guess. Choose uncommon answers that you can reproduce exactly. The recovery envelope is encrypted, but anyone who obtains it may attempt offline guesses against weak answers. Do not use obvious public facts.

**No email or phone recovery:** The three selected answers are the account recovery method. If the answers are forgotten or cannot be reproduced exactly, the maintainer cannot decrypt or restore the account's private records.

## One encrypted packet per day

Each calendar day uses one unified bundle with a `YYYY-MM-DD` date. It includes:

- Checklist checkboxes and their guided/unlocked state, including every checked and unchecked item.
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

## Encrypted JSON export and import

Settings includes an optional local JSON export/import of already encrypted daily packets. Import requires signing in to the same account that created the file. This is a fallback file copy, not a prerequisite for automatic sync.

Google Drive and GitHub Gist sync have been removed from the active app. No OAuth script, Gist token, Sync Key, or separate backup passphrase is required.

## Cloudflare deployment setup

The checked-in `wrangler.toml` contains the supplied `VAULT_PACKETS` namespace ID and bindings for both `VaultCoordinator` and `AccountDirectory`. Before deploying the account-recovery release:

1. Confirm that the `VAULT_PACKETS` namespace exists in the Cloudflare account connected to Wrangler.
2. Confirm the SQLite Durable Object migrations for `VaultCoordinator` (v1) and `AccountDirectory` (v2) are applied.
3. Set a strong random Worker secret of at least 32 bytes. Do not commit it to Git:
   `npx wrangler secret put RECOVERY_PEPPER`
4. Deploy the Worker:
   `npx wrangler deploy`
5. Verify both Durable Object bindings and KV in the production Worker's Bindings view. The GitHub Pages app connects to `https://faith-focus-proxy.nine-westhigh.workers.dev`.

The account directory stores username-to-Vault-ID mappings, selected question IDs, encrypted passphrase and recovery envelopes, and a peppered HMAC recovery lookup. It does not store readable security answers. The Worker requires `VAULT_PACKETS`, `VAULT_COORDINATOR`, `ACCOUNT_DIRECTORY`, and `RECOVERY_PEPPER`; account sign-up and recovery will remain unavailable until all four are configured.

## Legacy-device migration

The previous app used a separate Diary passphrase and stored some encrypted Diary/voice-note records under a legacy key configuration. During the first upgrade, a device with those legacy records may ask once for the previous Diary passphrase. The app stages and verifies converted records before removing original plaintext legacy fields. New accounts and upgraded accounts use the same permanent master key for the Diary and daily vault; there is no separate Diary login.

A device with legacy encrypted records but without its old local encryption configuration may not be able to migrate those records. Keep the original browser profile and any legacy passphrase until migration has completed and the new vault has synchronized.

## Project structure

- `index.html`: Main application and unified login UI.
- `assets/app.js`: Checklist logic, Diary UI, recorder, and delegated UI actions.
- `assets/vault-crypto.js`: Permanent Vault ID and master-key generation, passphrase/recovery wrapping, and daily AES-GCM packet envelope.
- `assets/vault-session.js`: Unified login, 15-minute inactivity lock, and in-memory credentials.
- `assets/vault-sync.js`: Daily bundle creation, IndexedDB capture, automatic index reconciliation, and Cloudflare requests.
- `assets/vault-storage.js`: IndexedDB storage for encrypted daily packets.
- `assets/vault-crypto.js`: Vault identity and cryptographic packet handling.
- `assets/local-backup.js`: Local encrypted JSON export/import.
- `worker.js`: Origin/header/payload validation, per-vault packet routes, and the protected account directory/recovery API.
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

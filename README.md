# Faith & Focus: Daily Armor

Faith & Focus is a local-first daily routine, reflection, and personal garden app. The Forge Room brings the Health Checklist, Personal Diary, and Little Garden together in one workspace.

## Unified account and recovery

The app has dedicated **Sign In**, **Sign Up**, and **Forgot Password / Username?** paths. Signing in never silently creates an account. A single successful sign-in opens the Checklist, Diary, Voice Notes, Location History, and Garden.

New accounts use a permanent random Vault ID and a random 256-bit master encryption key. The username is a changeable account label indexed by the Account Registry; it is not used to derive the Vault ID. Existing username-derived vaults have a one-time upgrade path that preserves their original Vault ID, master key, and encrypted daily packets.

- The user chooses a username and a 12–128 character passphrase, then selects three different questions from the twenty-question bank.
- Each answer must be one word, with no spaces. Answers are case-sensitive and are not automatically lowercased.
- PBKDF2-HMAC-SHA-256 (600,000 iterations) derives a passphrase wrapping key and a separate Write Token. The passphrase itself is never sent to Cloudflare.
- The master key is encrypted locally under the passphrase-derived key. A second encrypted copy is wrapped by a key derived from the three security answers using PBKDF2-HMAC-SHA-256 (1,200,000 iterations).
- The browser sends the selected question IDs and answers over HTTPS during sign-up and recovery. The Worker computes a keyed HMAC using the Cloudflare secret `RECOVERY_PEPPER`; it does not store the answers in readable form. The recovery-wrapped master-key envelope is sealed using that secret before being stored in the Account Registry.
- On recovery, the Worker rate-limits answer attempts to five per source IP per 15-minute window and issues a single-use, ten-minute recovery grant after a match. The browser derives the recovery key and decrypts the master key locally. The Worker never receives the plaintext master key or Diary contents.
- A passphrase reset re-wraps the same master key and rotates the vault Write Token. A username change updates the username index. Neither operation changes the permanent Vault ID or requires re-encrypting the daily packets.
- For forgotten usernames, the user selects the same three questions and enters the same answers; the verified recovery flow displays the current username. Users must remember which three questions they selected as well as the exact answer spelling and case.
- The three-question process is a recovery convenience, not a substitute for a high-entropy passphrase. Choose unusual answers that other people cannot easily guess. If the three selected questions or exact answers are lost, recovery may not be possible.

The AES master key and raw Write Token remain in browser memory only; they are not stored in localStorage or sessionStorage. The Worker stores only a SHA-256 verifier for the Write Token in the vault Durable Object. The app locks the account after 15 minutes of inactivity, flushes pending local writes, and then clears active key material from memory.

**Legacy Diary records:** Existing devices with entries encrypted under the older, separate Diary passphrase may still require that previous passphrase once. The migration is staged: original plaintext and encrypted source records are preserved until the converted records are committed successfully. New accounts and new devices use the unified account master key without a second Diary password.

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

The current `wrangler.toml` includes the KV namespace ID supplied for this project and two Durable Object bindings:

- `VAULT_COORDINATOR` — per-vault authentication and daily-packet write coordination.
- `ACCOUNT_REGISTRY` — username lookup, account metadata, recovery-answer verification, and recovery grants.

The configuration contains SQLite-backed Durable Object migrations: `v1` for `VaultCoordinator` and `v2` for `AccountRegistry`. When deploying, confirm the namespace ID belongs to the intended Cloudflare account and that the Worker has all three bindings in the dashboard.

The recovery system requires a persistent secret that must **never** be committed to Git:

1. Generate a high-entropy secret in a trusted terminal, for example: `openssl rand -base64 48`.
2. Set it as a Cloudflare Worker secret: `npx wrangler secret put RECOVERY_PEPPER`.
3. Keep a secure backup of the secret in an approved password manager or secrets vault. Do not expose it in source code, logs, screenshots, or repository settings.
4. Deploy the Worker and migrations: `npx wrangler deploy`.
5. Confirm that the deployed Worker has `VAULT_PACKETS`, `VAULT_COORDINATOR`, `ACCOUNT_REGISTRY`, and the `RECOVERY_PEPPER` secret configured.

The `RECOVERY_PEPPER` must remain stable. Rotating or losing it without a planned migration makes existing recovery-answer indexes and sealed recovery envelopes unusable. Existing passphrase sign-in remains separate from the recovery secret, but sign-up and account recovery require it.

The Worker is configured for the GitHub Pages origin:
`https://protegeeballe-jpg.github.io`

The browser connects only to:
`https://faith-focus-proxy.nine-westhigh.workers.dev`

The GitHub Pages app cannot create new accounts, recover accounts, or synchronize vault data until the KV namespace, both Durable Object bindings/migrations, and the Worker secret are deployed.

## Legacy-device migration

Existing accounts created by the earlier username-derived account scheme are upgraded by verifying the old Write Token with the existing Vault Coordinator. The upgrade preserves that Vault ID and master encryption key, adds the three-question recovery envelope, and rotates the Write Token to the new passphrase-wrapped account format. It does not create an empty replacement vault.

Older Diary/voice-note records that were encrypted with the separate legacy Diary passphrase may still prompt for that old passphrase once. Migration keeps original records until Diary and voice-note conversion succeeds. Keep the original browser profile intact until the updated account has opened successfully on all devices and the encrypted daily packets have synchronized.

## Project structure

- `index.html`: Main application and unified login UI.
- `assets/app.js`: Checklist logic, Diary UI, recorder, and delegated UI actions.
- `assets/vault-crypto.js`: Permanent Vault ID, master-key wrapping, passphrase/recovery derivation, legacy upgrade, and daily AES-GCM packet envelope.
- `assets/vault-session.js`: Unified login, 15-minute inactivity lock, and in-memory credentials.
- `assets/vault-sync.js`: Daily bundle creation, IndexedDB capture, automatic index reconciliation, and Cloudflare requests.
- `assets/vault-storage.js`: IndexedDB storage for encrypted daily packets.
- `assets/vault-crypto.js`: Vault identity and cryptographic packet handling.
- `assets/local-backup.js`: Local encrypted JSON export/import.
- `worker.js`: Origin/header/payload validation, account registry/recovery routes, and per-vault Cloudflare Worker routes.
- `wrangler.toml`: KV, Vault Coordinator, and Account Registry bindings/migrations.
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

# Faith & Focus: Daily Armor\n\n**Security & Privacy Model**

Local App PIN: Designed for quick screen privacy on your device. New PINs must contain 6–12 digits and are stored securely as salted PBKDF2-HMAC-SHA-256 verifiers (600,000 iterations). Legacy PINs are automatically upgraded at launch.
Inactivity Auto-Lock Timer (5 minutes)
App Visibility API Lock

Private Writing Protection: Your Personal Diary, checklist reflections, and saved voice notes are secured with browser-native AES-256-GCM encryption derived from your separate private-writing passphrase (600,000 iterations). Voice notes are encrypted before being saved in local IndexedDB storage. Encrypted voice-note records are included in encrypted Gist background backups and user-initiated Google Drive backups. Encryption keys exist only in volatile memory during your active unlocked session.

Local Data Handling: Checklist checkboxes, task unlock flags, cloud-release flags, daily progress, confidence scores, and app settings remain stored locally in your browser storage. These ordinary progress records are not encrypted by the app.

Location Check-ins: Each checked location option on the first checklist card requests a one-time current browser location. Every successful capture is appended to a date-specific, read-only history shown in the unlocked Personal Diary. Location records remain in separate browser storage on this device, are not sent to the App maintainer, are not editable or removable through the App, and are excluded from Google Drive backups. Coordinates can be copied or opened in Google Maps from the Diary and checklist details. The browser or operating system location provider handles the location request.

Zero-Knowledge Architecture: Your private diary passphrase is known only to you and is never sent to any server. Because encryption is handled entirely on your device, forgotten passphrases cannot be recovered by the app.

Storage & Protection
Persistent Storage Request: Upon initialization, the app requests persistent storage status from your browser to prevent automatic cache clearance on low-disk devices.
Content Security Policy: Restricted origin execution blocks unauthorized script injections, keeping your workspace isolated and secure.

Development
index.html: Main application shell
assets/app.js: Application logic and delegated UI actions
assets/app-gate.js: App PIN hashing and verification
assets/writing-security.js: Private-writing encryption engine and voice-note security integration
assets/voice-note-store.js: Encrypted IndexedDB voice-note storage
assets/compressor.js: Native CompressionStream (Gzip) data optimization engine for budget mobile devices
assets/drive-sync.js: Google Identity Services (OAuth 2.0) and manual Google Drive appDataFolder backup/restore module
assets/app.css: App styling
assets/tailwind.input.css: Tailwind build input
Run tests with node --test tests/*.test.mjs.

Faith & Focus: Daily Armor
The app opens into The Forge Room, the shared home for the Health Checklist, the single encrypted Personal Diary, and the outdoor Garden scene.
Bundled artwork at assets/garden-room-background.jpg ensures full offline functionality without external image dependencies.
assets/garden.js and assets/garden-model.js drive the Forge Room and calendar-based growth experience.
The Health Checklist Reset clears checklist progress and reflection fields for the selected date, restarts the Garden planting setup, and returns to the seed-planting scene. It preserves the main Personal Diary entries, saved voice notes, and all location history.

Storage Optimization & Auto-Compression
Device Optimization: Utilizes native browser CompressionStream (Gzip) via assets/compressor.js to minimize local storage usage on mobile devices.
Local Backup Preparation: Compression is performed locally before backup. Gist uploads may run automatically after a two-second idle period when per-device automatic sync is enabled; Google Drive remains manual.
Graceful Fallbacks: On legacy browsers where Gzip streaming is unavailable, raw string storage is used seamlessly to ensure continuous app functionality.
**Optional Google Drive Backup & Restore (appDataFolder)
**
Non-Sensitive Private Scope: Cloud backup utilizes Google Identity Services (OAuth 2.0) with the isolated https://www.googleapis.com/auth/drive.appdata scope.
Private Folder Isolation: Backup files (faith-focus-armor-backup.gz) are saved exclusively to a hidden app data folder in your personal Google Drive, inaccessible to other third-party Drive apps.

**User-Controlled Sync: Google Drive backup and restore operations remain strictly manual and user-initiated. Data is uploaded to Google Drive only when you explicitly select Back Up This Device. The device's app PIN verifier is deliberately excluded from every backup.**

Manual Restore: Selecting Restore From Drive retrieves your compressed backup file from your Google Drive app data and restores your app state.

Typography
Uses locally bundled Lexend variable fonts (weights 100-900) embedded via same-origin stylesheets under the SIL Open Font License 1.1 (assets/fonts/OFL-Lexend.txt).

- Public application information: [home.html](./home.html)
- Privacy Policy: [privacy.html](./privacy.html)
- Terms of Service: [terms.html](./terms.html)


## Optional encrypted GitHub Gist sync

`assets/gist-sync.js` provides automatic encrypted Gist synchronization after per-device setup, plus manual backup and restore fallbacks through the Cloudflare Worker at `faith-focus-proxy.nine-westhigh.workers.dev/backup`. It coexists with `assets/drive-sync.js`; Google Drive remains a separate optional fallback and is not removed.

The browser builds a shared validated backup payload containing supported checklist and garden state, encrypted Diary records, and encrypted IndexedDB voice notes. The complete payload is optionally gzip-compressed and encrypted with AES-256-GCM using a dedicated Gist backup passphrase derived with PBKDF2-HMAC-SHA-256 (600,000 iterations). That passphrase is never sent to the Worker. A separate Cloudflare `SYNC_KEY` is sent in an HTTPS request header. The GitHub token remains only in the Cloudflare Secret `GITHUB_TOKEN`.

Cloudflare Worker configuration:
- `GITHUB_TOKEN`: GitHub token with Gist write access, stored as a Worker Secret.
- `GIST_ID`: the ID of the existing secret Gist.
- `SYNC_KEY`: a random secret of at least 32 characters, stored as a Worker Secret and entered on each device.
- The Gist may initially have no `faith-focus-daily-armor.enc.json` file; the Worker GET returns an empty version and the first save creates the backup file.

After explicit setup, each device stores the Cloudflare Sync Key and separate Gist backup passphrase in that browser's localStorage to enable automatic sync. This is convenient but means scripts executing on the app's origin and anyone with access to the browser profile may be able to read those credentials. Use a trusted, device-locked browser profile. The app compares ETags and local backup fingerprints on startup, restores a newer cloud version only when local data is unchanged, and pauses on ambiguous conflicts. Local changes are saved immediately, then queued for an encrypted Gist upload after two seconds of inactivity. Google Drive remains a separate manual backup option. GitHub documents that ETags support conditional GET requests but that conditional requests for unsafe methods such as PATCH are not supported unless an endpoint explicitly documents otherwise. Therefore the Worker pre-write ETag comparison detects stale devices in ordinary sequential use, but does not provide a fully atomic lock for two truly simultaneous saves. A Cloudflare Durable Object lock would be needed for strict global serialization.

GitHub secret Gists are unlisted, not private. The entire file is encrypted before upload, but anyone with the Gist URL can still download the ciphertext. Keep the Gist backup passphrase private. The App PIN and location history are excluded from cloud backups.

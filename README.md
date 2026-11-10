# Faith & Focus: Daily Armor\n\n**Security & Privacy Model**

Local App PIN: Designed for quick screen privacy on your device. New PINs must contain 6–12 digits and are stored securely as salted PBKDF2-HMAC-SHA-256 verifiers (600,000 iterations). Legacy PINs are automatically upgraded at launch.
Inactivity Auto-Lock Timer (5 minutes)
App Visibility API Lock

Private Writing Protection: Your Personal Diary and checklist reflections are secured with browser-native AES-256-GCM encryption derived from your separate private-writing passphrase (600,000 iterations). Encryption keys exist only in volatile memory during your active unlocked session.

Local Data Handling: Checklist checkboxes, task unlock flags, cloud-release flags, daily progress, confidence scores, and app settings remain stored locally in your browser storage. These ordinary progress records are not encrypted by the app.

Location Check-ins: Each checked location option on the first checklist card requests a one-time current browser location. Coordinates, accuracy, and capture time are stored separately on this device, are not sent to the App maintainer, and are excluded from Google Drive backups. The browser or operating system location provider handles the location request.

Zero-Knowledge Architecture: Your private diary passphrase is known only to you and is never sent to any server. Because encryption is handled entirely on your device, forgotten passphrases cannot be recovered by the app.

Storage & Protection
Persistent Storage Request: Upon initialization, the app requests persistent storage status from your browser to prevent automatic cache clearance on low-disk devices.
Content Security Policy: Restricted origin execution blocks unauthorized script injections, keeping your workspace isolated and secure.

Development
index.html: Main application shell
assets/app.js: Application logic and delegated UI actions
assets/app-gate.js: App PIN hashing and verification
assets/writing-security.js: Private-writing encryption engine
assets/compressor.js: Native CompressionStream (Gzip) data optimization engine for budget mobile devices
assets/drive-sync.js: Google Identity Services (OAuth 2.0) and manual Google Drive appDataFolder backup/restore module
assets/app.css: App styling
assets/tailwind.input.css: Tailwind build input
Run tests with node --test tests/*.test.mjs.

Faith & Focus: Daily Armor
The app opens into The Forge Room, the shared home for the Health Checklist, the single encrypted Personal Diary, and the outdoor Garden scene.
Bundled artwork at assets/garden-room-background.jpg ensures full offline functionality without external image dependencies.
assets/garden.js and assets/garden-model.js drive the Forge Room and calendar-based growth experience.
The checklist Reset button resets daily entries and reflections without affecting garden progress or planted seeds.

Storage Optimization & Auto-Compression
Device Optimization: Utilizes native browser CompressionStream (Gzip) via assets/compressor.js to minimize local storage usage on mobile devices.
Local Backup Preparation: Compression is performed when you explicitly request a backup. No Google sign-in or upload is triggered automatically.
Graceful Fallbacks: On legacy browsers where Gzip streaming is unavailable, raw string storage is used seamlessly to ensure continuous app functionality.
**Optional Google Drive Backup & Restore (appDataFolder)
**
Non-Sensitive Private Scope: Cloud backup utilizes Google Identity Services (OAuth 2.0) with the isolated https://www.googleapis.com/auth/drive.appdata scope.
Private Folder Isolation: Backup files (faith-focus-armor-backup.gz) are saved exclusively to a hidden app data folder in your personal Google Drive, inaccessible to other third-party Drive apps.

**User-Controlled Sync: Backup and restore operations are strictly manual and user-initiated. Data is uploaded to Google Drive only when you explicitly select Back Up This Device. The device's app PIN verifier is deliberately excluded from every backup.**

Manual Restore: Selecting Restore From Drive retrieves your compressed backup file from your Google Drive app data and restores your app state.

Typography
Uses locally bundled Lexend variable fonts (weights 100-900) embedded via same-origin stylesheets under the SIL Open Font License 1.1 (assets/fonts/OFL-Lexend.txt).

- Public application information: [home.html](./home.html)
- Privacy Policy: [privacy.html](./privacy.html)
- Terms of Service: [terms.html](./terms.html)

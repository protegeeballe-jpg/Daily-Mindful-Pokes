# Account System — Foundation and Security Boundaries

## Product requirements captured

- Accounts do not require an email address.
- A person can sign in on another device with the same username and password.
- Registration presents the 20 Faith & Focus questions in `assets/account-security.js`; the person chooses exactly 3 and supplies all 3 answers.
- Username uses uppercase and lowercase English letters only. Matching must be case-insensitive so that (for example) `FaithFocus` and `faithfocus` cannot become separate accounts.
- Account password is exactly 6 visible characters, containing at least one uppercase letter, one lowercase letter, one number, and one special character.
- Forgotten-username and forgotten-password flows require verification of all 3 registered answers.
- The account password is separate from the existing local device PIN and private-writing encryption passphrase.
- Answers are normalized using Unicode NFKC, lowercase conversion, and removal of whitespace and punctuation. This is for consistent matching only; it does not make answers high-entropy secrets.

## What this foundation does

`assets/account-security.js` contains the 20-question bank and pure validation/normalization helpers. It has no network calls, storage writes, DOM effects, or authentication behavior. Its tests run under the existing Node test workflow.

This first stage deliberately does not display an account-registration or sign-in control. A front-end-only form would create the false impression of a real account even though this GitHub Pages app has no account server. No existing Diary, location, voice-note, checklist, Garden, app-PIN, or Google Drive behavior is changed.

## Review of the proposed GitHub Gist storage approach

The supplied `auth-storage.js` is not safe to deploy as an account backend:

- GitHub requires authentication to create gists, and its REST API requires a token with Gists write permission. Requiring users (especially children) to supply GitHub personal tokens adds a separate GitHub account and exposes a powerful credential to browser code. A shared token in the app would expose the maintainer's credential.
- GitHub explicitly says secret gists are not private: anyone who obtains the URL can view them. A secret gist is an unlisted sharing mechanism, not a private per-user account database.
- A gist ID is not discoverable from an app username in this design. Saving it in local storage only helps the same browser; it does not provide username-based sign-in on a new device.
- GitHub's Gist API returns at most 1 MB of file content in its ordinary response and marks oversized files as truncated. That is a poor fit for growing daily records and audio-note payloads.
- The sample uses single-pass SHA-256 for security answers. Security answers have low and uneven entropy, so a fast general-purpose hash allows rapid offline guessing.
- The sample derives the Diary AES key directly from the six-character account password. If an attacker obtains the encrypted bundle, password guesses can be tested offline. The account password must not be used directly as the Diary encryption key.
- The sample password reset can overwrite existing cloud data with an encrypted empty object when `ff_local_cache` is absent on the recovery device. It must never be used.
- The sample sync replaces the complete gist file without version checks or conflict handling. Concurrent edits on two devices can silently overwrite one another.
- The sample state model does not include the full required daily package of voice notes, location captures, checklist reflections/progress, and diary content.

GitHub Gist remains unsuitable for account authentication and private application storage. The existing optional Google Drive backup is a separate, manual user-controlled feature and must remain intact.

## Required account service before enabling registration

The app needs a real HTTPS account service and persistent database. GitHub Pages alone cannot safely create username/password accounts, enforce case-insensitive uniqueness, rate-limit login/recovery attempts, or synchronize data between devices.

The service must:
- enforce unique usernames using a normalized, case-insensitive key;
- use a vetted authentication protocol or server-side password verification with a memory-hard password-hashing implementation (prefer Argon2id where supported);
- rate-limit login and recovery attempts, introduce temporary lockouts, and return generic recovery responses that do not reveal whether a username exists;
- store security-answer verifiers using a vetted password-hashing implementation and a unique salt per answer; never store plaintext answers or write them to logs;
- require all 3 answers for account recovery, with server-side throttling and audit-safe security events;
- use HTTPS and secure session handling, and never store account passwords in browser storage;
- support account deletion and data export policies before public release.

The six-character password is a deliberate child-friendly product requirement. Because it has a small search space and answer choices can be guessable, neither the password nor the security answers may be treated as strong encryption keys. Server-side authentication defenses and a separate high-entropy Diary recovery mechanism are mandatory. A client-side hash alone does not provide adequate protection against offline guessing.

## Diary confidentiality and recovery gate

Authentication and encryption are separate responsibilities. The account service may authorize access to encrypted records, but it must not receive Diary plaintext or the private-writing encryption key.

Before cloud synchronization is enabled, the design must provide a safe way to recover the same random Diary encryption key after a forgotten-password reset. Security-question answers are memorable but often guessable; they must not be the sole protection for an offline encryption-key wrap. The recovery design must use a high-entropy recovery mechanism, explain it in child-friendly language, and verify that a password reset preserves access to existing encrypted content. A reset must never silently generate a new Diary key.

## Daily record and data-preservation requirements

The eventual synchronized record for each account/date must be a single authenticated encrypted package containing:
- Diary text and private reflections for that date;
- encrypted voice-note payloads and their timestamps;
- that date's location captures and timestamps;
- that date's checklist progress and related daily state.

The date and account/record identity must be authenticated as encryption metadata. Cloud storage should receive ciphertext only. Conflicts must be detected and resolved without silent overwrite.

The current app stores these data types in different local stores. Migration must be non-destructive: read and group the existing records, create the new daily package, decrypt it again to verify integrity, and only then mark that date as migrated. Never delete source records before verification succeeds.

## Existing feature boundaries that must remain intact

- The local app PIN remains a device screen gate and is not replaced by the account password.
- The current private-writing encryption remains separate until a tested key migration is ready.
- Location check-ins remain append-only and read-only in the UI. Account sync will require an explicit privacy-policy update because location history is currently local-only and excluded from Google Drive backup.
- Voice notes must remain encrypted and recoverable.
- Google Drive backup/restore remains optional and manual. It is separate from account synchronization and must not be disabled to implement accounts.
- Checklist Reset must continue preserving the Diary, saved voice notes, and location history.

## Safe next implementation gate

Choose and provision an account backend, then implement and test its server-side schema, authentication, answer verification, rate limits, encrypted-record storage, recovery-key wrapping, conflict handling, and data export/deletion paths. Only after those pieces are available should the app expose registration, login, recovery, or multi-device sync controls.

# Account System — Foundation and Security Boundaries

## Product requirements captured

- Accounts do not require an email address.
- A person can sign in on another device with the same username and password.
- Registration presents 20 security questions; the person chooses exactly 3 and supplies all 3 answers.
- Username uses uppercase and lowercase English letters only. Matching must be case-insensitive so that (for example) `FaithFocus` and `faithfocus` cannot become separate accounts.
- Account password is exactly 6 visible characters, containing at least one uppercase letter, one lowercase letter, one number, and one special character.
- Forgotten-username and forgotten-password flows require verification of all 3 registered answers.
- The account password is separate from the existing local device PIN and private-writing encryption passphrase.

## What this foundation does

`assets/account-security.js` contains the stable 20-question bank and pure validation/normalization helpers. It has no network calls, storage writes, DOM effects, or authentication behavior. Its tests run under the existing Node test workflow.

This first stage deliberately does not display an account-registration or sign-in control. A front-end-only form would create the false impression of a real account even though this GitHub Pages app has no account server. No existing Diary, location, voice-note, checklist, Garden, app-PIN, or Google Drive behavior is changed.

## Required account service before enabling registration

The app needs a real HTTPS account service and persistent database. GitHub Pages alone cannot safely create username/password accounts, enforce case-insensitive uniqueness, rate-limit login/recovery attempts, or synchronize data between devices.

The service must:
- enforce unique usernames using a normalized, case-insensitive key;
- verify account passwords with a vetted server-side password-hashing implementation (prefer Argon2id where supported);
- rate-limit login and recovery attempts, introduce temporary lockouts, and return generic recovery responses that do not reveal whether a username exists;
- store security-answer verifiers using a vetted password-hashing implementation and a unique salt per answer; never store plaintext answers or write them to logs;
- require all 3 answers for account recovery, with server-side throttling and audit-safe security events;
- use HTTPS and secure session handling, and never store account passwords in browser storage;
- support account deletion and data export policies before public release.

The six-character password is a deliberate child-friendly product requirement. Because it has a small search space, it must not be treated as a strong encryption key or used directly to encrypt the Diary. Server-side hashing, rate limits, lockouts, and abuse monitoring are mandatory.

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

Select and provision the account backend, then implement and test its server-side schema, password verification, answer verification, rate limits, encrypted-record storage, recovery-key wrapping, and data export/deletion paths. Only after those pieces are available should the app expose registration, login, recovery, or multi-device sync controls.

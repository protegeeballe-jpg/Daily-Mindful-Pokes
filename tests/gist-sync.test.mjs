import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const gist = read('../assets/gist-sync.js');
const drive = read('../assets/drive-sync.js');
const html = read('../index.html');
const worker = read('../worker.js');
const app = read('../assets/app.js');
const writing = read('../assets/writing-security.js');

test('Gist sync uses the Cloudflare Worker and never embeds a GitHub token', () => {
  assert.match(gist, /faith-focus-proxy\.nine-westhigh\.workers\.dev\/backup/);
  assert.match(gist, /X-Sync-Key/);
  assert.doesNotMatch(gist, /GITHUB_TOKEN|gh[pousr]_[A-Za-z0-9_]{20,}/);
  assert.match(html, /https:\/\/faith-focus-proxy\.nine-westhigh\.workers\.dev/);
});

test('Gist backup encrypts the complete shared backup payload in the browser', () => {
  assert.match(gist, /AES-GCM/);
  assert.match(gist, /PBKDF2/);
  assert.match(gist, /BACKUP_KDF_ITERATIONS = 600000/);
  assert.match(gist, /createBackupPayload/);
  assert.match(gist, /restoreBackupPayload/);
  assert.match(drive, /exportPrivateVoiceNotes/);
  assert.match(drive, /restorePrivateVoiceNotes/);
});

test('Gist sync remembers credentials only after explicit opt-in and provides a forget control', () => {
  assert.match(gist, /SYNC_KEY_STORAGE_KEY/);
  assert.match(gist, /PASSPHRASE_STORAGE_KEY/);
  assert.match(gist, /localStorage\.setItem\(SYNC_KEY_STORAGE_KEY/);
  assert.match(gist, /localStorage\.setItem\(PASSPHRASE_STORAGE_KEY/);
  assert.match(gist, /forgetSavedCredentials/);
  assert.match(html, /id="gist-enable-auto-sync"/);
  assert.match(html, /id="gist-forget-credentials"/);
  assert.match(html, /stored in this browser's localStorage/i);
});

test('Gist startup compares ETags and fingerprints and never auto-overwrites changed local data', () => {
  assert.match(gist, /runAutomaticStartupSync/);
  assert.match(gist, /fingerprintPayload/);
  assert.match(gist, /knownEtag === remote\.etag/);
  assert.match(gist, /localIsUnchanged/);
  assert.match(gist, /Another device has updated the Gist while this device also has local changes/);
  assert.match(gist, /current\.etag/);
  assert.match(worker, /currentEtag !== expectedEtag/);
});

test('Local-first changes trigger a two-second debounced background Gist save', () => {
  assert.match(gist, /scheduleAutoSave\(2000\)/);
  assert.match(gist, /localStorage\.prototype|Storage\?\.prototype/);
  assert.match(gist, /faith-focus:local-data-changed/);
  assert.match(app, /faith-focus:app-unlocked/);
  assert.match(writing, /faith-focus:local-data-changed/);
});

test('Pending Gist saves are attempted when the tab becomes hidden', () => {
  assert.match(gist, /document\.addEventListener\('visibilitychange'/);
  assert.match(gist, /window\.addEventListener\('pagehide'/);
  assert.match(gist, /keepalive/);
  assert.match(gist, /DIRTY_STORAGE_KEY/);
});

test('Gist and Google Drive controls remain separate collapsible Settings options', () => {
  const settingsStart = html.indexOf('<dialog id="settings-modal"');
  const settingsEnd = html.indexOf('</dialog>', settingsStart);
  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart);
  const settings = html.slice(settingsStart, settingsEnd);
  assert.match(settings, /<details id="gist-sync-settings"/);
  assert.match(settings, /<details id="drive-sync-settings"/);
  assert.match(settings, /id="gist-sync-panel"/);
  assert.match(settings, /id="drive-sync-panel"/);
  assert.match(settings, /Google Drive Backup/);
  assert.match(html, /src="\.\/assets\/gist-sync\.js"/);
  assert.match(html, /src="\.\/assets\/drive-sync\.js"/);
  assert.match(drive, /drive-backup-button/);
  assert.match(drive, /drive-restore-button/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const gist = read('../assets/gist-sync.js');
const drive = read('../assets/drive-sync.js');
const html = read('../index.html');
const worker = read('../worker.js');

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

test('Gist sync uses ETag stale-version checks and does not persist credentials', () => {
  assert.match(gist, /If-Match/);
  assert.match(gist, /ETAG_STORAGE_KEY/);
  assert.doesNotMatch(gist, /localStorage\.setItem\([^,]*(?:SYNC_KEY|PASSPHRASE)/i);
  assert.match(worker, /currentEtag !== expectedEtag/);
  assert.match(worker, /Access-Control-Allow-Origin/);
});

test('Gist UI is distinct from the independent optional Google Drive backup', () => {
  assert.match(html, /id="gist-sync-panel"/);
  assert.match(html, /id="drive-sync-panel"/);
  assert.match(html, /Google Drive Backup \(optional\)/);
  assert.match(html, /src="\.\/assets\/gist-sync\.js"/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../assets/vault-sync.js', import.meta.url), 'utf8');
const session = readFileSync(new URL('../assets/vault-session.js', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../assets/vault-storage.js', import.meta.url), 'utf8');
const backup = readFileSync(new URL('../assets/local-backup.js', import.meta.url), 'utf8');

test('GitHub Gist and Google Drive credential integrations are not loaded by the active app', () => {
  assert.doesNotMatch(html, /assets\/(?:gist-sync|drive-sync)\.js/);
  assert.doesNotMatch(html, /gist-sync-settings|gist-enable-auto-sync|gist-backup-passphrase|drive-connect-button/);
  assert.doesNotMatch(html, /accounts\.google\.com|www\.googleapis\.com/);
  assert.match(html, /id="vault-login-form"/);
  assert.match(html, /id="vault-sync-settings"/);
});

test('vault packets save locally first and automatically synchronize after the five-second debounce', () => {
  assert.match(storage, /indexedDB\.open/);
  assert.match(sync, /putLocalDailyPacket/);
  assert.match(sync, /setTimeout\([\s\S]*?5000\)/);
  assert.match(sync, /addEventListener\('visibilitychange'/);
  assert.match(sync, /addEventListener\('online'/);
  assert.match(sync, /function synchronizeVault\(/);
  assert.match(sync, /function performVaultSync\(/);
  assert.match(session, /SESSION_INACTIVITY_MS = 2 \* 60 \* 1000/);
});

test('local encrypted JSON export and import remain optional Settings actions', () => {
  assert.match(html, /id="vault-export-button"/);
  assert.match(html, /id="vault-import-button"/);
  assert.match(backup, /exportEncryptedVaultPackets/);
  assert.match(backup, /importEncryptedVaultPackets/);
  assert.match(backup, /application\/json/);
});

import { compressData, decompressData } from './compressor.js';
import { createBackupPayload, restoreBackupPayload, validateBackup } from './drive-sync.js';
import { GARDEN_STORAGE_KEY } from './garden-model.js';

const WORKER_ENDPOINT = 'https://faith-focus-proxy.nine-westhigh.workers.dev/backup';
const BACKUP_FILE_NAME = 'faith-focus-daily-armor.enc.json';
const BACKUP_DESCRIPTION = 'Faith & Focus: Daily Armor encrypted device backup';
const ETAG_STORAGE_KEY = 'faith_focus_gist_etag_v1';
const FINGERPRINT_STORAGE_KEY = 'faith_focus_gist_fingerprint_v1';
const DIRTY_STORAGE_KEY = 'faith_focus_gist_dirty_v1';
const SYNC_KEY_STORAGE_KEY = 'faith_focus_gist_sync_key_v1';
const PASSPHRASE_STORAGE_KEY = 'faith_focus_gist_backup_passphrase_v1';
const ENVELOPE_FORMAT = 'faith-focus-daily-armor-encrypted-backup';
const BACKUP_KDF_ITERATIONS = 600000;
const BACKUP_AAD = 'Faith & Focus: Daily Armor|cloud-backup|v1';
const MAX_BACKUP_FILE_BYTES = 900000;
const KEEPALIVE_BODY_LIMIT = 60 * 1024;
const WRITING_CONFIG_KEY = 'dmp_private_writing_crypto_v1';
const DAILY_RECORD_PATTERN = /^mindful_pokes_data_\d{4}-\d{2}-\d{2}$/;
const SCORE_RECORD_PATTERN = /^score_awarded_\d{4}-\d{2}-\d{2}$/;
const ENCRYPTED_RECORD_PATTERN = /^dmp_(?:diary|notes)_cipher_v1_\d{4}-\d{2}-\d{2}$/;

let busy = false;
let debounceTimer = null;
let localChangeVersion = 0;
let applyingRemoteBackup = 0;
let pendingAutoSave = false;
let pendingKeepalive = false;

const byId = id => document.getElementById(id);

function setStatus(message, state = 'info') {
  const elements = [byId('gist-auto-sync-status'), byId('gist-sync-status')].filter(Boolean);
  elements.forEach(element => {
    element.textContent = message;
    element.dataset.state = state;
  });
}

function setBusy(value) {
  busy = value;
  ['gist-backup-button', 'gist-restore-button'].forEach(id => {
    const button = byId(id);
    if (button) button.disabled = value;
  });
}

function getStoredCredentials() {
  try {
    const syncKey = localStorage.getItem(SYNC_KEY_STORAGE_KEY) || '';
    const passphrase = localStorage.getItem(PASSPHRASE_STORAGE_KEY) || '';
    if (syncKey.length >= 32 && passphrase.length >= 16) return { syncKey, passphrase };
  } catch (error) {
    console.warn('Saved Gist credentials could not be read:', error);
  }
  return null;
}

function validateCredentials(syncKey, passphrase) {
  if (typeof syncKey !== 'string' || syncKey.trim().length < 32) {
    throw new Error('Enter the Cloudflare Sync Key. It must be at least 32 characters.');
  }
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    throw new Error('Enter your separate Gist backup passphrase. Use at least 16 characters and the same passphrase on both devices.');
  }
  if (!window.isSecureContext || !window.crypto?.subtle || !window.crypto?.getRandomValues) {
    throw new Error('Secure browser encryption is unavailable. Open the app over HTTPS in a modern browser.');
  }
  return { syncKey: syncKey.trim(), passphrase };
}

function readCredentials() {
  const stored = getStoredCredentials();
  const enteredSyncKey = byId('gist-sync-key')?.value || '';
  const enteredPassphrase = byId('gist-backup-passphrase')?.value || '';
  return validateCredentials(
    enteredSyncKey.trim() || stored?.syncKey || '',
    enteredPassphrase || stored?.passphrase || ''
  );
}

function updateCredentialUi() {
  const enabled = Boolean(getStoredCredentials());
  byId('gist-forget-credentials')?.classList.toggle('hidden', !enabled);
  const button = byId('gist-enable-auto-sync');
  if (button) button.textContent = enabled
    ? 'Update keys & automatic sync'
    : 'Save keys & enable automatic sync';
  const status = byId('gist-auto-sync-status');
  if (status && !status.textContent) {
    status.textContent = enabled
      ? 'Automatic Gist sync is enabled on this device.'
      : 'Automatic Gist sync is not enabled on this device yet.';
  }
}

function clearCredentialInputs() {
  const syncKey = byId('gist-sync-key');
  const passphrase = byId('gist-backup-passphrase');
  if (syncKey) syncKey.value = '';
  if (passphrase) passphrase.value = '';
}

async function saveCredentialsAndEnableSync() {
  try {
    const credentials = validateCredentials(
      byId('gist-sync-key')?.value || '',
      byId('gist-backup-passphrase')?.value || ''
    );
    localStorage.setItem(SYNC_KEY_STORAGE_KEY, credentials.syncKey);
    localStorage.setItem(PASSPHRASE_STORAGE_KEY, credentials.passphrase);
    clearCredentialInputs();
    updateCredentialUi();
    setStatus('Automatic Gist sync is enabled on this device. Checking the cloud backup now…', 'info');
    await runAutomaticStartupSync();
  } catch (error) {
    setStatus(error.message || 'Automatic Gist sync could not be enabled.', 'error');
  }
}

function forgetSavedCredentials() {
  if (!window.confirm('Forget the saved Cloudflare Sync Key and Gist backup passphrase on this device? Your local records and cloud backup will remain unchanged.')) return;
  localStorage.removeItem(SYNC_KEY_STORAGE_KEY);
  localStorage.removeItem(PASSPHRASE_STORAGE_KEY);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  clearCredentialInputs();
  updateCredentialUi();
  setStatus('Saved keys were removed from this device. Local records and the Gist backup were not changed.', 'info');
}

async function workerRequest(method, { syncKey, etag, body, keepalive = false } = {}) {
  const headers = { Accept: 'application/json', 'X-Sync-Key': syncKey };
  let bodyText;
  if (body) {
    headers['Content-Type'] = 'application/json';
    bodyText = JSON.stringify(body);
  }
  if (etag) headers['If-Match'] = etag;

  const canKeepalive = Boolean(keepalive && (!bodyText
    || new TextEncoder().encode(bodyText).byteLength <= KEEPALIVE_BODY_LIMIT));

  let response;
  try {
    response = await fetch(WORKER_ENDPOINT, {
      method,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      keepalive: canKeepalive,
      headers,
      body: bodyText
    });
  } catch (error) {
    throw new Error('The secure Cloudflare sync service could not be reached. Check your connection and Worker deployment.');
  }

  let result = {};
  try { result = await response.json(); } catch (error) { result = {}; }
  if (!response.ok) {
    if (response.status === 401) throw new Error('The Cloud Sync Key was not accepted.');
    if (response.status === 409) throw new Error('The cloud backup changed on another device. Your local data was kept; load or resolve the latest cloud version before saving again.');
    if (response.status === 404) throw new Error('The configured Gist was not found. Check the GIST_ID Cloudflare Secret.');
    if (response.status === 413) throw new Error('The encrypted backup is too large for the configured Gist endpoint.');
    if (response.status === 428) throw new Error('The cloud backup version could not be checked. Load the latest Gist version before saving.');
    if (response.status === 429) throw new Error('Cloudflare rate-limited this sync request. Your local data is safe; automatic sync will retry after the next change or when you reopen the app.');
    if (response.status >= 500) throw new Error('The cloud backup service is temporarily unavailable (HTTP ' + response.status + '). Your local data is safe and will remain queued for a later retry.');
    throw new Error(result.error || 'Cloud sync failed (HTTP ' + response.status + ').');
  }
  return result;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveBackupKey(passphrase, salt) {
  const material = await window.crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: BACKUP_KDF_ITERATIONS, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function encryptBackup(payload, passphrase) {
  const serialized = JSON.stringify(payload);
  const compressed = await compressData(serialized);
  const compression = compressed === serialized ? 'none' : 'gzip-base64';
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(passphrase, salt);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(BACKUP_AAD), tagLength: 128 },
    key, new TextEncoder().encode(compressed)
  );
  const envelope = JSON.stringify({
    format: ENVELOPE_FORMAT, version: 1, algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-HMAC-SHA-256', iterations: BACKUP_KDF_ITERATIONS, compression,
    salt: bytesToBase64(salt), iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  });
  if (new TextEncoder().encode(envelope).byteLength > MAX_BACKUP_FILE_BYTES) {
    throw new Error('This backup exceeds the safe Gist file size. No data was uploaded. Reduce large voice-note archives or use the optional Google Drive backup.');
  }
  return envelope;
}

async function decryptBackup(envelopeText, passphrase) {
  let envelope;
  try { envelope = JSON.parse(envelopeText); }
  catch (error) { throw new Error('The Gist backup is not a valid encrypted backup file.'); }

  if (!envelope || envelope.format !== ENVELOPE_FORMAT || envelope.version !== 1
      || envelope.algorithm !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-HMAC-SHA-256'
      || envelope.iterations !== BACKUP_KDF_ITERATIONS
      || !['none', 'gzip-base64'].includes(envelope.compression)
      || typeof envelope.salt !== 'string' || typeof envelope.iv !== 'string'
      || typeof envelope.ciphertext !== 'string'
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.salt)
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.iv)
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext)) {
    throw new Error('The Gist backup has an unsupported or damaged encryption format.');
  }

  let plaintext;
  try {
    const key = await deriveBackupKey(passphrase, base64ToBytes(envelope.salt));
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(envelope.iv), additionalData: new TextEncoder().encode(BACKUP_AAD), tagLength: 128 },
      key, base64ToBytes(envelope.ciphertext)
    );
    plaintext = new TextDecoder().decode(decrypted);
  } catch (error) {
    throw new Error('The Gist backup could not be decrypted. Check the separate backup passphrase or the integrity of the file.');
  }

  if (envelope.compression === 'gzip-base64') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress the backup. Open it on a modern browser and try again.');
    const decompressed = await decompressData(plaintext);
    if (decompressed === plaintext) throw new Error('The compressed backup could not be decoded. No local data was changed.');
    plaintext = decompressed;
  }
  try { return JSON.parse(plaintext); }
  catch (error) { throw new Error('The decrypted backup is damaged. No local data was changed.'); }
}

async function fetchCurrentBackup(syncKey) {
  const result = await workerRequest('GET', { syncKey });
  if ((result.content !== null && typeof result.content !== 'string')
      || typeof result.etag !== 'string' || !result.etag) {
    throw new Error('The Worker returned an incomplete backup response. Check the Worker deployment.');
  }
  if (result.truncated) throw new Error('GitHub truncated this Gist file at its API size limit. No data was restored.');
  return result;
}

async function fingerprintPayload(payload) {
  const records = Object.fromEntries(Object.entries(payload.records || {}).sort(([left], [right]) => left.localeCompare(right)));
  const voiceNotes = [...(payload.voiceNotes || [])].sort((left, right) => left.id.localeCompare(right.id));
  const canonical = JSON.stringify({ format: payload.format, version: payload.version, records, voiceNotes });
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function hasMeaningfulLocalProgress(payload) {
  if (Array.isArray(payload.voiceNotes) && payload.voiceNotes.length) return true;
  for (const [key, raw] of Object.entries(payload.records || {})) {
    if (key === GARDEN_STORAGE_KEY || key === WRITING_CONFIG_KEY || ENCRYPTED_RECORD_PATTERN.test(key)) return true;
    if (key === 'user_confidence_score' && Number.parseInt(raw, 10) > 0) return true;
    if (SCORE_RECORD_PATTERN.test(key) && raw === 'true') return true;
    if (DAILY_RECORD_PATTERN.test(key)) {
      let daily;
      try { daily = JSON.parse(raw); } catch (error) { return true; }
      if (Object.entries(daily || {}).some(([field, value]) => field !== 'cloud_flow_version'
        && (value === true || (typeof value === 'string' && value.length > 0)))) return true;
    }
  }
  return false;
}

function storeSyncMarkers(etag, fingerprint) {
  localStorage.setItem(ETAG_STORAGE_KEY, etag);
  localStorage.setItem(FINGERPRINT_STORAGE_KEY, fingerprint);
  localStorage.removeItem(DIRTY_STORAGE_KEY);
}

function markDirty() {
  try { localStorage.setItem(DIRTY_STORAGE_KEY, '1'); } catch (error) {
    console.warn('The pending Gist sync marker could not be saved:', error);
  }
}

function markConflict(message) {
  setStatus(message, 'error');
}

async function applyRemoteBackup(payload, etag, fingerprint, message) {
  applyingRemoteBackup += 1;
  try {
    await restoreBackupPayload(payload);
  } finally {
    applyingRemoteBackup -= 1;
  }
  storeSyncMarkers(etag, fingerprint);
  pendingAutoSave = false;
  pendingKeepalive = false;
  setStatus(message || 'A newer encrypted Gist backup was loaded onto this device. Refreshing the app to display the latest records…', 'success');
  window.setTimeout(() => window.location.reload(), 500);
}

async function runAutomaticStartupSync() {
  const credentials = getStoredCredentials();
  if (!credentials) {
    updateCredentialUi();
    return;
  }
  if (busy) return;

  setBusy(true);
  let scheduleSave = false;
  try {
    setStatus('Checking the encrypted Gist backup for newer progress…', 'info');
    const remote = await fetchCurrentBackup(credentials.syncKey);
    const knownEtag = localStorage.getItem(ETAG_STORAGE_KEY);
    const localPayload = await createBackupPayload();
    const localFingerprint = await fingerprintPayload(localPayload);
    const dirty = localStorage.getItem(DIRTY_STORAGE_KEY) === '1';

    if (remote.content === null) {
      if (knownEtag && knownEtag !== remote.etag) {
        markConflict('The cloud backup is now empty or has been replaced since this device last synced. Your local records were kept. Review the backup in Settings before continuing.');
        return;
      }
      localStorage.setItem(ETAG_STORAGE_KEY, remote.etag);
      if (hasMeaningfulLocalProgress(localPayload)) {
        markDirty();
        scheduleSave = true;
        setStatus('No Gist backup exists yet. Your existing local progress will be saved to the encrypted Gist.', 'info');
      } else {
        storeSyncMarkers(remote.etag, localFingerprint);
        setStatus('Automatic Gist sync is ready. Your local data will be backed up after your first progress change.', 'success');
      }
      return;
    }

    const remotePayload = await decryptBackup(remote.content, credentials.passphrase);
    validateBackup(remotePayload);
    const remoteFingerprint = await fingerprintPayload(remotePayload);

    if (localFingerprint === remoteFingerprint) {
      storeSyncMarkers(remote.etag, remoteFingerprint);
      setStatus('Your local records and encrypted Gist backup are already in sync.', 'success');
      return;
    }

    if (!knownEtag) {
      if (!hasMeaningfulLocalProgress(localPayload)) {
        await applyRemoteBackup(
          remotePayload, remote.etag, remoteFingerprint,
          'Your existing encrypted Gist backup was loaded onto this new device. Refreshing the app…'
        );
      } else {
        markConflict('An encrypted Gist backup exists, but this device has local progress and no previous sync history. To protect those records, automatic first-time import is paused. Use Restore From Gist in the Settings manual fallback after reviewing the confirmation.');
      }
      return;
    }

    if (knownEtag === remote.etag) {
      markDirty();
      scheduleSave = true;
      setStatus('Local progress is newer than the last cloud save. Saving the local changes to Gist…', 'info');
      return;
    }

    const previousFingerprint = localStorage.getItem(FINGERPRINT_STORAGE_KEY);
    const localIsUnchanged = Boolean(previousFingerprint && localFingerprint === previousFingerprint);
    if (localIsUnchanged && !dirty) {
      await applyRemoteBackup(
        remotePayload, remote.etag, remoteFingerprint,
        'A newer Gist backup was found. Your unchanged local records were updated from the cloud. Refreshing the app…'
      );
      return;
    }

    markConflict('Another device has updated the Gist while this device also has local changes. Your local data was kept and no automatic overwrite was made. Open Settings and use the manual restore only after reviewing both devices.');
  } catch (error) {
    console.error('Automatic Gist startup sync failed:', error);
    setStatus(error.message || 'Automatic Gist sync could not finish. Your local records remain available.', 'error');
  } finally {
    setBusy(false);
    updateCredentialUi();
    if (scheduleSave && getStoredCredentials()) scheduleAutoSave(250);
  }
}

async function autoSaveNow({ keepalive = false } = {}) {
  const credentials = getStoredCredentials();
  if (!credentials) return;
  if (busy) {
    pendingAutoSave = true;
    pendingKeepalive = pendingKeepalive || keepalive;
    return;
  }

  setBusy(true);
  let scheduleAnotherSave = false;
  try {
    const payload = await createBackupPayload();
    const fingerprint = await fingerprintPayload(payload);
    const snapshotVersion = localChangeVersion;
    const remote = await fetchCurrentBackup(credentials.syncKey);
    const knownEtag = localStorage.getItem(ETAG_STORAGE_KEY);

    if (remote.content !== null) {
      const remotePayload = await decryptBackup(remote.content, credentials.passphrase);
      validateBackup(remotePayload);
      const remoteFingerprint = await fingerprintPayload(remotePayload);

      if (fingerprint === remoteFingerprint) {
        storeSyncMarkers(remote.etag, remoteFingerprint);
        setStatus('Automatic sync complete. This device and the encrypted Gist backup match.', 'success');
        return;
      }

      if (!knownEtag) {
        if (!hasMeaningfulLocalProgress(payload)) {
          await applyRemoteBackup(
            remotePayload, remote.etag, remoteFingerprint,
            'The existing encrypted Gist backup was loaded onto this device. Refreshing the app…'
          );
        } else {
          markConflict('A cloud backup already exists and this device has no sync history. Local records were kept. Use the manual restore in Settings only after reviewing the local data.');
        }
        return;
      }

      if (knownEtag !== remote.etag) {
        const previousFingerprint = localStorage.getItem(FINGERPRINT_STORAGE_KEY);
        if (previousFingerprint && fingerprint === previousFingerprint && localChangeVersion === snapshotVersion) {
          await applyRemoteBackup(
            remotePayload, remote.etag, remoteFingerprint,
            'A newer Gist backup was found. Your unchanged local records were updated from the cloud. Refreshing the app…'
          );
        } else {
          markConflict('Another device changed the Gist before this save. Your local changes were kept and were not uploaded. Reconcile the devices in Settings before continuing.');
        }
        return;
      }
    } else {
      if (knownEtag && knownEtag !== remote.etag) {
        markConflict('The cloud backup was emptied or replaced since this device last synced. Your local records were kept and were not uploaded.');
        return;
      }
      if (!knownEtag) localStorage.setItem(ETAG_STORAGE_KEY, remote.etag);
    }

    if (localStorage.getItem(DIRTY_STORAGE_KEY) !== '1'
        && localStorage.getItem(FINGERPRINT_STORAGE_KEY) === fingerprint) {
      setStatus('Automatic Gist sync is up to date.', 'success');
      return;
    }

    const encryptedContent = await encryptBackup(payload, credentials.passphrase);
    await workerRequest('PUT', {
      syncKey: credentials.syncKey,
      etag: remote.etag,
      body: { description: BACKUP_DESCRIPTION, files: { [BACKUP_FILE_NAME]: { content: encryptedContent } } },
      keepalive
    });

    const verified = await fetchCurrentBackup(credentials.syncKey);
    if (verified.content !== encryptedContent) {
      markConflict('The Gist changed while this device was saving. The cloud version was not accepted as a confirmed save; your local records remain available.');
      return;
    }
    if (!verified.etag) throw new Error('The Worker did not return a version identifier after saving.');

    localStorage.setItem(ETAG_STORAGE_KEY, verified.etag);
    localStorage.setItem(FINGERPRINT_STORAGE_KEY, fingerprint);
    if (localChangeVersion === snapshotVersion) {
      localStorage.removeItem(DIRTY_STORAGE_KEY);
      setStatus('Encrypted Gist backup saved and verified automatically.', 'success');
    } else {
      markDirty();
      scheduleAnotherSave = true;
      setStatus('A background backup completed. More local edits arrived during the upload, so another save is queued.', 'info');
    }
  } catch (error) {
    console.error('Automatic Gist save failed:', error);
    markDirty();
    setStatus(error.message || 'Automatic Gist save failed. Your local records are safe; another attempt will occur after the next change or when the app is reopened.', 'error');
  } finally {
    setBusy(false);
    if (scheduleAnotherSave) scheduleAutoSave(250);
    if (pendingAutoSave) {
      const retryKeepalive = pendingKeepalive;
      pendingAutoSave = false;
      pendingKeepalive = false;
      scheduleAutoSave(retryKeepalive ? 100 : 250, retryKeepalive);
    }
  }
}

function scheduleAutoSave(delay = 2000, keepalive = false) {
  if (!getStoredCredentials()) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    autoSaveNow({ keepalive }).catch(error => {
      console.error('Debounced Gist save failed:', error);
    });
  }, delay);
}

function isSyncableStorageKey(key) {
  return key === GARDEN_STORAGE_KEY
    || key === 'user_confidence_score'
    || key === WRITING_CONFIG_KEY
    || DAILY_RECORD_PATTERN.test(key)
    || SCORE_RECORD_PATTERN.test(key)
    || ENCRYPTED_RECORD_PATTERN.test(key);
}

function onLocalDataChanged() {
  if (applyingRemoteBackup) return;
  localChangeVersion += 1;
  markDirty();
  scheduleAutoSave(2000);
}

function installLocalStorageHooks() {
  const prototype = window.Storage?.prototype;
  if (!prototype) return;

  const originalSetItem = prototype.setItem;
  if (!originalSetItem.__faithFocusGistHooked) {
    const wrappedSetItem = function (key, value) {
      const result = originalSetItem.call(this, key, value);
      if (this === window.localStorage && isSyncableStorageKey(String(key))) onLocalDataChanged();
      return result;
    };
    Object.defineProperty(wrappedSetItem, '__faithFocusGistHooked', { value: true });
    prototype.setItem = wrappedSetItem;
  }

  const originalRemoveItem = prototype.removeItem;
  if (!originalRemoveItem.__faithFocusGistHooked) {
    const wrappedRemoveItem = function (key) {
      const result = originalRemoveItem.call(this, key);
      if (this === window.localStorage && isSyncableStorageKey(String(key))) onLocalDataChanged();
      return result;
    };
    Object.defineProperty(wrappedRemoveItem, '__faithFocusGistHooked', { value: true });
    prototype.removeItem = wrappedRemoveItem;
  }
}

function flushOnHide() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  if (getStoredCredentials() && localStorage.getItem(DIRTY_STORAGE_KEY) === '1') {
    autoSaveNow({ keepalive: true }).catch(error => {
      console.error('Last-chance Gist save could not finish:', error);
    });
  }
  clearCredentialInputs();
}

async function backupToGist() {
  if (busy) return;
  let credentials;
  try { credentials = readCredentials(); }
  catch (error) { setStatus(error.message, 'error'); return; }

  setBusy(true);
  setStatus('Preparing and encrypting your checklist, Garden, Diary, and voice-note records on this device…');
  try {
    const current = await fetchCurrentBackup(credentials.syncKey);
    const savedEtag = localStorage.getItem(ETAG_STORAGE_KEY);

    if (current.content !== null && (!savedEtag || savedEtag !== current.etag)) {
      throw new Error('This device has not loaded the latest Gist backup, or another device has updated it. Restore the latest version first. Your local records were not changed.');
    }
    if (current.content === null && savedEtag && savedEtag !== current.etag) {
      throw new Error('The Gist backup changed or was removed after this device last synced. Load the latest Gist state before saving.');
    }

    const payload = await createBackupPayload();
    const fingerprint = await fingerprintPayload(payload);
    validateBackup(payload);
    const encryptedContent = await encryptBackup(payload, credentials.passphrase);
    const updated = await workerRequest('PUT', {
      syncKey: credentials.syncKey, etag: current.etag,
      body: { description: BACKUP_DESCRIPTION, files: { [BACKUP_FILE_NAME]: { content: encryptedContent } } }
    });

    const verified = await fetchCurrentBackup(credentials.syncKey);
    if (verified.content !== encryptedContent) {
      throw new Error('The Gist changed during the save. Another update may have arrived. Restore the latest version before trying again.');
    }
    const nextEtag = verified.etag || updated.etag;
    if (!nextEtag) throw new Error('The backup was uploaded, but the Worker did not return a version identifier. Load the Gist before another save.');

    storeSyncMarkers(nextEtag, fingerprint);
    setStatus('Encrypted Gist backup saved and verified. Automatic background sync is now up to date on this device.', 'success');
  } catch (error) {
    console.error('Encrypted Gist backup failed:', error);
    setStatus(error.message || 'Gist backup failed. Your local records have not been changed.', 'error');
  } finally {
    setBusy(false);
  }
}

async function restoreFromGist() {
  if (busy) return;
  let credentials;
  try { credentials = readCredentials(); }
  catch (error) { setStatus(error.message, 'error'); return; }

  setBusy(true);
  setStatus('Loading the encrypted Gist backup…');
  try {
    const remote = await fetchCurrentBackup(credentials.syncKey);
    if (remote.content === null) {
      localStorage.removeItem(ETAG_STORAGE_KEY);
      localStorage.removeItem(FINGERPRINT_STORAGE_KEY);
      setStatus('The configured Gist is ready, but no Faith & Focus backup has been saved yet. Save from the device containing your current data first.');
      return;
    }

    const downloaded = await decryptBackup(remote.content, credentials.passphrase);
    const records = validateBackup(downloaded);
    const recordCount = Object.keys(records).length;
    if (!window.confirm('Restore the latest encrypted Gist backup to this device? Matching records and encrypted voice notes may be replaced by the cloud copy. Your app PIN and location history are not included.')) return;

    applyingRemoteBackup += 1;
    try {
      await restoreBackupPayload(downloaded);
    } finally {
      applyingRemoteBackup -= 1;
    }
    const fingerprint = await fingerprintPayload(downloaded);
    storeSyncMarkers(remote.etag, fingerprint);
    setStatus('Restored ' + recordCount + ' app records and encrypted voice notes. Reloading the app…', 'success');
    window.setTimeout(() => window.location.reload(), 800);
  } catch (error) {
    console.error('Encrypted Gist restore failed:', error);
    setStatus(error.message || 'Gist restore failed. Existing local records were preserved.', 'error');
  } finally { setBusy(false); }
}

function initGistSync() {
  const backupButton = byId('gist-backup-button');
  const restoreButton = byId('gist-restore-button');
  const enableButton = byId('gist-enable-auto-sync');
  const forgetButton = byId('gist-forget-credentials');
  if (!backupButton || !restoreButton || !enableButton) return;

  backupButton.addEventListener('click', backupToGist);
  restoreButton.addEventListener('click', restoreFromGist);
  enableButton.addEventListener('click', saveCredentialsAndEnableSync);
  forgetButton?.addEventListener('click', forgetSavedCredentials);

  installLocalStorageHooks();
  window.addEventListener('faith-focus:local-data-changed', onLocalDataChanged);
  window.addEventListener('storage', event => {
    if (event.storageArea === window.localStorage && event.key && isSyncableStorageKey(event.key)) {
      onLocalDataChanged();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide();
  });
  window.addEventListener('pagehide', flushOnHide);
  window.addEventListener('faith-focus:app-unlocked', runAutomaticStartupSync);
  window.addEventListener('online', runAutomaticStartupSync);

  updateCredentialUi();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGistSync, { once: true });
else initGistSync();

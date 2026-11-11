import { compressData, decompressData } from './compressor.js';
import { createBackupPayload, restoreBackupPayload, validateBackup } from './drive-sync.js';

const WORKER_ENDPOINT = 'https://faith-focus-proxy.nine-westhigh.workers.dev/backup';
const BACKUP_FILE_NAME = 'faith-focus-daily-armor.enc.json';
const BACKUP_DESCRIPTION = 'Faith & Focus: Daily Armor encrypted device backup';
const ETAG_STORAGE_KEY = 'faith_focus_gist_etag_v1';
const ENVELOPE_FORMAT = 'faith-focus-daily-armor-encrypted-backup';
const BACKUP_KDF_ITERATIONS = 600000;
const BACKUP_AAD = 'Faith & Focus: Daily Armor|cloud-backup|v1';
const MAX_BACKUP_FILE_BYTES = 900000;

let busy = false;
const byId = id => document.getElementById(id);

function setStatus(message, state = 'info') {
  const element = byId('gist-sync-status');
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}

function setBusy(value) {
  busy = value;
  ['gist-backup-button', 'gist-restore-button'].forEach(id => {
    const button = byId(id);
    if (button) button.disabled = value;
  });
}

function readCredentials() {
  const syncKey = byId('gist-sync-key')?.value || '';
  const passphrase = byId('gist-backup-passphrase')?.value || '';
  if (syncKey.length < 32) throw new Error('Enter the Cloudflare Sync Key. It must be at least 32 characters.');
  if (passphrase.length < 16) throw new Error('Enter your separate Gist backup passphrase. Use at least 16 characters and the same passphrase on both devices.');
  if (!window.isSecureContext || !window.crypto?.subtle || !window.crypto?.getRandomValues) {
    throw new Error('Secure browser encryption is unavailable. Open the app over HTTPS in a modern browser.');
  }
  return { syncKey, passphrase };
}

async function workerRequest(method, { syncKey, etag, body } = {}) {
  const headers = { Accept: 'application/json', 'X-Sync-Key': syncKey };
  if (body) headers['Content-Type'] = 'application/json';
  if (etag) headers['If-Match'] = etag;

  let response;
  try {
    response = await fetch(WORKER_ENDPOINT, {
      method, mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers, body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    throw new Error('The secure Cloudflare sync service could not be reached. Check your connection and Worker deployment.');
  }

  let result = {};
  try { result = await response.json(); } catch (error) { result = {}; }
  if (!response.ok) {
    if (response.status === 401) throw new Error('The Cloud Sync Key was not accepted.');
    if (response.status === 409) throw new Error('The cloud backup changed after this device last loaded it. Restore the latest Gist version before saving again. Your local data was not changed.');
    if (response.status === 404) throw new Error('The configured Gist was not found. Check the GIST_ID Cloudflare Secret.');
    if (response.status === 413) throw new Error('The encrypted backup is too large for the configured Gist endpoint.');
    if (response.status === 428) throw new Error('The cloud backup version could not be checked. Load the latest Gist version before saving.');
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

async function backupToGist() {
  if (busy) return;
  let credentials;
  try { credentials = readCredentials(); }
  catch (error) { setStatus(error.message, 'error'); return; }

  setBusy(true);
  setStatus('Preparing and encrypting your checklist, garden, Diary, and voice-note records on this device…');
  try {
    const current = await fetchCurrentBackup(credentials.syncKey);
    const savedEtag = localStorage.getItem(ETAG_STORAGE_KEY);

    if (current.content !== null && (!savedEtag || savedEtag !== current.etag)) {
      throw new Error('This device has not loaded the latest Gist backup, or another device has updated it. Select Restore From Gist first. Your local records were not changed.');
    }
    if (current.content === null && savedEtag && savedEtag !== current.etag) {
      throw new Error('The Gist backup changed or was removed after this device last synced. Load the latest Gist state before saving.');
    }

    const payload = await createBackupPayload();
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

    try { localStorage.setItem(ETAG_STORAGE_KEY, nextEtag); }
    catch (error) {
      setStatus('The encrypted Gist backup was saved, but this browser could not store its version marker. Load the Gist before the next save.', 'error');
      return;
    }
    setStatus('Encrypted Gist backup saved and verified. Load it on your other device before editing there.', 'success');
  } catch (error) {
    console.error('Encrypted Gist backup failed:', error);
    setStatus(error.message || 'Gist backup failed. Your local records have not been changed.', 'error');
  } finally { setBusy(false); }
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
      setStatus('The configured Gist is ready, but no Faith & Focus backup has been saved yet. Save from the device containing your current data first.');
      return;
    }

    const downloaded = await decryptBackup(remote.content, credentials.passphrase);
    const records = validateBackup(downloaded);
    const recordCount = Object.keys(records).length;
    if (!window.confirm('Restore the latest encrypted Gist backup to this device? Matching records and encrypted voice notes may be replaced by the cloud copy. Your app PIN and location history are not included.')) return;

    await restoreBackupPayload(downloaded);
    localStorage.setItem(ETAG_STORAGE_KEY, remote.etag);
    setStatus('Restored ' + recordCount + ' app records and encrypted voice notes. Reloading the app…', 'success');
    window.setTimeout(() => window.location.reload(), 800);
  } catch (error) {
    console.error('Encrypted Gist restore failed:', error);
    setStatus(error.message || 'Gist restore failed. Existing local records were preserved.', 'error');
  } finally { setBusy(false); }
}

export function initGistSync() {
  const backupButton = byId('gist-backup-button');
  const restoreButton = byId('gist-restore-button');
  if (!backupButton || !restoreButton) return;
  backupButton.addEventListener('click', backupToGist);
  restoreButton.addEventListener('click', restoreFromGist);
  window.addEventListener('pagehide', () => {
    const syncKey = byId('gist-sync-key');
    const passphrase = byId('gist-backup-passphrase');
    if (syncKey) syncKey.value = '';
    if (passphrase) passphrase.value = '';
  }, { once: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGistSync, { once: true });
else initGistSync();

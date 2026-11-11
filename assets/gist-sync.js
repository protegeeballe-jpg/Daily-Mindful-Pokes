import { compressData, decompressData } from './compressor.js';
import { collectBackupRecords, validateBackup } from './drive-sync.js';

const WORKER_ENDPOINT = 'https://faith-focus-proxy.nine-westhigh.workers.dev/backup';
const BACKUP_FILE_NAME = 'faith-focus-daily-armor.enc.json';
const BACKUP_DESCRIPTION = 'Faith & Focus: Daily Armor encrypted device backup';
const INITIAL_CONTENT = 'INITIALIZE_FAITH_FOCUS_BACKUP';
const ETAG_STORAGE_KEY = 'faith_focus_gist_etag_v1';
const ENVELOPE_FORMAT = 'faith-focus-daily-armor-encrypted-backup';
const BACKUP_KDF_ITERATIONS = 600000;
const BACKUP_AAD = 'Faith & Focus: Daily Armor|cloud-backup|v1';

let busy = false;

const byId = id => document.getElementById(id);

function setStatus(message) {
  const element = byId('gist-sync-status');
  if (element) element.textContent = message;
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

  if (syncKey.length < 32) {
    throw new Error('Enter the Cloudflare Sync Key. It must be at least 32 characters.');
  }
  if (passphrase.length < 16) {
    throw new Error('Enter the same private-writing passphrase used by your encrypted Diary (at least 16 characters).');
  }
  if (!window.isSecureContext || !window.crypto?.subtle || !window.crypto?.getRandomValues) {
    throw new Error('Secure browser encryption is unavailable. Open the app over HTTPS in a modern browser.');
  }

  return { syncKey, passphrase };
}

async function workerRequest(method, { syncKey, etag, body } = {}) {
  const headers = {
    Accept: 'application/json',
    'X-Sync-Key': syncKey
  };
  if (body) headers['Content-Type'] = 'application/json';
  if (etag) headers['If-Match'] = etag;

  let response;
  try {
    response = await fetch(WORKER_ENDPOINT, {
      method,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    throw new Error('The secure Cloudflare sync service could not be reached. Check your connection and Worker deployment.');
  }

  let result = {};
  try {
    result = await response.json();
  } catch (error) {
    result = {};
  }

  if (!response.ok) {
    if (response.status === 401) throw new Error('The Cloud Sync Key was not accepted.');
    if (response.status === 409) throw new Error('The cloud backup changed on another device. Restore the latest backup before saving again. Your local data was not changed.');
    if (response.status === 404) throw new Error('The configured Gist or backup file was not found. Check the GIST_ID Cloudflare Secret and the required filename.');
    if (response.status === 413) throw new Error('The encrypted backup is too large for the configured Gist endpoint.');
    if (response.status === 428) throw new Error('The cloud backup version could not be checked. Restore the latest backup before saving.');
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
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveBackupKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: BACKUP_KDF_ITERATIONS,
      hash: 'SHA-256'
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptBackup(payload, passphrase) {
  const serialized = JSON.stringify(payload);
  const compressed = await compressData(serialized);
  const compression = compressed === serialized ? 'none' : 'gzip-base64';
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(BACKUP_AAD),
      tagLength: 128
    },
    key,
    new TextEncoder().encode(compressed)
  );

  return JSON.stringify({
    format: ENVELOPE_FORMAT,
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-HMAC-SHA-256',
    iterations: BACKUP_KDF_ITERATIONS,
    compression,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  });
}

async function decryptBackup(envelopeText, passphrase) {
  let envelope;
  try {
    envelope = JSON.parse(envelopeText);
  } catch (error) {
    throw new Error('The Gist backup is not a valid encrypted backup file.');
  }

  if (!envelope
      || envelope.format !== ENVELOPE_FORMAT
      || envelope.version !== 1
      || envelope.algorithm !== 'AES-256-GCM'
      || envelope.kdf !== 'PBKDF2-HMAC-SHA-256'
      || envelope.iterations !== BACKUP_KDF_ITERATIONS
      || !['none', 'gzip-base64'].includes(envelope.compression)
      || typeof envelope.salt !== 'string'
      || typeof envelope.iv !== 'string'
      || typeof envelope.ciphertext !== 'string'
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.salt)
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.iv)
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext)) {
    throw new Error('The Gist backup has an unsupported or damaged encryption format.');
  }

  let plaintext;
  try {
    const key = await deriveBackupKey(passphrase, base64ToBytes(envelope.salt));
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(envelope.iv),
        additionalData: new TextEncoder().encode(BACKUP_AAD),
        tagLength: 128
      },
      key,
      base64ToBytes(envelope.ciphertext)
    );
    plaintext = new TextDecoder().decode(decrypted);
  } catch (error) {
    throw new Error('The passphrase did not decrypt this backup. Check that you entered the same private-writing passphrase used when it was saved.');
  }

  if (envelope.compression === 'gzip-base64') {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot decompress the backup. Open it on a modern browser and try again.');
    }
    const decompressed = await decompressData(plaintext);
    if (decompressed === plaintext) {
      throw new Error('The compressed backup could not be decoded. No local data was changed.');
    }
    plaintext = decompressed;
  }

  try {
    return JSON.parse(plaintext);
  } catch (error) {
    throw new Error('The decrypted backup is damaged. No local data was changed.');
  }
}

async function fetchCurrentBackup(syncKey) {
  const result = await workerRequest('GET', { syncKey });
  if (typeof result.content !== 'string' || typeof result.etag !== 'string' || !result.etag) {
    throw new Error('The Worker returned an incomplete backup response.');
  }
  if (result.truncated) {
    throw new Error('GitHub truncated this Gist file at its API size limit. No data was restored.');
  }
  return result;
}

async function backupToGist() {
  if (busy) return;
  let credentials;
  try {
    credentials = readCredentials();
  } catch (error) {
    setStatus(error.message);
    return;
  }

  setBusy(true);
  setStatus('Preparing and encrypting your checklist, garden, and private-writing records on this device…');
  try {
    const current = await fetchCurrentBackup(credentials.syncKey);
    const savedEtag = localStorage.getItem(ETAG_STORAGE_KEY);

    if (current.content !== INITIAL_CONTENT
        && (!savedEtag || savedEtag !== current.etag)) {
      throw new Error('This device has not restored the latest Gist backup, or another device has updated it. Select Restore From Gist first. Your current local records were not changed.');
    }

    const records = collectBackupRecords();
    const payload = {
      format: 'faith-focus-daily-armor-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      records
    };
    validateBackup(payload);
    const encryptedContent = await encryptBackup(payload, credentials.passphrase);

    const updated = await workerRequest('PUT', {
      syncKey: credentials.syncKey,
      etag: current.etag,
      body: {
        description: BACKUP_DESCRIPTION,
        files: {
          [BACKUP_FILE_NAME]: { content: encryptedContent }
        }
      }
    });

    if (!updated.etag) {
      throw new Error('The backup was uploaded, but the Worker did not return a version identifier. Restore before attempting another save.');
    }

    localStorage.setItem(ETAG_STORAGE_KEY, updated.etag);
    setStatus('Encrypted Gist backup saved. Restore it on your other device before making changes there.');
  } catch (error) {
    console.error('Encrypted Gist backup failed:', error);
    setStatus(error.message || 'Gist backup failed. Your local records have not been changed.');
  } finally {
    setBusy(false);
  }
}

async function restoreFromGist() {
  if (busy) return;
  let credentials;
  try {
    credentials = readCredentials();
  } catch (error) {
    setStatus(error.message);
    return;
  }

  if (!window.confirm('Restore the latest encrypted Gist backup to this device? Records with matching keys may be replaced by the cloud copy. Your app PIN and location history are not included.')) return;

  setBusy(true);
  setStatus('Loading the encrypted Gist backup…');
  try {
    const remote = await fetchCurrentBackup(credentials.syncKey);
    if (remote.content === INITIAL_CONTENT) {
      setStatus('The Gist is ready, but no backup has been saved yet. Save a backup from your first device.');
      return;
    }

    const downloaded = await decryptBackup(remote.content, credentials.passphrase);
    const records = validateBackup(downloaded);

    const previous = new Map();
    for (const key of Object.keys(records)) previous.set(key, localStorage.getItem(key));
    try {
      for (const [key, value] of Object.entries(records)) {
        localStorage.setItem(key, value);
      }
    } catch (writeError) {
      for (const [key, value] of previous) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      throw writeError;
    }

    localStorage.setItem(ETAG_STORAGE_KEY, remote.etag);
    setStatus('Restore completed. Reloading the app to show the restored records…');
    window.setTimeout(() => window.location.reload(), 800);
  } catch (error) {
    console.error('Encrypted Gist restore failed:', error);
    setStatus(error.message || 'Gist restore failed. Existing local records were preserved.');
  } finally {
    setBusy(false);
  }
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGistSync, { once: true });
} else {
  initGistSync();
}

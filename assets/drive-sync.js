import { compressData, decompressData } from './compressor.js';
import { GARDEN_STORAGE_KEY, validateGardenState } from './garden-model.js';
import {
  WRITING_CONFIG_KEY, WRITING_DIARY_PREFIX, WRITING_NOTES_PREFIX, PRIVATE_NOTE_IDS
} from './writing-security.js';

const GOOGLE_CLIENT_ID = '717523562646-lht84sbcpfnn6q330nd5683pjc59dhdh.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_FILE_NAME = 'faith-focus-armor-backup.gz';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const ENCRYPTED_RECORD_PATTERN = /^dmp_(?:diary|notes)_cipher_v1_\\d{4}-\\d{2}-\\d{2}$/;
const DAILY_RECORD_PATTERN = /^mindful_pokes_data_\\d{4}-\\d{2}-\\d{2}$/;
const SCORE_RECORD_PATTERN = /^score_awarded_\\d{4}-\\d{2}-\\d{2}$/;

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let identityScriptPromise = null;
let busy = false;

const byId = id => document.getElementById(id);
const status = message => {
  const element = byId('drive-sync-status');
  if (element) element.textContent = message;
};
const setBusy = value => {
  busy = value;
  ['drive-connect-button', 'drive-backup-button', 'drive-restore-button'].forEach(id => {
    const button = byId(id);
    if (button) button.disabled = value;
  });
};

function isAllowedStorageKey(key) {
  const allowed = key => key === GARDEN_STORAGE_KEY;
  return allowed(key)
    || key === 'user_confidence_score'
    || key === WRITING_CONFIG_KEY
    || DAILY_RECORD_PATTERN.test(key)
    || SCORE_RECORD_PATTERN.test(key)
    || ENCRYPTED_RECORD_PATTERN.test(key);
}

function isEncryptedRecord(value) {
  try {
    const record = typeof value === 'string' ? JSON.parse(value) : value;
    return !!record
      && record.version === 1
      && record.algorithm === 'AES-256-GCM'
      && typeof record.iv === 'string'
      && typeof record.ciphertext === 'string'
      && /^[A-Za-z0-9+/]+={0,2}$/.test(record.iv)
      && /^[A-Za-z0-9+/]+={0,2}$/.test(record.ciphertext);
  } catch (error) {
    return false;
  }
}

function getLegacyPrivateContent(records) {
  const legacyPrivateContent = [];
  for (const [key, raw] of records) {
    if (!DAILY_RECORD_PATTERN.test(key)) continue;
    try {
      const data = JSON.parse(raw);
      for (const id of PRIVATE_NOTE_IDS) {
        if (typeof data?.[id] === 'string' && data[id].length > 0) {
          legacyPrivateContent.push({ key, id });
        }
      }
    } catch (error) {
      throw new Error('A checklist record is damaged. Nothing was uploaded.');
    }
  }
  return legacyPrivateContent;
}

function collectBackupRecords() {
  const records = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !isAllowedStorageKey(key)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;

    if (DAILY_RECORD_PATTERN.test(key)) {
      let data;
      try { data = JSON.parse(raw); }
      catch (error) { throw new Error('A checklist record is damaged. Nothing was uploaded.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('A checklist record has an unsupported format.');
      }
      const clean = { ...data };
      PRIVATE_NOTE_IDS.forEach(id => delete clean[id]);
      records[key] = JSON.stringify(clean);
    } else {
      records[key] = raw;
    }
  }

  const legacyPrivateContent = getLegacyPrivateContent(
    Object.entries(Object.fromEntries(
      Object.keys(records).map(key => [key, localStorage.getItem(key)])
    ))
  );
  if (legacyPrivateContent.length) {
    throw new Error('Some older checklist reflections are still plain text. Open and secure your private writing before creating a cloud backup. No data was uploaded.');
  }

  return records;
}

function validateWritingConfig(raw) {
  try {
    const config = JSON.parse(raw);
    return config?.version === 1
      && config.algorithm === 'AES-256-GCM'
      && config.kdf === 'PBKDF2-HMAC-SHA-256'
      && config.iterations === 600000
      && typeof config.salt === 'string'
      && typeof config.verifierIv === 'string'
      && typeof config.verifierCiphertext === 'string';
  } catch (error) {
    return false;
  }
}

export function validateBackup(payload) {
  if (!payload || payload.format !== 'faith-focus-daily-armor-backup' || payload.version !== 1
      || !payload.records || typeof payload.records !== 'object' || Array.isArray(payload.records)) {
    throw new Error('This file is not a supported Faith & Focus backup.');
  }

  const entries = Object.entries(payload.records);
  if (!entries.length) throw new Error('The backup does not contain any app data.');

  for (const [key, raw] of entries) {
    if (!isAllowedStorageKey(key) || typeof raw !== 'string') {
      throw new Error('The backup contains an unsupported record. Nothing was restored.');
    }
    if (DAILY_RECORD_PATTERN.test(key)) {
      let data;
      try { data = JSON.parse(raw); }
      catch (error) { throw new Error('The backup contains a damaged checklist record.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)
          || PRIVATE_NOTE_IDS.some(id => Object.hasOwn(data, id))) {
        throw new Error('The backup contains unencrypted private reflection fields. Nothing was restored.');
      }
    } else if (key === GARDEN_STORAGE_KEY) {
      let garden;
      try { garden = JSON.parse(raw); } catch (error) { garden = null; }
      if (!validateGardenState(garden)) throw new Error('The backup contains invalid garden data.');
    } else if (ENCRYPTED_RECORD_PATTERN.test(key)) {
      if (!isEncryptedRecord(raw)) throw new Error('The backup contains an invalid encrypted writing record.');
    } else if (key === WRITING_CONFIG_KEY) {
      if (!validateWritingConfig(raw)) throw new Error('The backup contains an invalid private-writing key configuration.');
    } else if (key === 'user_confidence_score') {
      if (!/^\\d+$/.test(raw)) throw new Error('The backup contains an invalid confidence score.');
    } else if (SCORE_RECORD_PATTERN.test(key) && raw !== 'true' && raw !== 'false') {
      throw new Error('The backup contains an invalid completion marker.');
    }
  }

  const hasEncryptedWriting = entries.some(([key]) => ENCRYPTED_RECORD_PATTERN.test(key));
  if (hasEncryptedWriting && !Object.hasOwn(payload.records, WRITING_CONFIG_KEY)) {
    throw new Error('The backup is missing the private-writing encryption configuration.');
  }
  return payload.records;
}

async function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) return;
  if (identityScriptPromise) return identityScriptPromise;

  identityScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => window.google?.accounts?.oauth2
      ? resolve()
      : reject(new Error('Google sign-in did not initialize.'));
    script.onerror = () => reject(new Error('Google sign-in could not be loaded. Check your connection and try again.'));
    document.head.appendChild(script);
  }).catch(error => {
    identityScriptPromise = null;
    throw error;
  });
  return identityScriptPromise;
}

async function connectToDrive() {
  if (busy) return;
  setBusy(true);
  status('Loading Google sign-in…');
  try {
    await loadGoogleIdentityServices();
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: response => {
        if (response?.error || !response?.access_token) {
          accessToken = null;
          status('Google Drive connection was not completed. You can try again.');
          setBusy(false);
          return;
        }
        accessToken = response.access_token;
        tokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
        byId('drive-sync-actions')?.classList.remove('hidden');
        const connectButton = byId('drive-connect-button');
        if (connectButton) connectButton.textContent = 'Connected to Google Drive';
        status('Connected. Nothing is uploaded unless you choose Back Up This Device.');
        setBusy(false);
      },
      error_callback: error => {
        status(error?.message || 'Google sign-in was closed or could not be completed.');
        setBusy(false);
      }
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } catch (error) {
    status(error.message || 'Google sign-in could not be started.');
    setBusy(false);
  }
}

function requireToken() {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    accessToken = null;
    throw new Error('Your Google Drive session has expired. Connect again to continue.');
  }
  return accessToken;
}

async function driveRequest(url, options = {}) {
  const token = requireToken();
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token }
  });
  if (!response.ok) throw new Error('Google Drive request failed (HTTP ' + response.status + ').');
  return response;
}

async function backupToDrive() {
  if (busy) return;
  setBusy(true);
  status('Preparing your encrypted and local app records…');
  try {
    const records = collectBackupRecords();
    const payload = {
      format: 'faith-focus-daily-armor-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      records
    };
    const compressed = await compressData(JSON.stringify(payload));
    const fileBlob = new Blob([compressed], { type: 'application/gzip' });
    const query = new URLSearchParams({
      spaces: 'appDataFolder',
      q: "name='" + DRIVE_FILE_NAME + "' and trashed=false",
      fields: 'files(id,name)'
    });
    const searchResponse = await driveRequest(DRIVE_API + '/files?' + query.toString());
    const searchData = await searchResponse.json();
    const existing = searchData.files?.[0];

    if (existing?.id) {
      await driveRequest('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(existing.id) + '?uploadType=media', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/gzip' },
        body: fileBlob
      });
    } else {
      const metadata = { name: DRIVE_FILE_NAME, parents: ['appDataFolder'] };
      const boundary = 'faithfocusbackup' + Date.now().toString(36);
      const body = new Blob([
        '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(metadata),
        '\r\n--' + boundary + '\r\nContent-Type: application/gzip\r\n\r\n',
        fileBlob,
        '\r\n--' + boundary + '--'
      ]);
      await driveRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
        body
      });
    }
    status('Backup completed. Your data was saved to your private Google Drive app folder.');
  } catch (error) {
    console.error('Google Drive backup failed:', error);
    status(error.message || 'Backup failed. Your local data has not been changed.');
  } finally {
    setBusy(false);
  }
}

async function restoreFromDrive() {
  if (busy) return;
  if (!window.confirm('Restore this backup from your private Google Drive app folder? Your current local records may be replaced.')) return;
  setBusy(true);
  status('Looking for your Google Drive backup…');
  try {
    const query = new URLSearchParams({
      spaces: 'appDataFolder',
      q: "name='" + DRIVE_FILE_NAME + "' and trashed=false",
      fields: 'files(id,name)'
    });
    const searchResponse = await driveRequest(DRIVE_API + '/files?' + query.toString());
    const searchData = await searchResponse.json();
    const file = searchData.files?.[0];
    if (!file?.id) {
      status('No Faith & Focus backup was found in your Google Drive app folder.');
      return;
    }

    const downloadResponse = await driveRequest(DRIVE_API + '/files/' + encodeURIComponent(file.id) + '?alt=media');
    const compressedText = await downloadResponse.text();
    const parsed = JSON.parse(await decompressData(compressedText));
    const records = validateBackup(parsed);

    if (!window.confirm('This will restore the validated backup records on this device. Your app PIN will remain unchanged. Continue?')) return;

    const previous = new Map();
    for (const key of Object.keys(records)) previous.set(key, localStorage.getItem(key));
    try {
      for (const [key, value] of Object.entries(records)) localStorage.setItem(key, value);
    } catch (writeError) {
      for (const [key, value] of previous) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      throw writeError;
    }
    status('Restore completed. Reloading the app to show the restored records…');
    window.setTimeout(() => window.location.reload(), 800);
  } catch (error) {
    console.error('Google Drive restore failed:', error);
    status(error.message || 'Restore failed. Your existing local records were preserved.');
  } finally {
    setBusy(false);
  }
}

export function initGoogleDriveSync() {
  const connectButton = byId('drive-connect-button');
  const backupButton = byId('drive-backup-button');
  const restoreButton = byId('drive-restore-button');
  if (!connectButton || !backupButton || !restoreButton) return;

  connectButton.addEventListener('click', connectToDrive);
  backupButton.addEventListener('click', backupToDrive);
  restoreButton.addEventListener('click', restoreFromDrive);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGoogleDriveSync, { once: true });
} else {
  initGoogleDriveSync();
}

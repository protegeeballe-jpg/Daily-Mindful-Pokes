import { compressData, decompressData } from './compressor.js';
import {
  encodeBase64Url, encryptDailyBundle, decryptDailyBundle, isValidEncryptedPacket,
  isValidDateString
} from './vault-crypto.js';
import {
  getLocalDailyPacket, listLocalDailyPackets, putLocalDailyPacket, markLocalDailyPacketSynced
} from './vault-storage.js';
import {
  exportEncryptedVoiceNotes, exportEncryptedVoiceNotesForDate, restoreEncryptedVoiceNotesForDate
} from './voice-note-store.js';
import { GARDEN_STORAGE_KEY } from './garden-model.js';
import { flushAndSaveCurrentPrivateWriting, stopRegisteredVoiceNoteRecording } from './writing-security.js';

const WORKER_ORIGIN = 'https://faith-focus-proxy.nine-westhigh.workers.dev';
const APP_CLIENT = 'faith-focus-daily-armor-web/1';
const MAX_DAILY_PACKET_BYTES = 1024 * 1024;
const DAILY_RECORD_PREFIXES = [
  'mindful_pokes_data_',
  'score_awarded_',
  'dmp_diary_cipher_v1_',
  'dmp_notes_cipher_v1_',
  'faith_focus_location_checkins_v1_'
];
const LEGACY_WRITING_CONFIG_KEY = 'dmp_private_writing_crypto_v1';

let activeVault = null;
let cloudDebounceTimer = null;
let applyingRemotePacket = 0;
let syncQueue = Promise.resolve();
let localCaptureQueues = new Map();
let localChangeVersions = new Map();
let pendingCloudDates = new Set();
let lastStatus = '';
let storageHooksInstalled = false;

const byId = id => document.getElementById(id);

function status(message, state = 'info') {
  if (message === lastStatus && state !== 'error') return;
  lastStatus = message;
  const target = byId('vault-sync-status');
  if (target) {
    target.textContent = message;
    target.dataset.state = state;
  }
  const indicator = byId('vault-sync-indicator');
  if (indicator) {
    indicator.dataset.state = state;
    indicator.textContent = state === 'success' ? '● Synced' : state === 'error' ? '● Sync error / offline' : '● Syncing…';
    indicator.setAttribute('aria-label', indicator.textContent.trim());
  }
  console.log('[Vault Sync] Status:', state, message, activeVault ? { vaultId: activeVault.vaultId } : { vaultId: null });
  window.dispatchEvent(new CustomEvent('faith-focus:vault-sync-status', { detail: { message, state } }));
}

function matchesDailyKey(key, dateString) {
  return DAILY_RECORD_PREFIXES.some(prefix => key === prefix + dateString);
}

function dateFromDailyKey(key) {
  for (const prefix of DAILY_RECORD_PREFIXES) {
    if (key.startsWith(prefix)) {
      const dateString = key.slice(prefix.length);
      if (isValidDateString(dateString)) return dateString;
    }
  }
  return null;
}

function isDailyRecordKey(key) {
  return DAILY_RECORD_PREFIXES.some(prefix => {
    const dateString = key.slice(prefix.length);
    return key.startsWith(prefix) && isValidDateString(dateString);
  });
}

function getCurrentDateString() {
  const value = byId('currentDate')?.value;
  if (isValidDateString(value)) return value;
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

async function buildDailyBundle(dateString) {
  const records = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !matchesDailyKey(key, dateString)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) records[key] = value;
  }

  // Always represent every checklist item in each date bundle. Missing historical
  // values are explicit false states rather than omitted checklist controls.
  const checklistKey = 'mindful_pokes_data_' + dateString;
  let checklist = {};
  try {
    const existing = records[checklistKey];
    checklist = existing ? JSON.parse(existing) : {};
    if (!checklist || typeof checklist !== 'object' || Array.isArray(checklist)) checklist = {};
  } catch {
    checklist = {};
  }
  const isCurrentDate = dateString === getCurrentDateString();
  document.querySelectorAll('.app-chk').forEach(checkbox => {
    const id = checkbox.dataset.id;
    if (!id) return;
    if (isCurrentDate) {
      checklist[id] = checkbox.checked === true;
      checklist[id + '__guided'] = checkbox.dataset.guideUnlocked === 'true' || checkbox.checked === true;
    } else {
      if (typeof checklist[id] !== 'boolean') checklist[id] = false;
      if (typeof checklist[id + '__guided'] !== 'boolean') checklist[id + '__guided'] = false;
    }
  });
  document.querySelectorAll('.cloud-item[data-cloud]').forEach(item => {
    const key = 'cloud_' + item.dataset.cloud;
    if (isCurrentDate) checklist[key] = item.dataset.released === 'true';
    else if (typeof checklist[key] !== 'boolean') checklist[key] = false;
  });
  checklist.cloud_flow_version = 1;
  records[checklistKey] = JSON.stringify(checklist);

  const voiceNotes = await exportEncryptedVoiceNotesForDate(dateString);
  return {
    format: 'faith-focus-daily-bundle',
    version: 1,
    dateString,
    createdAt: new Date().toISOString(),
    records,
    voiceNotes,
    appState: {
      garden: localStorage.getItem(GARDEN_STORAGE_KEY),
      confidenceScore: localStorage.getItem('user_confidence_score'),
      legacyWritingConfig: localStorage.getItem(LEGACY_WRITING_CONFIG_KEY)
    }
  };
}

function listLocalStorageDates() {
  const dates = new Set();
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    const dateString = key ? dateFromDailyKey(key) : null;
    if (dateString) dates.add(dateString);
  }
  return [...dates].sort();
}

async function getCredentialHeaders() {
  if (!activeVault) throw new Error('Your account is locked.');
  return {
    Accept: 'application/json',
    'X-App-Client': APP_CLIENT,
    'X-Write-Token': encodeBase64Url(activeVault.writeToken)
  };
}

async function vaultRequest(path, { method = 'GET', body = null, baseUpdatedAt } = {}) {
  const headers = await getCredentialHeaders();
  let bodyText = null;
  if (body !== null) {
    bodyText = JSON.stringify(body);
    if (new TextEncoder().encode(bodyText).byteLength > MAX_DAILY_PACKET_BYTES) {
      throw new Error('This daily packet is larger than 1 MB. Your local data remains saved, but it cannot be sent to the cloud yet.');
    }
    headers['Content-Type'] = 'application/json';
  }
  if (baseUpdatedAt !== undefined) headers['X-Base-Updated-At'] = baseUpdatedAt || 'none';

  let response;
  console.log('[Vault Sync] Worker request started:', { vaultId: activeVault?.vaultId || null, method, path });
  try {
    response = await fetch(WORKER_ORIGIN + path, {
      method,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers,
      body: bodyText
    });
  } catch (error) {
    console.error('[Vault Sync] Worker network failure:', { vaultId: activeVault?.vaultId || null, method, path, error });
    throw new Error('Cloud sync is temporarily unavailable. Your encrypted daily packets remain saved locally.');
  }

  let result = {};
  try { result = await response.json(); } catch { result = {}; }
  console.log('[Vault Sync] Worker response:', {
    vaultId: activeVault?.vaultId || null, method, path, httpStatus: response.status, ok: response.ok,
    error: result.error || null, updatedAt: result.updatedAt || null,
    remoteDateCount: result.index && typeof result.index === 'object' ? Object.keys(result.index).length : undefined
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('The username or passphrase was not accepted by this vault.');
    if (response.status === 409) {
      const error = new Error(result.error || 'This date changed on another device. Your local packet was kept.');
      error.code = 'VAULT_CONFLICT';
      error.updatedAt = result.updatedAt || null;
      throw error;
    }
    if (response.status === 413) throw new Error('The cloud service rejected a packet larger than 1 MB. Your local packet remains available.');
    if (response.status === 429) throw new Error(result.error || 'Too many attempts. Please wait one minute.');
    if (response.status === 503) throw new Error(result.error || 'The Cloudflare vault service is not fully configured yet.');
    throw new Error(result.error || 'Cloud sync failed (HTTP ' + response.status + ').');
  }
  return result;
}

async function captureDailyPacket(dateString) {
  if (!activeVault || !isValidDateString(dateString) || applyingRemotePacket) return;
  const version = (localChangeVersions.get(dateString) || 0) + 1;
  localChangeVersions.set(dateString, version);

  const previous = localCaptureQueues.get(dateString) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    let repeat = true;
    while (repeat && activeVault) {
      const snapshotVersion = localChangeVersions.get(dateString);
      const bundle = await buildDailyBundle(dateString);
      const prior = await getLocalDailyPacket(dateString);
      if (prior) {
        try {
          const priorBundle = await decryptDailyBundle(prior.packet, activeVault.encryptionKey, decompressData);
          if (canonicalBundle(priorBundle) === canonicalBundle(bundle)) {
            if (prior.dirty) scheduleCloudPush(dateString);
            return;
          }
        } catch {
          // A packet from a future version is replaced only after the current data is safely encrypted.
        }
      }
      const packet = await encryptDailyBundle(bundle, activeVault.encryptionKey, compressData);
      await putLocalDailyPacket({
        dateString,
        packet,
        localUpdatedAt: Date.now(),
        remoteUpdatedAt: prior?.remoteUpdatedAt || null,
        dirty: true
      });
      repeat = localChangeVersions.get(dateString) !== snapshotVersion;
      if (!repeat) {
        status('Saved and encrypted locally. Automatic cloud sync is queued.', 'success');
        scheduleCloudPush(dateString);
      }
    }
  });
  localCaptureQueues.set(dateString, next);
  try {
    await next;
  } finally {
    if (localCaptureQueues.get(dateString) === next) localCaptureQueues.delete(dateString);
  }
}

function scheduleCapture(dateString = getCurrentDateString()) {
  if (!activeVault || applyingRemotePacket || !isValidDateString(dateString)) return;
  captureDailyPacket(dateString).catch(error => {
    status(error.message || 'The daily packet could not be stored locally.', 'error');
  });
}

function installLocalStorageHooks() {
  if (storageHooksInstalled || !window.Storage?.prototype) return;
  storageHooksInstalled = true;
  const prototype = window.Storage.prototype;
  const originalSetItem = prototype.setItem;
  const originalRemoveItem = prototype.removeItem;

  const wrappedSetItem = function (key, value) {
    const result = originalSetItem.call(this, key, value);
    if (this === window.localStorage && !applyingRemotePacket && !window.__faithFocusVaultMigration) {
      const dateString = dateFromDailyKey(String(key));
      if (dateString) scheduleCapture(dateString);
      else if (key === GARDEN_STORAGE_KEY || key === 'user_confidence_score') scheduleCapture();
    }
    return result;
  };
  Object.defineProperty(wrappedSetItem, '__faithFocusVaultHooked', { value: true });
  prototype.setItem = wrappedSetItem;

  const wrappedRemoveItem = function (key) {
    const result = originalRemoveItem.call(this, key);
    if (this === window.localStorage && !applyingRemotePacket) {
      const dateString = dateFromDailyKey(String(key));
      if (dateString) scheduleCapture(dateString);
      else if (key === GARDEN_STORAGE_KEY || key === 'user_confidence_score') scheduleCapture();
    }
    return result;
  };
  Object.defineProperty(wrappedRemoveItem, '__faithFocusVaultHooked', { value: true });
  prototype.removeItem = wrappedRemoveItem;
}

function canonicalBundle(bundle) {
  return JSON.stringify({
    dateString: bundle.dateString,
    records: bundle.records,
    voiceNotes: bundle.voiceNotes,
    appState: bundle.appState
  });
}

async function restoreDailyBundle(bundle) {
  applyingRemotePacket += 1;
  try {
    for (const [key, value] of Object.entries(bundle.records)) {
      if (isDailyRecordKey(key) && typeof value === 'string') localStorage.setItem(key, value);
    }
    if (bundle.appState?.garden !== null && typeof bundle.appState?.garden === 'string') {
      localStorage.setItem(GARDEN_STORAGE_KEY, bundle.appState.garden);
    }
    if (bundle.appState?.confidenceScore !== null && typeof bundle.appState?.confidenceScore === 'string') {
      localStorage.setItem('user_confidence_score', bundle.appState.confidenceScore);
    }
    if (bundle.appState?.legacyWritingConfig !== null && typeof bundle.appState?.legacyWritingConfig === 'string') {
      localStorage.setItem(LEGACY_WRITING_CONFIG_KEY, bundle.appState.legacyWritingConfig);
    }
    await restoreEncryptedVoiceNotesForDate(bundle.dateString, bundle.voiceNotes);
  } finally {
    applyingRemotePacket -= 1;
  }
  window.dispatchEvent(new CustomEvent('faith-focus:vault-data-restored', { detail: { dateString: bundle.dateString } }));
}

async function fetchRemoteIndex() {
  console.log('[Vault Sync] Fetching shared vault index on startup/sync:', { vaultId: activeVault.vaultId, key: activeVault.vaultId + ':index' });
  const result = await vaultRequest('/vault/' + activeVault.vaultId + '/index');
  if (!result.index || typeof result.index !== 'object' || Array.isArray(result.index)) {
    throw new Error('Cloudflare returned an invalid vault index.');
  }
  return result.index;
}

async function fetchRemoteDay(dateString) {
  const result = await vaultRequest('/vault/' + activeVault.vaultId + '/day/' + dateString);
  if (result.packet !== null && !isValidEncryptedPacket(result.packet)) {
    throw new Error('Cloudflare returned an invalid encrypted daily packet.');
  }
  return result;
}

async function uploadDailyPacket(dateString) {
  const local = await getLocalDailyPacket(dateString);
  if (!local?.dirty) return false;

  try {
    const result = await vaultRequest('/vault/' + activeVault.vaultId + '/day/' + dateString, {
      method: 'PUT',
      body: { packet: local.packet, baseUpdatedAt: local.remoteUpdatedAt || null },
      baseUpdatedAt: local.remoteUpdatedAt || null
    });
    const syncResult = await markLocalDailyPacketSynced(dateString, result.updatedAt, local.packet, { requirePacketMatch: true });
    if (!syncResult.stillMatchesUploadedSnapshot) scheduleCloudPush();
    return true;
  } catch (error) {
    if (error.code === 'VAULT_CONFLICT') {
      status('Sync conflict for ' + dateString + '. Both the local packet and newer cloud version are preserved; automatic overwrite has stopped for this date.', 'error');
      return false;
    }
    throw error;
  }
}

async function reconcileDay(dateString, remoteUpdatedAt) {
  const local = await getLocalDailyPacket(dateString);
  if (!local) {
    const remote = await fetchRemoteDay(dateString);
    if (!remote.packet) return false;
    const bundle = await decryptDailyBundle(remote.packet, activeVault.encryptionKey, decompressData);
    await restoreDailyBundle(bundle);
    await putLocalDailyPacket({
      dateString, packet: remote.packet, localUpdatedAt: Date.now(),
      remoteUpdatedAt: remote.updatedAt || remoteUpdatedAt, dirty: false
    });
    return true;
  }

  if (local.dirty) {
    const remote = await fetchRemoteDay(dateString);
    if (!remote.packet) return uploadDailyPacket(dateString);
    const remoteBundle = await decryptDailyBundle(remote.packet, activeVault.encryptionKey, decompressData);
    const localBundle = await decryptDailyBundle(local.packet, activeVault.encryptionKey, decompressData);
    if (canonicalBundle(remoteBundle) === canonicalBundle(localBundle)) {
      await markLocalDailyPacketSynced(dateString, remote.updatedAt || remoteUpdatedAt, remote.packet);
      return false;
    }
    status('Sync conflict for ' + dateString + '. This device has local changes and the cloud has a different version. Neither copy was overwritten.', 'error');
    return false;
  }

  const localRemote = local.remoteUpdatedAt || null;
  if (remoteUpdatedAt && remoteUpdatedAt !== localRemote) {
    if (!localRemote || remoteUpdatedAt > localRemote) console.log('[Vault Sync] Newer remote date detected:', { vaultId: activeVault.vaultId, dateString, remoteUpdatedAt, localRemoteUpdatedAt: localRemote });
    const remote = await fetchRemoteDay(dateString);
    if (remote.packet && remote.updatedAt && (!localRemote || remote.updatedAt > localRemote)) {
      const bundle = await decryptDailyBundle(remote.packet, activeVault.encryptionKey, decompressData);
      await restoreDailyBundle(bundle);
      await putLocalDailyPacket({
        dateString, packet: remote.packet, localUpdatedAt: Date.now(),
        remoteUpdatedAt: remote.updatedAt, dirty: false
      });
      return true;
    }
  }
  return false;
}

function synchronizeVault() {
  if (!activeVault) return Promise.resolve();
  const operation = syncQueue.catch(() => {}).then(() => performVaultSync());
  syncQueue = operation.catch(() => {});
  return operation;
}

async function performVaultSync() {
  if (!activeVault) return;
  try {
    status('Checking your encrypted vault…');
    const index = await fetchRemoteIndex();
    const remoteDates = Object.keys(index).filter(isValidDateString).sort();
    console.log('[Vault Sync] Shared index received:', { vaultId: activeVault.vaultId, key: activeVault.vaultId + ':index', remoteDateCount: remoteDates.length, remoteDates });
    let restored = 0;

    for (const dateString of remoteDates) {
      const remoteUpdatedAt = typeof index[dateString] === 'string' ? index[dateString] : null;
      if (await reconcileDay(dateString, remoteUpdatedAt)) restored += 1;
    }

    const localRecords = await listLocalDailyPackets();
    for (const record of localRecords) {
      if (!record.dirty) continue;
      if (!Object.hasOwn(index, record.dateString)) {
        await uploadDailyPacket(record.dateString);
      } else if (!record.remoteUpdatedAt) {
        // The remote date was already reconciled above; mismatches are preserved as conflicts.
        continue;
      }
    }

    if (restored) {
      status('Restored ' + restored + ' newer daily packet' + (restored === 1 ? '' : 's') + ' from your vault.', 'success');
    } else if (!localRecords.some(record => record.dirty)) {
      status('Your encrypted vault is up to date on this device.', 'success');
    }
  } catch (error) {
    status(error.message || 'Automatic vault synchronization could not finish.', 'error');
    throw error;
  }
}
function scheduleCloudPush(dateString = null) {
  if (!activeVault) return;
  if (dateString && isValidDateString(dateString)) pendingCloudDates.add(dateString);
  if (cloudDebounceTimer) clearTimeout(cloudDebounceTimer);
  const vaultId = activeVault.vaultId;
  console.log('[Vault Sync] Local change captured; 5-second debounced cloud save scheduled:', {
    vaultId, pendingDates: [...pendingCloudDates].sort(), datePacketKeys: [...pendingCloudDates].map(date => vaultId + ':' + date)
  });
  status('Local changes are saved on this device. Cloud sync will start in 5 seconds…', 'info');
  cloudDebounceTimer = window.setTimeout(() => {
    cloudDebounceTimer = null;
    const dates = [...pendingCloudDates].sort();
    pendingCloudDates.clear();
    console.log('[Vault Sync] Debounce elapsed; pushing pending encrypted date packets:', {
      vaultId, dates, packetKeys: dates.map(date => vaultId + ':' + date)
    });
    synchronizeVault().catch(error => console.error('[Vault Sync] Debounced sync failed:', { vaultId, error }));
  }, 5000);
}

async function captureExistingLocalDates() {
  const dates = new Set(listLocalStorageDates());
  const voiceNotes = await exportEncryptedVoiceNotes();
  voiceNotes.forEach(record => dates.add(record.dateString));
  for (const dateString of [...dates].sort()) await captureDailyPacket(dateString);
}

export async function startVaultSync(credentials) {
  if (!credentials?.vaultId || !credentials?.encryptionKey || !(credentials.writeToken instanceof Uint8Array)) {
    throw new TypeError('A complete unlocked vault session is required.');
  }
  activeVault = credentials;
  installLocalStorageHooks();

  try {
    status('Connecting to your private vault…');
    await vaultRequest('/vault/' + activeVault.vaultId + '/claim', { method: 'POST', body: {} });
  } catch (error) {
    activeVault = null;
    throw error;
  }

  // Capture existing local records before comparing dates with the cloud index.
  await captureExistingLocalDates();
  await synchronizeVault();
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('faith-focus:local-data-changed', handleLocalDataChanged);
  window.addEventListener('pagehide', flushVaultSync);
}

function handleLocalDataChanged(event) {
  if (activeVault) scheduleCapture(event?.detail?.dateString || getCurrentDateString());
}

function handleOnline() {
  console.log('[Vault Sync] Browser is online; starting immediate reconciliation.', { vaultId: activeVault?.vaultId || null });
  synchronizeVault().catch(() => {});
}

function handleOffline() {
  console.warn('[Vault Sync] Browser is offline. Encrypted local packets remain saved and queued.', { vaultId: activeVault?.vaultId || null });
  status('Offline — encrypted changes remain saved locally and will retry when online.', 'error');
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') flushVaultSync();
}

async function flushVaultSync() {
  if (cloudDebounceTimer) clearTimeout(cloudDebounceTimer);
  cloudDebounceTimer = null;
  if (!activeVault) return;
  try {
    // Finalize active microphone and writing operations before packaging the day.
    await stopRegisteredVoiceNoteRecording();
    await flushAndSaveCurrentPrivateWriting();
    for (const queue of localCaptureQueues.values()) await queue;
    await synchronizeVault();
  } catch {
    // Local IndexedDB packets remain queued and are retried on the next online event or edit.
  }
}

export async function stopVaultSync() {
  if (cloudDebounceTimer) clearTimeout(cloudDebounceTimer);
  cloudDebounceTimer = null;
  await flushVaultSync();
  if (activeVault) {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('faith-focus:local-data-changed', handleLocalDataChanged);
    window.removeEventListener('pagehide', flushVaultSync);
  }
  activeVault = null;
}

export async function exportEncryptedVaultPackets() {
  if (!activeVault) throw new Error('Sign in before exporting your encrypted vault.');
  await stopRegisteredVoiceNoteRecording();
  await flushAndSaveCurrentPrivateWriting();
  for (const queue of localCaptureQueues.values()) await queue;
  await captureExistingLocalDates();
  const packets = await listLocalDailyPackets();
  return packets.map(({ dateString, packet, remoteUpdatedAt }) => ({ dateString, packet, remoteUpdatedAt }));
}

export async function importEncryptedVaultPackets(packets) {
  if (!activeVault) throw new Error('Sign in to the same account that created this backup before importing it.');
  if (!Array.isArray(packets) || packets.length > 5000
      || packets.some(item => !item || !isValidEncryptedPacket(item.packet)
        || item.dateString !== item.packet.dateString)) {
    throw new Error('The selected backup contains an invalid or unsupported encrypted daily packet.');
  }
  const prepared = [];
  for (const item of packets) {
    const bundle = await decryptDailyBundle(item.packet, activeVault.encryptionKey, decompressData);
    const existing = await getLocalDailyPacket(item.dateString);
    if (existing) {
      const existingBundle = await decryptDailyBundle(existing.packet, activeVault.encryptionKey, decompressData);
      if (canonicalBundle(existingBundle) !== canonicalBundle(bundle)) {
        throw new Error('This device already has different data for ' + item.dateString + '. Export the current copy before importing this packet; no local data was overwritten.');
      }
    }
    prepared.push({ item, bundle });
  }

  // Restore source records only after every imported packet is authenticated and
  // checked against the existing local version, so a partially invalid file
  // cannot replace some dates while leaving others untouched.
  for (const { bundle } of prepared) await restoreDailyBundle(bundle);
  const { importLocalDailyPackets } = await import('./vault-storage.js');
  await importLocalDailyPackets(packets);
  status('Restored ' + packets.length + ' validated encrypted daily packet' + (packets.length === 1 ? '' : 's') + '. Automatic cloud sync is queued.', 'success');
  scheduleCloudPush();
}

export async function testVaultConnection() {
  if (!activeVault) throw new Error('Sign in to your unified account before testing cloud sync.');
  const vaultId = activeVault.vaultId;
  console.log('[Vault Sync Test] Starting same-vault Cloudflare connection test:', {
    vaultId, indexKey: vaultId + ':index'
  });
  status('Testing Cloudflare vault connection…', 'info');

  // Flush current editor state and capture local daily packets first. The test
  // uses real encrypted app packets; it never writes plaintext or a dummy KV key.
  await stopRegisteredVoiceNoteRecording();
  await flushAndSaveCurrentPrivateWriting();
  await captureExistingLocalDates();
  for (const queue of localCaptureQueues.values()) await queue;

  if (cloudDebounceTimer) clearTimeout(cloudDebounceTimer);
  cloudDebounceTimer = null;
  pendingCloudDates.clear();

  // Exercise a real conditional PUT using today's existing encrypted packet.
  // The ciphertext is unchanged; the Worker write-token and updated-at guard
  // still protect against overwriting a newer packet from the other device.
  const today = getCurrentDateString();
  let todayPacket = await getLocalDailyPacket(today);
  if (todayPacket && !todayPacket.dirty) {
    const remoteToday = await fetchRemoteDay(today);
    const sameBase = remoteToday.packet
      ? Boolean(todayPacket.remoteUpdatedAt && todayPacket.remoteUpdatedAt === remoteToday.updatedAt)
      : !todayPacket.remoteUpdatedAt;
    if (sameBase) {
      await putLocalDailyPacket({ ...todayPacket, dirty: true });
      console.log('[Vault Sync Test] Performing conditional encrypted packet push:', {
        vaultId, dateString: today, packetKey: vaultId + ':' + today,
        baseUpdatedAt: todayPacket.remoteUpdatedAt || null
      });
      await uploadDailyPacket(today);
    } else {
      console.warn('[Vault Sync Test] Skipping test PUT because the local packet has no current remote version baseline. No remote data was overwritten.', {
        vaultId, dateString: today, localRemoteUpdatedAt: todayPacket.remoteUpdatedAt || null,
        remoteUpdatedAt: remoteToday.updatedAt || null
      });
    }
  } else if (todayPacket?.dirty) {
    console.log('[Vault Sync Test] Today already has a pending local packet; normal sync will attempt its guarded upload.', {
      vaultId, dateString: today, packetKey: vaultId + ':' + today
    });
  }

  // Complete the normal pull/reconciliation pass, then verify the shared index again.
  await synchronizeVault();
  const index = await fetchRemoteIndex();
  const remoteDates = Object.keys(index).filter(isValidDateString).sort();
  const localPackets = await listLocalDailyPackets();
  const pendingUploads = localPackets.filter(record => record.dirty).map(record => record.dateString);

  const result = { vaultId, indexKey: vaultId + ':index', remoteDateCount: remoteDates.length, remoteDates, pendingUploads };
  console.log('[Vault Sync Test] Completed:', result);
  if (pendingUploads.length) {
    status('Cloud connection succeeded. Some local dates remain queued or have a conflict; see the console.', 'error');
  } else {
    status('Cloud connection verified. This device is synchronized with the shared vault.', 'success');
  }
  return result;
}

export function isVaultSyncActive() {
  return Boolean(activeVault);
}

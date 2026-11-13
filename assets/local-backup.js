import {
  exportEncryptedVaultPackets, importEncryptedVaultPackets, isVaultSyncActive
} from './vault-sync.js';

const BACKUP_FORMAT = 'faith-focus-encrypted-vault-export';
const BACKUP_VERSION = 1;
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

const byId = id => document.getElementById(id);

function setStatus(message, state = 'info') {
  const element = byId('vault-backup-status');
  if (element) {
    element.textContent = message;
    element.dataset.state = state;
  }
}

function setBusy(busy) {
  ['vault-export-button', 'vault-import-button'].forEach(id => {
    const button = byId(id);
    if (button) button.disabled = busy;
  });
}

async function exportBackup() {
  if (!isVaultSyncActive()) {
    setStatus('Sign in before exporting your encrypted vault.', 'error');
    return;
  }
  setBusy(true);
  setStatus('Preparing your encrypted daily packets…');
  try {
    const packets = await exportEncryptedVaultPackets();
    const payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      packets
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'faith-focus-encrypted-vault-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Exported ' + packets.length + ' encrypted daily packet' + (packets.length === 1 ? '' : 's') + '. The file contains ciphertext, not readable Diary content.', 'success');
  } catch (error) {
    setStatus(error?.message || 'The encrypted JSON file could not be exported.', 'error');
  } finally {
    setBusy(false);
  }
}

function validateBackupFile(payload) {
  if (!payload || payload.format !== BACKUP_FORMAT || payload.version !== BACKUP_VERSION
      || !Array.isArray(payload.packets) || payload.packets.length > 5000) {
    throw new Error('This is not a supported Faith & Focus encrypted vault export.');
  }
  const dates = new Set();
  for (const record of payload.packets) {
    if (!record || typeof record !== 'object'
        || typeof record.dateString !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/.test(record.dateString)
        || !record.packet || record.packet.dateString !== record.dateString
        || dates.has(record.dateString)) {
      throw new Error('The backup contains an invalid or duplicate daily packet.');
    }
    dates.add(record.dateString);
  }
  return payload.packets;
}

async function importBackupFile(file) {
  if (!isVaultSyncActive()) {
    setStatus('Sign in to the same account that created this backup before importing it.', 'error');
    return;
  }
  if (!file) return;
  const fileName = String(file.name || '').toLowerCase();
  const fileType = String(file.type || '').toLowerCase().split(';')[0].trim();
  if (!fileName.endsWith('.json')
      || (fileType && !['application/json', 'text/json'].includes(fileType))) {
    setStatus('Choose a valid .json encrypted vault backup file.', 'error');
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    setStatus('This JSON file exceeds the 50 MB import limit.', 'error');
    return;
  }
  setBusy(true);
  setStatus('Checking the encrypted vault file…');
  try {
    const payload = JSON.parse(await file.text());
    const packets = validateBackupFile(payload);
    await importEncryptedVaultPackets(packets);
    setStatus('Imported ' + packets.length + ' encrypted daily packet' + (packets.length === 1 ? '' : 's') + '. Automatic cloud sync is queued.', 'success');
  } catch (error) {
    setStatus(error?.message || 'The encrypted vault file could not be imported.', 'error');
  } finally {
    setBusy(false);
    const input = byId('vault-import-file');
    if (input) input.value = '';
  }
}

function initializeLocalBackup() {
  const exportButton = byId('vault-export-button');
  const importButton = byId('vault-import-button');
  const input = byId('vault-import-file');
  if (!exportButton || !importButton || !input) return;
  exportButton.addEventListener('click', exportBackup);
  importButton.addEventListener('click', () => input.click());
  input.addEventListener('change', () => importBackupFile(input.files?.[0] || null));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLocalBackup, { once: true });
} else {
  initializeLocalBackup();
}

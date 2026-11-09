import { GARDEN_STORAGE_KEY, validateGardenState } from './garden-model.js';

const GOOGLE_CLIENT_ID = '717523562646-lht84sbcpfnn6q330nd5683pjc59dhdh.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const BACKUP_FILE_NAME = 'faith-focus-daily-armor-backup-v1.json';
const BACKUP_FORMAT = 'faith-focus-drive-backup';
const BACKUP_VERSION = 1;
const CHECKLIST_PREFIX = 'mindful_pokes_data_';
const DIARY_PREFIX = 'dmp_diary_cipher_v1_';
const NOTES_PREFIX = 'dmp_notes_cipher_v1_';
const WRITING_CONFIG_KEY = 'dmp_private_writing_crypto_v1';
const SCORE_KEY = 'user_confidence_score';
const PRIVATE_NOTE_IDS = ['note-success', 'note-priorities', 'note-gratitude-others', 'note-gratitude-god'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ENCRYPTED_RECORD_PATTERN = /^dmp_(?:diary|notes)_cipher_v1_\d{4}-\d{2}-\d{2}$/;

const connectButton = document.getElementById('drive-connect-button');
const actions = document.getElementById('drive-sync-actions');
const backupButton = document.getElementById('drive-backup-button');
const restoreButton = document.getElementById('drive-restore-button');
const statusElement = document.getElementById('drive-sync-status');

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let pendingTokenRequest = null;
let busy = false;

function setStatus(message, state = 'info') {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.dataset.state = state;
}

function setBusy(value) {
    busy = value;
    if (backupButton) backupButton.disabled = value;
    if (restoreButton) restoreButton.disabled = value;
    if (connectButton) connectButton.disabled = value || !tokenClient;
}

function getAllowedChecklistFields() {
    const checkboxIds = new Set([...document.querySelectorAll('.app-chk')]
        .map(element => element.dataset.id)
        .filter(id => typeof id === 'string' && /^[a-z0-9-]+$/.test(id)));
    const cloudIds = new Set([...document.querySelectorAll('.cloud-item[data-cloud]')]
        .map(element => element.dataset.cloud)
        .filter(id => typeof id === 'string' && /^[a-z0-9-]+$/.test(id)));
    return { checkboxIds, cloudIds };
}

function sanitizeChecklistData(data) {
    const { checkboxIds, cloudIds } = getAllowedChecklistFields();
    const clean = {};
    for (const [key, value] of Object.entries(data)) {
        if (key === 'cloud_flow_version' && value === 1) {
            clean[key] = value;
        } else if (checkboxIds.has(key) && typeof value === 'boolean') {
            clean[key] = value;
        } else if (checkboxIds.has(key.replace(/__guided$/, '')) &&
            key.endsWith('__guided') && typeof value === 'boolean') {
            clean[key] = value;
        } else if (key.startsWith('cloud_') && cloudIds.has(key.slice(6)) &&
            typeof value === 'boolean') {
            clean[key] = value;
        }
    }
    return clean;
}

function waitForGoogleIdentity(timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const check = () => {
            if (window.google?.accounts?.oauth2?.initTokenClient) {
                resolve(window.google.accounts.oauth2);
                return;
            }
            if (Date.now() - started >= timeoutMs) {
                reject(new Error('Google sign-in could not load. Check your connection and refresh the app.'));
                return;
            }
            window.setTimeout(check, 100);
        };
        check();
    });
}

async function initializeGoogleSignIn() {
    try {
        const oauth2 = await waitForGoogleIdentity();
        tokenClient = oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: DRIVE_SCOPE,
            callback: response => {
                if (response.error) {
                    const error = new Error(response.error_description || response.error);
                    if (pendingTokenRequest) {
                        pendingTokenRequest.reject(error);
                        pendingTokenRequest = null;
                    }
                    accessToken = null;
                    tokenExpiresAt = 0;
                    setStatus('Google sign-in was not completed. ' + error.message, 'error');
                    return;
                }
                accessToken = response.access_token;
                tokenExpiresAt = Date.now() + Math.max(0, Number(response.expires_in || 0) - 60) * 1000;
                if (pendingTokenRequest) {
                    pendingTokenRequest.resolve(accessToken);
                    pendingTokenRequest = null;
                }
                if (actions) actions.classList.remove('hidden');
                if (connectButton) connectButton.textContent = 'Google Drive Connected';
                setStatus('Google Drive is connected for this session. Choose Back Up or Restore when you are ready.', 'success');
            }
        });
        if (connectButton) {
            connectButton.disabled = false;
            connectButton.textContent = 'Connect Google Drive';
        }
    } catch (error) {
        if (connectButton) {
            connectButton.disabled = true;
            connectButton.textContent = 'Google sign-in unavailable';
        }
        setStatus(error.message, 'error');
    }
}

function requestAccessToken(prompt = '') {
    if (!tokenClient) return Promise.reject(new Error('Google sign-in is not ready. Refresh the app and try again.'));
    if (accessToken && Date.now() < tokenExpiresAt) return Promise.resolve(accessToken);
    if (pendingTokenRequest) return pendingTokenRequest.promise;

    let resolveRequest;
    let rejectRequest;
    const promise = new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
    });
    pendingTokenRequest = { promise, resolve: resolveRequest, reject: rejectRequest };
    try {
        tokenClient.requestAccessToken({ prompt });
    } catch (error) {
        pendingTokenRequest = null;
        rejectRequest(error);
    }
    return promise;
}

async function connectGoogleDrive() {
    if (busy) return;
    try {
        setStatus('Waiting for Google sign-in…');
        await requestAccessToken('consent');
    } catch (error) {
        setStatus('Could not connect to Google Drive. ' + error.message, 'error');
    }
}

function getAppOwnedSnapshotEntries() {
    const entries = [];
    const legacyPrivateContent = [];

    for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key) continue;

        if (/^private_diary_\d{4}-\d{2}-\d{2}$/.test(key)) {
            if (localStorage.getItem(key)) legacyPrivateContent.push(key);
            continue;
        }

        if (key.startsWith(CHECKLIST_PREFIX)) {
            const date = key.slice(CHECKLIST_PREFIX.length);
            if (!DATE_PATTERN.test(date)) continue;
            let data;
            try {
                data = JSON.parse(localStorage.getItem(key));
            } catch {
                throw new Error('A saved checklist record is unreadable. Nothing was uploaded.');
            }
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                throw new Error('A saved checklist record has an unsupported format. Nothing was uploaded.');
            }
            for (const noteId of PRIVATE_NOTE_IDS) {
                if (typeof data[noteId] === 'string' && data[noteId].length) {
                    legacyPrivateContent.push(key + ' (' + noteId + ')');
                }
            }
            const cleanData = sanitizeChecklistData(data);
            entries.push([key, JSON.stringify(cleanData)]);
            continue;
        }

        if (key === GARDEN_STORAGE_KEY) {
            let garden;
            try {
                garden = JSON.parse(localStorage.getItem(key));
            } catch {
                throw new Error('Your saved garden could not be read. Nothing was uploaded.');
            }
            if (garden !== null && !validateGardenState(garden)) {
                throw new Error('Your saved garden could not be verified. Nothing was uploaded.');
            }
            entries.push([key, JSON.stringify(garden)]);
            continue;
        }

        if (key === SCORE_KEY) {
            const score = Number(localStorage.getItem(key));
            if (!Number.isSafeInteger(score) || score < 0) throw new Error('Your confidence-points total is invalid. Nothing was uploaded.');
            entries.push([key, String(score)]);
            continue;
        }

        if (/^score_awarded_\d{4}-\d{2}-\d{2}$/.test(key)) {
            if (localStorage.getItem(key) === 'true') entries.push([key, 'true']);
            continue;
        }

        if (key === WRITING_CONFIG_KEY) {
            const config = JSON.parse(localStorage.getItem(key));
            if (!config || config.version !== 1 || config.algorithm !== 'AES-256-GCM' ||
                config.kdf !== 'PBKDF2-HMAC-SHA-256' || config.iterations !== 600000) {
                throw new Error('The private-writing encryption settings could not be verified. Nothing was uploaded.');
            }
            entries.push([key, JSON.stringify(config)]);
            continue;
        }

        if (ENCRYPTED_RECORD_PATTERN.test(key)) {
            const recordText = localStorage.getItem(key);
            let record;
            try { record = JSON.parse(recordText); } catch {
                throw new Error('An encrypted writing record is unreadable. Nothing was uploaded.');
            }
            if (!record || record.version !== 1 || record.algorithm !== 'AES-256-GCM' ||
                typeof record.iv !== 'string' || typeof record.ciphertext !== 'string') {
                throw new Error('An encrypted writing record could not be verified. Nothing was uploaded.');
            }
            entries.push([key, recordText]);
        }
    }

    if (legacyPrivateContent.length) {
        throw new Error('Some older diary or reflection text is still stored without encryption. Open Personal Diary, create or unlock its separate passphrase, and let the app migrate those entries before using Drive backup.');
    }
    return entries;
}

function validateBackup(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        payload.format !== BACKUP_FORMAT || payload.version !== BACKUP_VERSION ||
        !payload.createdAt || !Number.isFinite(Date.parse(payload.createdAt)) ||
        !Array.isArray(payload.entries)) {
        throw new Error('The Drive backup format is invalid or unsupported. No local data was changed.');
    }

    const allowed = key => key === GARDEN_STORAGE_KEY || key === SCORE_KEY ||
        key === WRITING_CONFIG_KEY || key.startsWith(CHECKLIST_PREFIX) ||
        ENCRYPTED_RECORD_PATTERN.test(key) || /^score_awarded_\d{4}-\d{2}-\d{2}$/.test(key);
    const seen = new Set();
    const result = [];

    for (const entry of payload.entries) {
        if (!Array.isArray(entry) || entry.length !== 2 ||
            typeof entry[0] !== 'string' || typeof entry[1] !== 'string' ||
            !allowed(entry[0]) || seen.has(entry[0])) {
            throw new Error('The Drive backup contains an unexpected or duplicate record. No local data was changed.');
        }
        const [key, value] = entry;
        seen.add(key);

        if (key.startsWith(CHECKLIST_PREFIX)) {
            const date = key.slice(CHECKLIST_PREFIX.length);
            if (!DATE_PATTERN.test(date)) throw new Error('A checklist date in the backup is invalid.');
            const data = JSON.parse(value);
            if (!data || typeof data !== 'object' || Array.isArray(data) ||
                PRIVATE_NOTE_IDS.some(id => Object.hasOwn(data, id))) {
                throw new Error('A checklist record contains unsupported or unencrypted private fields.');
            }
            const cleanData = sanitizeChecklistData(data);
            if (Object.keys(cleanData).length !== Object.keys(data).length) {
                throw new Error('A checklist record contains unknown fields or invalid values. No local data was changed.');
            }
        } else if (key === GARDEN_STORAGE_KEY) {
            const garden = JSON.parse(value);
            if (garden !== null && !validateGardenState(garden)) throw new Error('The garden record in the backup is invalid.');
        } else if (key === SCORE_KEY) {
            const score = Number(value);
            if (!Number.isSafeInteger(score) || score < 0) throw new Error('The confidence-points total in the backup is invalid.');
        } else if (/^score_awarded_/.test(key)) {
            if (value !== 'true') throw new Error('A score-award record in the backup is invalid.');
        } else if (key === WRITING_CONFIG_KEY) {
            const config = JSON.parse(value);
            if (!config || config.version !== 1 || config.algorithm !== 'AES-256-GCM' ||
                config.kdf !== 'PBKDF2-HMAC-SHA-256' || config.iterations !== 600000) {
                throw new Error('The private-writing encryption settings in the backup are invalid.');
            }
        } else {
            const record = JSON.parse(value);
            if (!record || record.version !== 1 || record.algorithm !== 'AES-256-GCM' ||
                typeof record.iv !== 'string' || typeof record.ciphertext !== 'string') {
                throw new Error('An encrypted writing record in the backup is invalid.');
            }
        }
        result.push([key, value]);
    }
    return result;
}

async function driveRequest(url, options = {}) {
    const token = await requestAccessToken('');
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: 'Bearer ' + token,
            ...(options.headers || {})
        }
    });
    if (!response.ok) {
        let message = 'Google Drive returned HTTP ' + response.status + '.';
        try {
            const body = await response.json();
            message = body.error?.message || message;
        } catch { /* retain status message */ }
        throw new Error(message);
    }
    if (response.status === 204) return null;
    return response.json();
}

async function findBackupFile() {
    const query = "name = '" + BACKUP_FILE_NAME + "' and trashed = false";
    const params = new URLSearchParams({
        spaces: 'appDataFolder',
        fields: 'files(id,name,modifiedTime)',
        pageSize: '10',
        q: query
    });
    const result = await driveRequest(DRIVE_API + '/files?' + params.toString());
    return result.files?.[0] || null;
}

function createBackupPayload(entries) {
    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        entries
    };
}

async function writeBackupFile(payload, existingFile) {
    const json = JSON.stringify(payload);
    if (existingFile) {
        return driveRequest(
            DRIVE_UPLOAD_API + '/files/' + encodeURIComponent(existingFile.id) + '?uploadType=media&fields=id,name,modifiedTime',
            { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json }
        );
    }

    const boundary = 'faith_focus_' + crypto.randomUUID();
    const metadata = { name: BACKUP_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' };
    const body = [
        '--' + boundary,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        '--' + boundary,
        'Content-Type: application/json; charset=UTF-8',
        '',
        json,
        '--' + boundary + '--',
        ''
    ].join('\r\n');

    return driveRequest(
        DRIVE_UPLOAD_API + '/files?uploadType=multipart&fields=id,name,modifiedTime',
        { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body }
    );
}

async function backUpThisDevice() {
    if (busy) return;
    setBusy(true);
    try {
        await requestAccessToken('');
        const entries = getAppOwnedSnapshotEntries();
        const payload = createBackupPayload(entries);
        const existing = await findBackupFile();
        const action = existing ? 'replace the existing Google Drive backup' : 'create a Google Drive backup';
        if (!window.confirm('This will ' + action + ' with the current data on this device. Continue?')) return;
        await writeBackupFile(payload, existing);
        setStatus('Backup completed. ' + entries.length + ' app records were saved to Google Drive.', 'success');
    } catch (error) {
        setStatus('Backup failed. Your local data was not changed. ' + error.message, 'error');
    } finally {
        setBusy(false);
    }
}

async function restoreFromDrive() {
    if (busy) return;
    setBusy(true);
    try {
        await requestAccessToken('');
        const existing = await findBackupFile();
        if (!existing) {
            setStatus('No Faith & Focus backup was found in this Google account.', 'info');
            return;
        }
        const downloaded = await driveRequest(
            DRIVE_API + '/files/' + encodeURIComponent(existing.id) + '?alt=media'
        );
        const entries = validateBackup(downloaded);
        if (!window.confirm('Restore this backup from ' + new Date(downloaded.createdAt).toLocaleString() + '? This replaces the app progress, garden, and encrypted writing records on this device. Your device PIN and unrelated browser data will remain unchanged.')) return;

        const keysToReplace = new Set();
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key && (key.startsWith(CHECKLIST_PREFIX) || key.startsWith(DIARY_PREFIX) ||
                key.startsWith(NOTES_PREFIX) || key === GARDEN_STORAGE_KEY ||
                key === SCORE_KEY || key === WRITING_CONFIG_KEY ||
                /^score_awarded_\d{4}-\d{2}-\d{2}$/.test(key))) {
                keysToReplace.add(key);
            }
        }

        const previous = new Map([...keysToReplace].map(key => [key, localStorage.getItem(key)]));
        try {
            for (const key of keysToReplace) localStorage.removeItem(key);
            for (const [key, value] of entries) localStorage.setItem(key, value);
        } catch (error) {
            for (const key of keysToReplace) localStorage.removeItem(key);
            for (const [key, value] of previous) if (value !== null) localStorage.setItem(key, value);
            throw new Error('The browser could not finish restoring the backup. Previous local records were restored. ' + error.message);
        }

        setStatus('Restore completed. Refresh the app to reload your checklist, garden, points, and encrypted writing.', 'success');
    } catch (error) {
        setStatus('Restore failed. ' + error.message, 'error');
    } finally {
        setBusy(false);
    }
}

connectButton?.addEventListener('click', connectGoogleDrive);
backupButton?.addEventListener('click', backUpThisDevice);
restoreButton?.addEventListener('click', restoreFromDrive);
initializeGoogleSignIn();

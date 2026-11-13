const VOICE_NOTE_DB_NAME = 'faith_focus_private_voice_notes_v1';
const VOICE_NOTE_DB_VERSION = 2;
const VOICE_NOTE_STORE_NAME = 'voiceNotes';
const LEGACY_QUARANTINE_STORE_NAME = 'legacyQuarantine';
const VOICE_NOTE_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})-([a-f0-9]{32})$/;
const VOICE_NOTE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_VOICE_NOTE_BYTES = 256 * 1024;
const ALLOWED_VOICE_NOTE_MIME_TYPES = new Set([
    'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg',
    'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/aac',
    'audio/3gpp', 'audio/3gpp2', 'audio/flac', 'audio/x-flac',
    'audio/m4a', 'audio/x-m4a', 'audio/opus', 'audio/amr', 'audio/x-aac'
]);

export function isAllowedVoiceNoteMimeType(value) {
    if (typeof value !== 'string' || value.length > 128 || /[\\r\\n]/.test(value)) return false;
    const [mediaType, ...parameters] = value.toLowerCase().split(';').map(part => part.trim());
    if (!ALLOWED_VOICE_NOTE_MIME_TYPES.has(mediaType)) return false;
    return parameters.every(parameter => /^codecs=[a-z0-9._,-]+$/.test(parameter));
}


function isValidDateString(value) {
    if (typeof value !== 'string' || !VOICE_NOTE_DATE_PATTERN.test(value)) return false;
    const parsed = new Date(value + 'T00:00:00.000Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toBase64(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

function fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function getVoiceNoteAad(dateString, id, mimeType) {
    return new TextEncoder().encode(
        'Faith & Focus: Daily Armor|private-voice-note|v1|' + dateString + '|' + id + '|' + mimeType
    );
}

function makeVoiceNoteId(dateString) {
    const random = crypto.getRandomValues(new Uint8Array(16));
    return dateString + '-' + Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function encryptVoiceNoteBlob(blob, key, dateString, id, capturedAt = new Date().toISOString()) {
    if (!(blob instanceof Blob) || blob.size === 0) {
        throw new TypeError('A non-empty voice recording is required.');
    }
    if (!isAllowedVoiceNoteMimeType(blob.type || 'audio/webm')) {
        throw new TypeError('This voice-note format is not supported. Use WebM, MP4, Ogg, WAV, AAC, or FLAC audio.');
    }
    if (!key || !isValidDateString(dateString)) {
        throw new TypeError('An unlocked Diary and valid date are required to save a voice note.');
    }
    if (typeof id !== 'string' || !VOICE_NOTE_ID_PATTERN.test(id) || !id.startsWith(dateString + '-')) {
        throw new TypeError('The voice-note identifier is invalid.');
    }

    const mimeType = blob.type || 'audio/webm';
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv,
        additionalData: getVoiceNoteAad(dateString, id, mimeType),
        tagLength: 128
    }, key, await blob.arrayBuffer());

    return {
        id,
        dateString,
        version: 1,
        algorithm: 'AES-256-GCM',
        mimeType,
        capturedAt,
        iv: toBase64(iv),
        ciphertext: toBase64(ciphertext)
    };
}

export async function decryptVoiceNoteRecord(record, key) {
    if (!validateEncryptedVoiceNoteRecord(record) || !key) {
        throw new TypeError('The encrypted voice note is invalid or the Diary is locked.');
    }
    const plaintext = await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv: fromBase64(record.iv),
        additionalData: getVoiceNoteAad(record.dateString, record.id, record.mimeType),
        tagLength: 128
    }, key, fromBase64(record.ciphertext));
    return new Blob([plaintext], { type: record.mimeType });
}

export function validateEncryptedVoiceNoteRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
    const match = typeof record.id === 'string' ? VOICE_NOTE_ID_PATTERN.exec(record.id) : null;
    if (!match || match[1] !== record.dateString || !isValidDateString(record.dateString)) return false;
    if (record.version !== 1 || record.algorithm !== 'AES-256-GCM') return false;
    if (!isAllowedVoiceNoteMimeType(record.mimeType)) return false;
    if (typeof record.capturedAt !== 'string' || !Number.isFinite(Date.parse(record.capturedAt))) return false;
    if (typeof record.iv !== 'string' || typeof record.ciphertext !== 'string') return false;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(record.iv)
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.ciphertext)) return false;
    try {
        return fromBase64(record.iv).length === 12 && fromBase64(record.ciphertext).length >= 16;
    } catch (error) {
        return false;
    }
}

export function validateEncryptedVoiceNoteBackup(records) {
    return Array.isArray(records)
        && records.length <= 10000
        && records.every(validateEncryptedVoiceNoteRecord)
        && new Set(records.map(record => record.id)).size === records.length;
}

function openVoiceNoteDatabase() {
    if (!globalThis.indexedDB) {
        return Promise.reject(new Error('This browser does not support secure local voice-note storage.'));
    }
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(VOICE_NOTE_DB_NAME, VOICE_NOTE_DB_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(VOICE_NOTE_STORE_NAME)) {
                const store = database.createObjectStore(VOICE_NOTE_STORE_NAME, { keyPath: 'id' });
                store.createIndex('dateString', 'dateString', { unique: false });
            }
            if (!database.objectStoreNames.contains(LEGACY_QUARANTINE_STORE_NAME)) {
                database.createObjectStore(LEGACY_QUARANTINE_STORE_NAME, { keyPath: 'quarantineId' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open local voice-note storage.'));
        request.onblocked = () => reject(new Error('Local voice-note storage is busy in another app tab. Close the other tab and try again.'));
    });
}

function waitForTransaction(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Voice-note storage failed.'));
        transaction.onabort = () => reject(transaction.error || new Error('Voice-note storage was interrupted.'));
    });
}

function waitForRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Voice-note storage request failed.'));
    });
}

export async function saveEncryptedVoiceNote(dateString, blob, key) {
    if (!isValidDateString(dateString)) throw new TypeError('A valid Diary date is required.');
    if (!(blob instanceof Blob) || blob.size === 0 || blob.size > MAX_VOICE_NOTE_BYTES) {
        throw new RangeError('Each new voice note must contain between 1 byte and ' + Math.round(MAX_VOICE_NOTE_BYTES / 1024) + ' KB of audio.');
    }
    if (!isAllowedVoiceNoteMimeType(blob.type || 'audio/webm')) {
        throw new TypeError('This voice-note format is not supported.');
    }
    const id = makeVoiceNoteId(dateString);
    const record = await encryptVoiceNoteBlob(blob, key, dateString, id);
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction(VOICE_NOTE_STORE_NAME, 'readwrite');
        const completed = waitForTransaction(transaction);
        transaction.objectStore(VOICE_NOTE_STORE_NAME).add(record);
        await completed;
        if (globalThis.window?.dispatchEvent && globalThis.CustomEvent) {
            globalThis.window.dispatchEvent(new CustomEvent('faith-focus:local-data-changed', {
                detail: { dateString: record.dateString }
            }));
        }
        return { id: record.id, dateString: record.dateString, capturedAt: record.capturedAt };
    } finally {
        database.close();
    }
}

async function getStoredRecords(dateString = null) {
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction(VOICE_NOTE_STORE_NAME, 'readonly');
        const completed = waitForTransaction(transaction);
        const store = transaction.objectStore(VOICE_NOTE_STORE_NAME);
        const request = dateString
            ? store.index('dateString').getAll(dateString)
            : store.getAll();
        const records = await waitForRequest(request);
        await completed;
        return records;
    } finally {
        database.close();
    }
}

export async function loadEncryptedVoiceNotes(dateString, key) {
    if (!isValidDateString(dateString) || !key) {
        throw new Error('Unlock your Diary to load its saved voice notes.');
    }
    const records = await getStoredRecords(dateString);
    records.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
    const notes = [];
    for (const record of records) {
        notes.push({
            id: record.id,
            dateString: record.dateString,
            capturedAt: record.capturedAt,
            blob: await decryptVoiceNoteRecord(record, key)
        });
    }
    return notes;
}

export async function exportEncryptedVoiceNotes() {
    const records = await getStoredRecords();
    records.sort((left, right) => {
        const dateOrder = left.dateString.localeCompare(right.dateString);
        return dateOrder || Date.parse(left.capturedAt) - Date.parse(right.capturedAt);
    });
    return records;
}

export async function quarantineLegacyWritingRecords(records) {
    if (!Array.isArray(records) || records.length > 10000
        || records.some(item => !item || typeof item.kind !== 'string' || !Object.prototype.hasOwnProperty.call(item, 'record'))) {
        throw new TypeError('The legacy writing quarantine payload is invalid.');
    }
    if (!records.length) return [];
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction(LEGACY_QUARANTINE_STORE_NAME, 'readwrite');
        const completed = waitForTransaction(transaction);
        const store = transaction.objectStore(LEGACY_QUARANTINE_STORE_NAME);
        const ids = [];
        records.forEach((item, index) => {
            const random = crypto.getRandomValues(new Uint8Array(8));
            const suffix = Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
            const quarantineId = 'legacy-' + Date.now().toString(36) + '-' + index + '-' + suffix;
            ids.push(quarantineId);
            store.add({
                quarantineId,
                version: 1,
                kind: item.kind,
                dateString: typeof item.dateString === 'string' ? item.dateString : null,
                originalId: item.id == null ? null : String(item.id),
                record: item.record,
                reason: String(item.reason || 'Unspecified legacy migration failure'),
                quarantinedAt: new Date().toISOString()
            });
        });
        await completed;
        return ids;
    } finally {
        database.close();
    }
}

export async function restoreEncryptedVoiceNotes(records) {
    if (!validateEncryptedVoiceNoteBackup(records)) {
        throw new Error('The backup contains invalid encrypted voice-note records.');
    }
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction(VOICE_NOTE_STORE_NAME, 'readwrite');
        const completed = waitForTransaction(transaction);
        const store = transaction.objectStore(VOICE_NOTE_STORE_NAME);
        store.clear();
        records.forEach(record => store.put(record));
        await completed;
    } finally {
        database.close();
    }
}


export async function exportEncryptedVoiceNotesForDate(dateString) {
    if (!isValidDateString(dateString)) throw new TypeError('A valid Diary date is required.');
    const records = await getStoredRecords(dateString);
    records.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
    return records;
}

export async function restoreEncryptedVoiceNotesForDate(dateString, records) {
    if (!isValidDateString(dateString)
        || !validateEncryptedVoiceNoteBackup(records)
        || records.some(record => record.dateString !== dateString)) {
        throw new Error('The daily packet contains invalid voice-note records.');
    }
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction(VOICE_NOTE_STORE_NAME, 'readwrite');
        const completed = waitForTransaction(transaction);
        const store = transaction.objectStore(VOICE_NOTE_STORE_NAME);
        const request = store.index('dateString').getAllKeys(dateString);
        request.onsuccess = () => {
            for (const key of request.result) store.delete(key);
            records.forEach(record => store.put(record));
        };
        request.onerror = () => {
            try { transaction.abort(); } catch { /* The transaction may already be closed. */ }
        };
        await completed;
    } finally {
        database.close();
    }
}

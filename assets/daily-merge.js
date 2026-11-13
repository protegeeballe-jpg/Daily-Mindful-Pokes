import { loadLocationCheckinEntries } from './location-checkin.js';
import { validateEncryptedVoiceNoteRecord } from './voice-note-store.js';
import {
    GARDEN_DAILY_SYNC_PREFIX,
    mergeGardenStates,
    validateGardenState
} from './garden-model.js';

export const PRIVATE_WRITING_MERGE_SEPARATOR =
    '\n\n--- Additional entry synced from another device ---\n\n';

export function mergePrivateWritingText(localValue, remoteValue) {
    const segments = [...new Set([localValue, remoteValue]
        .filter(value => typeof value === 'string' && value.length > 0)
        .flatMap(value => value.split(PRIVATE_WRITING_MERGE_SEPARATOR)))];
    if (!segments.length) return '';
    segments.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    return segments.join(PRIVATE_WRITING_MERGE_SEPARATOR);
}

function parseObjectRecord(raw, label) {
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error('The ' + label + ' record could not be reconciled safely. Both device copies remain preserved.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The ' + label + ' record has an unsupported format. Both device copies remain preserved.');
    }
    return parsed;
}

function mergeObjectValues(localValue, remoteValue, path = 'record') {
    const merged = {};
    for (const key of [...new Set([...Object.keys(localValue || {}), ...Object.keys(remoteValue || {})])].sort()) {
        const left = localValue?.[key];
        const right = remoteValue?.[key];
        if (left === undefined) { merged[key] = right; continue; }
        if (right === undefined) { merged[key] = left; continue; }
        if (JSON.stringify(left) === JSON.stringify(right)) { merged[key] = right; continue; }
        if (typeof left === 'boolean' && typeof right === 'boolean') {
            merged[key] = left || right;
            continue;
        }
        if (typeof left === 'number' && typeof right === 'number' && key === 'cloud_flow_version') {
            merged[key] = Math.max(left, right);
            continue;
        }
        if (Array.isArray(left) && Array.isArray(right)) {
            const values = new Map();
            [...left, ...right].forEach(value => values.set(JSON.stringify(value), value));
            merged[key] = [...values.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
            continue;
        }
        if (left && right && typeof left === 'object' && typeof right === 'object'
            && !Array.isArray(left) && !Array.isArray(right)) {
            merged[key] = mergeObjectValues(left, right, path + '.' + key);
            continue;
        }
        throw new Error('The ' + path + '.' + key + ' values differ and cannot be combined automatically. Both device copies remain preserved.');
    }
    return merged;
}

export function mergeChecklistRecordValues(localRaw, remoteRaw) {
    if (localRaw == null) return remoteRaw;
    if (remoteRaw == null) return localRaw;
    if (localRaw === remoteRaw) return remoteRaw;
    return JSON.stringify(mergeObjectValues(
        parseObjectRecord(localRaw, 'checklist'),
        parseObjectRecord(remoteRaw, 'checklist'),
        'checklist'
    ));
}

function parseLocationEntries(raw, dateString) {
    if (raw == null) return [];
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error('A location-history record could not be read. Both device copies remain preserved.'); }
    if (!Array.isArray(parsed) && (!parsed || typeof parsed !== 'object')) {
        throw new Error('A location-history record has an unsupported format. Both device copies remain preserved.');
    }
    const expectedCount = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
    const entries = loadLocationCheckinEntries({ getItem: () => raw }, dateString);
    if (entries.length !== expectedCount) {
        throw new Error('A location-history record contains entries that could not be validated. Both device copies remain preserved.');
    }
    return entries;
}

export function mergeLocationCheckinRecordValues(localRaw, remoteRaw, dateString) {
    if (localRaw == null) return remoteRaw;
    if (remoteRaw == null) return localRaw;
    const entries = new Map();
    for (const entry of [...parseLocationEntries(localRaw, dateString), ...parseLocationEntries(remoteRaw, dateString)]) {
        const key = [entry.locationId, entry.capturedAt, entry.latitude, entry.longitude, entry.accuracyMeters].join('|');
        entries.set(key, entry);
    }
    const merged = [...entries.values()].sort((left, right) =>
        left.capturedAt.localeCompare(right.capturedAt)
        || left.locationId.localeCompare(right.locationId)
        || left.latitude - right.latitude
        || left.longitude - right.longitude
    );
    return JSON.stringify(merged);
}

export function mergeEncryptedVoiceNoteRecords(localRecords, remoteRecords, dateString) {
    if (!Array.isArray(localRecords) || !Array.isArray(remoteRecords)) {
        throw new Error('Voice-note records could not be reconciled safely. Both device copies remain preserved.');
    }
    const records = new Map();
    for (const record of [...localRecords, ...remoteRecords]) {
        if (!validateEncryptedVoiceNoteRecord(record) || record.dateString !== dateString) {
            throw new Error('A voice-note record failed validation. Both device copies remain preserved.');
        }
        const previous = records.get(record.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
            throw new Error('Two different voice-note records share an identifier. Both device copies remain preserved.');
        }
        records.set(record.id, previous || record);
    }
    return [...records.values()].sort((left, right) =>
        left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id)
    );
}

function parseGardenRecord(raw) {
    if (raw == null) return null;
    let value;
    try { value = JSON.parse(raw); }
    catch { throw new Error('The Garden record could not be reconciled safely. Both device copies remain preserved.'); }
    const state = validateGardenState(value);
    if (!state) throw new Error('The Garden record is invalid. Both device copies remain preserved.');
    return state;
}

function mergeAwardRecord(localValue, remoteValue) {
    if (localValue == null) return remoteValue;
    if (remoteValue == null) return localValue;
    if (localValue === remoteValue) return remoteValue;
    if (localValue === 'true' || remoteValue === 'true') return 'true';
    throw new Error('The daily award record differs between devices. Both device copies remain preserved.');
}

function mergeConfidenceScore(localValue, remoteValue) {
    if (localValue == null) return remoteValue;
    if (remoteValue == null) return localValue;
    const localNumber = Number(localValue);
    const remoteNumber = Number(remoteValue);
    if (Number.isFinite(localNumber) && Number.isFinite(remoteNumber)) {
        return String(Math.max(localNumber, remoteNumber));
    }
    return remoteValue;
}

export async function mergeDailyBundles(localBundle, remoteBundle, {
    dateString,
    mergePrivateWriting,
    isUsableLegacyWritingConfig = () => false
} = {}) {
    if (!localBundle || !remoteBundle || localBundle.dateString !== dateString
        || remoteBundle.dateString !== dateString || typeof mergePrivateWriting !== 'function') {
        throw new TypeError('Two valid daily bundles and a private-writing merge function are required.');
    }
    const localRecords = localBundle.records || {};
    const remoteRecords = remoteBundle.records || {};
    const diaryKey = 'dmp_diary_cipher_v1_' + dateString;
    const notesKey = 'dmp_notes_cipher_v1_' + dateString;
    const privateResult = await mergePrivateWriting(
        { diary: localRecords[diaryKey] ?? null, notes: localRecords[notesKey] ?? null },
        { diary: remoteRecords[diaryKey] ?? null, notes: remoteRecords[notesKey] ?? null }
    );

    const records = {};
    const keys = [...new Set([...Object.keys(localRecords), ...Object.keys(remoteRecords)])].sort();
    for (const key of keys) {
        if (key === diaryKey || key === notesKey) continue;
        const localValue = localRecords[key];
        const remoteValue = remoteRecords[key];
        if (localValue === undefined) { records[key] = remoteValue; continue; }
        if (remoteValue === undefined) { records[key] = localValue; continue; }
        if (localValue === remoteValue) { records[key] = remoteValue; continue; }
        if (key === 'mindful_pokes_data_' + dateString) {
            records[key] = mergeChecklistRecordValues(localValue, remoteValue);
        } else if (key === 'faith_focus_location_checkins_v1_' + dateString) {
            records[key] = mergeLocationCheckinRecordValues(localValue, remoteValue, dateString);
        } else if (key === GARDEN_DAILY_SYNC_PREFIX + dateString) {
            const garden = mergeGardenStates(parseGardenRecord(localValue), parseGardenRecord(remoteValue));
            records[key] = garden ? JSON.stringify(garden) : remoteValue;
        } else if (key === 'score_awarded_' + dateString) {
            records[key] = mergeAwardRecord(localValue, remoteValue);
        } else {
            throw new Error('The daily record ' + key + ' differs between devices and cannot be combined automatically. Both device copies remain preserved.');
        }
    }
    if (privateResult.diary !== null && privateResult.diary !== undefined) records[diaryKey] = privateResult.diary;
    if (privateResult.notes !== null && privateResult.notes !== undefined) records[notesKey] = privateResult.notes;

    const localState = localBundle.appState || {};
    const remoteState = remoteBundle.appState || {};
    const gardenCandidates = [
        parseGardenRecord(localState.garden),
        parseGardenRecord(remoteState.garden),
        parseGardenRecord(localRecords[GARDEN_DAILY_SYNC_PREFIX + dateString]),
        parseGardenRecord(remoteRecords[GARDEN_DAILY_SYNC_PREFIX + dateString])
    ];
    let garden = null;
    for (const candidate of gardenCandidates) garden = mergeGardenStates(garden, candidate);
    const appState = {
        ...remoteState,
        ...localState,
        confidenceScore: mergeConfidenceScore(localState.confidenceScore, remoteState.confidenceScore)
    };
    const localLegacy = localState.legacyWritingConfig;
    const remoteLegacy = remoteState.legacyWritingConfig;
    appState.legacyWritingConfig = isUsableLegacyWritingConfig(remoteLegacy)
        ? remoteLegacy
        : isUsableLegacyWritingConfig(localLegacy) ? localLegacy : (remoteLegacy ?? localLegacy ?? null);
    if (garden) {
        const gardenText = JSON.stringify(garden);
        records[GARDEN_DAILY_SYNC_PREFIX + dateString] = gardenText;
        appState.garden = gardenText;
    }

    return {
        ...remoteBundle,
        createdAt: new Date().toISOString(),
        records,
        voiceNotes: mergeEncryptedVoiceNoteRecords(localBundle.voiceNotes, remoteBundle.voiceNotes, dateString),
        appState
    };
}

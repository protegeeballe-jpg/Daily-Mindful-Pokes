import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PRIVATE_WRITING_MERGE_SEPARATOR,
    mergePrivateWritingText,
    mergeLocationCheckinRecordValues,
    mergeChecklistRecordValues,
    mergeEncryptedVoiceNoteRecords,
    mergeDailyBundles
} from '../assets/daily-merge.js';

const dateString = '2026-11-13';

function location(locationId, latitude, longitude, capturedAt) {
    return { locationId, latitude, longitude, accuracyMeters: 12, capturedAt };
}

function voiceNote(suffix, capturedAt) {
    return {
        id: dateString + '-' + suffix.repeat(32),
        dateString,
        version: 1,
        algorithm: 'AES-256-GCM',
        mimeType: 'audio/webm',
        capturedAt,
        iv: 'AAAAAAAAAAAAAAAA',
        ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA=='
    };
}

test('private writing text merges unique device entries in a stable, repeatable form', () => {
    const laptop = 'Laptop diary entry';
    const phone = 'Phone diary entry';
    const merged = mergePrivateWritingText(laptop, phone);

    assert.ok(merged.includes(laptop));
    assert.ok(merged.includes(phone));
    assert.ok(merged.includes(PRIVATE_WRITING_MERGE_SEPARATOR));
    assert.equal(mergePrivateWritingText(merged, laptop), merged);
    assert.equal(mergePrivateWritingText(merged, phone), merged);
    assert.equal(mergePrivateWritingText(laptop, laptop), laptop);
    assert.equal(mergePrivateWritingText('', phone), phone);
});

test('checklist states merge checked progress from both devices without unchecking either', () => {
    const local = JSON.stringify({
        'start-1': true,
        'start-2': false,
        'start-1__guided': true,
        cloud_flow_version: 1
    });
    const remote = JSON.stringify({
        'start-1': false,
        'start-2': true,
        'start-2__guided': true,
        cloud_flow_version: 1
    });
    const merged = JSON.parse(mergeChecklistRecordValues(local, remote));

    assert.equal(merged['start-1'], true);
    assert.equal(merged['start-2'], true);
    assert.equal(merged['start-1__guided'], true);
    assert.equal(merged['start-2__guided'], true);
    assert.equal(merged.cloud_flow_version, 1);
});

test('location check-in history is combined and duplicate captures are not repeated', () => {
    const laptop = location('loc-home', 14.5, 120.9, '2026-11-13T01:00:00.000Z');
    const phone = location('loc-office', 14.6, 121.0, '2026-11-13T02:00:00.000Z');
    const local = JSON.stringify([laptop]);
    const remote = JSON.stringify([phone, laptop]);
    const merged = JSON.parse(mergeLocationCheckinRecordValues(local, remote, dateString));

    assert.equal(merged.length, 2);
    assert.deepEqual(merged.map(item => item.locationId), ['loc-home', 'loc-office']);
    assert.equal(merged[0].latitude, 14.5);
    assert.equal(merged[1].longitude, 121.0);
});

test('encrypted voice-note records are unioned by id and sorted by capture time', () => {
    const laptop = voiceNote('a', '2026-11-13T01:00:00.000Z');
    const phone = voiceNote('b', '2026-11-13T02:00:00.000Z');
    const merged = mergeEncryptedVoiceNoteRecords([laptop], [phone, laptop], dateString);

    assert.equal(merged.length, 2);
    assert.deepEqual(merged.map(item => item.id), [laptop.id, phone.id]);
});

test('same-day bundles merge Diary, notes, checklist, location, voice notes, and shared score state', async () => {
    const laptopLocation = location('loc-home', 14.5, 120.9, '2026-11-13T01:00:00.000Z');
    const phoneLocation = location('loc-office', 14.6, 121.0, '2026-11-13T02:00:00.000Z');
    const laptopVoice = voiceNote('a', '2026-11-13T01:10:00.000Z');
    const phoneVoice = voiceNote('b', '2026-11-13T02:10:00.000Z');
    const checklistKey = 'mindful_pokes_data_' + dateString;
    const locationKey = 'faith_focus_location_checkins_v1_' + dateString;
    const diaryKey = 'dmp_diary_cipher_v1_' + dateString;
    const notesKey = 'dmp_notes_cipher_v1_' + dateString;

    const localBundle = {
        dateString,
        records: {
            [checklistKey]: JSON.stringify({ 'start-1': true, 'start-2': false }),
            [locationKey]: JSON.stringify([laptopLocation]),
            [diaryKey]: 'laptop-encrypted-diary',
            [notesKey]: 'laptop-encrypted-notes'
        },
        voiceNotes: [laptopVoice],
        appState: { confidenceScore: '100' }
    };
    const remoteBundle = {
        dateString,
        records: {
            [checklistKey]: JSON.stringify({ 'start-1': false, 'start-2': true }),
            [locationKey]: JSON.stringify([phoneLocation]),
            [diaryKey]: 'phone-encrypted-diary',
            [notesKey]: 'phone-encrypted-notes'
        },
        voiceNotes: [phoneVoice],
        appState: { confidenceScore: '200' }
    };

    const merged = await mergeDailyBundles(localBundle, remoteBundle, {
        dateString,
        mergePrivateWriting: async (local, remote) => ({
            diary: local.diary + '+' + remote.diary,
            notes: local.notes + '+' + remote.notes
        })
    });

    assert.equal(merged.records[diaryKey], 'laptop-encrypted-diary+phone-encrypted-diary');
    assert.equal(merged.records[notesKey], 'laptop-encrypted-notes+phone-encrypted-notes');
    assert.equal(merged.voiceNotes.length, 2);
    assert.equal(JSON.parse(merged.records[locationKey]).length, 2);
    assert.deepEqual(JSON.parse(merged.records[checklistKey]), { 'start-1': true, 'start-2': true });
    assert.equal(merged.appState.confidenceScore, '200');
});

test('a conflicting unrecognized daily field stops reconciliation rather than discarding either copy', async () => {
    const localBundle = {
        dateString,
        records: { ['unknown_' + dateString]: 'local value' },
        voiceNotes: [],
        appState: {}
    };
    const remoteBundle = {
        dateString,
        records: { ['unknown_' + dateString]: 'remote value' },
        voiceNotes: [],
        appState: {}
    };

    await assert.rejects(
        mergeDailyBundles(localBundle, remoteBundle, {
            dateString,
            mergePrivateWriting: async () => ({ diary: null, notes: null })
        }),
        /Both device copies remain preserved/
    );
});

test('invalid voice-note data blocks the merge safely', () => {
    const invalid = { ...voiceNote('a', '2026-11-13T01:00:00.000Z'), ciphertext: 'bad' };
    assert.throws(
        () => mergeEncryptedVoiceNoteRecords([invalid], [], dateString),
        /Both device copies remain preserved/
    );
});

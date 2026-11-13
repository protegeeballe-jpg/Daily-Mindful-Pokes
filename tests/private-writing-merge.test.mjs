import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
    buildPrivateWritingNotesPayload,
    isCurrentPrivateWritingDate,
    mergeEncryptedPrivateWritingRecords
} from '../assets/writing-security.js';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const dateString = '2026-11-13';
const encoder = new TextEncoder();
const NOTE_META = '__privateNoteUpdatedAt';

function toBase64(value) {
    return Buffer.from(value).toString('base64');
}

async function encryptPrivateRecord(kind, value, key) {
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const additionalData = encoder.encode(
        'Daily Mindful Pokes|private-writing|' + kind + '|v1|' + dateString
    );
    const ciphertext = await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
        key,
        encoder.encode(JSON.stringify(value))
    );
    return JSON.stringify({
        version: 1,
        algorithm: 'AES-256-GCM',
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(ciphertext))
    });
}

async function decryptPrivateRecord(kind, record, key) {
    const encrypted = JSON.parse(record);
    const additionalData = encoder.encode(
        'Daily Mindful Pokes|private-writing|' + kind + '|v1|' + dateString
    );
    const plaintext = await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Buffer.from(encrypted.iv, 'base64'), additionalData, tagLength: 128 },
        key,
        Buffer.from(encrypted.ciphertext, 'base64')
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
}

test('Diary entries still merge, while reflection fields use their newest revision', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const localDiary = await encryptPrivateRecord('diary', 'Laptop diary entry', key);
    const remoteDiary = await encryptPrivateRecord('diary', 'Phone diary entry', key);
    const localNotes = await encryptPrivateRecord('notes', {
        'note-success': 'Laptop success',
        'note-priorities': 'Laptop priority',
        [NOTE_META]: { 'note-success': 100, 'note-priorities': 100 }
    }, key);
    const remoteNotes = await encryptPrivateRecord('notes', {
        'note-success': 'Phone success edited later',
        'note-gratitude-god': 'Phone gratitude',
        [NOTE_META]: { 'note-success': 200, 'note-gratitude-god': 200 }
    }, key);

    const merged = await mergeEncryptedPrivateWritingRecords(dateString, {
        diary: localDiary,
        notes: localNotes
    }, {
        diary: remoteDiary,
        notes: remoteNotes
    }, key);

    const diary = await decryptPrivateRecord('diary', merged.diary, key);
    const notes = await decryptPrivateRecord('notes', merged.notes, key);
    assert.ok(diary.includes('Laptop diary entry'));
    assert.ok(diary.includes('Phone diary entry'));
    assert.equal(notes['note-success'], 'Phone success edited later');
    assert.equal(notes['note-priorities'], 'Laptop priority');
    assert.equal(notes['note-gratitude-god'], 'Phone gratitude');
    assert.equal(notes[NOTE_META]['note-success'], 200);
    assert.notEqual(merged.diary, 'Laptop diary entry');
});

test('a newer blank note is retained as a deletion instead of restoring stale text', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const localNotes = await encryptPrivateRecord('notes', {
        'note-success': '',
        [NOTE_META]: { 'note-success': 300 }
    }, key);
    // A legacy record has no revision metadata and is therefore older than the explicit clear.
    const remoteNotes = await encryptPrivateRecord('notes', {
        'note-success': 'The note that was deleted'
    }, key);

    const merged = await mergeEncryptedPrivateWritingRecords(
        dateString,
        { notes: localNotes },
        { notes: remoteNotes },
        key
    );
    const notes = await decryptPrivateRecord('notes', merged.notes, key);

    assert.equal(notes['note-success'], '');
    assert.equal(notes[NOTE_META]['note-success'], 300);
});

test('saving a replacement or clearing a note advances only that note field revision', () => {
    const next = buildPrivateWritingNotesPayload(
        { 'note-success': '', 'note-priorities': 'Keep this priority' },
        { 'note-success': 'Old success', 'note-priorities': 'Keep this priority' },
        { 'note-success': 100, 'note-priorities': 50 },
        200
    );

    assert.equal(next['note-success'], '');
    assert.equal(next['note-priorities'], 'Keep this priority');
    assert.equal(next[NOTE_META]['note-success'], 200);
    assert.equal(next[NOTE_META]['note-priorities'], 50);
});

test('unreadable encrypted writing blocks the merge without changing either source record', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const local = JSON.stringify({ version: 1, algorithm: 'AES-256-GCM', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==' });
    const remote = JSON.stringify({ version: 1, algorithm: 'AES-256-GCM', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'BBBBBBBBBBBBBBBBBBBBBB==' });

    await assert.rejects(
        mergeEncryptedPrivateWritingRecords(dateString, { diary: local, notes: null }, { diary: remote, notes: null }, key),
        /Both device copies remain preserved/
    );
    assert.equal(JSON.parse(local).version, 1);
    assert.equal(JSON.parse(remote).version, 1);
});


test('only the current device date is writable in the private Diary', () => {
    assert.equal(isCurrentPrivateWritingDate('2026-11-13', '2026-11-13'), true);
    assert.equal(isCurrentPrivateWritingDate('2026-11-12', '2026-11-13'), false);
    assert.equal(isCurrentPrivateWritingDate('2026-11-14', '2026-11-13'), false);
    assert.equal(isCurrentPrivateWritingDate('not-a-date', '2026-11-13'), false);
});

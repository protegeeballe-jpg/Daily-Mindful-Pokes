import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mergeEncryptedPrivateWritingRecords } from '../assets/writing-security.js';

globalThis.crypto = webcrypto;

const dateString = '2026-11-13';
const encoder = new TextEncoder();

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

test('private Diary and reflection records merge under the account key while remaining encrypted', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const localDiary = await encryptPrivateRecord('diary', 'Laptop diary entry', key);
    const remoteDiary = await encryptPrivateRecord('diary', 'Phone diary entry', key);
    const localNotes = await encryptPrivateRecord('notes', {
        'note-success': 'Laptop success',
        'note-priorities': 'Laptop priority'
    }, key);
    const remoteNotes = await encryptPrivateRecord('notes', {
        'note-success': 'Phone success',
        'note-gratitude-god': 'Phone gratitude'
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
    assert.ok(notes['note-success'].includes('Laptop success'));
    assert.ok(notes['note-success'].includes('Phone success'));
    assert.equal(notes['note-priorities'], 'Laptop priority');
    assert.equal(notes['note-gratitude-god'], 'Phone gratitude');
    assert.notEqual(merged.diary, 'Laptop diary entry');
    assert.notEqual(merged.notes, 'Laptop success');
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

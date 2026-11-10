import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
    decryptVoiceNoteRecord,
    encryptVoiceNoteBlob,
    validateEncryptedVoiceNoteBackup,
    validateEncryptedVoiceNoteRecord
} from '../assets/voice-note-store.js';

const DATE = '2026-11-10';
const ID = DATE + '-0123456789abcdef0123456789abcdef';

async function createKey() {
    return webcrypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

test('voice notes are encrypted and decrypt to the original recording bytes', async () => {
    const key = await createKey();
    const original = new Blob([new Uint8Array([0, 1, 2, 3, 128, 255, 42])], { type: 'audio/webm;codecs=opus' });
    const encrypted = await encryptVoiceNoteBlob(original, key, DATE, ID, '2026-11-10T12:00:00.000Z');

    assert.equal(validateEncryptedVoiceNoteRecord(encrypted), true);
    assert.equal(encrypted.algorithm, 'AES-256-GCM');
    assert.notEqual(encrypted.ciphertext, 'AAECA4D/Kg==');

    const restored = await decryptVoiceNoteRecord(encrypted, key);
    assert.equal(restored.type, original.type);
    assert.deepEqual(
        new Uint8Array(await restored.arrayBuffer()),
        new Uint8Array(await original.arrayBuffer())
    );
});

test('voice-note ciphertext is bound to its date and identifier', async () => {
    const key = await createKey();
    const encrypted = await encryptVoiceNoteBlob(
        new Blob(['private audio bytes'], { type: 'audio/webm' }),
        key,
        DATE,
        ID,
        '2026-11-10T12:00:00.000Z'
    );

    await assert.rejects(
        decryptVoiceNoteRecord({ ...encrypted, dateString: '2026-11-11' }, key)
    );
    await assert.rejects(
        decryptVoiceNoteRecord({ ...encrypted, id: DATE + '-ffffffffffffffffffffffffffffffff' }, key)
    );
});

test('voice-note backup validation rejects malformed records and duplicate identifiers', async () => {
    const key = await createKey();
    const valid = await encryptVoiceNoteBlob(
        new Blob(['private audio bytes'], { type: 'audio/webm' }),
        key,
        DATE,
        ID,
        '2026-11-10T12:00:00.000Z'
    );

    assert.equal(validateEncryptedVoiceNoteBackup([valid]), true);
    assert.equal(validateEncryptedVoiceNoteBackup([]), true);
    assert.equal(validateEncryptedVoiceNoteBackup([valid, valid]), false);
    assert.equal(validateEncryptedVoiceNoteBackup([{ ...valid, ciphertext: 'not base64!' }]), false);
    assert.equal(validateEncryptedVoiceNoteBackup({ records: [valid] }), false);
});

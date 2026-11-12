import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import {
  VAULT_KDF_ITERATIONS, MIN_PASSPHRASE_LENGTH, MAX_PASSPHRASE_LENGTH,
  deriveVaultCredentials, validateVaultUsername, validateVaultPassphrase,
  encryptDailyBundle, decryptDailyBundle, isValidEncryptedPacket
} from '../assets/vault-crypto.js';

const base64 = value => Buffer.from(value, 'utf8').toString('base64');
const unbase64 = value => Buffer.from(value, 'base64').toString('utf8');

test('account identity is normalized and the Vault ID is independent of the passphrase', async () => {
  assert.equal(VAULT_KDF_ITERATIONS, 600000);
  assert.equal(MIN_PASSPHRASE_LENGTH, 12);
  assert.equal(MAX_PASSPHRASE_LENGTH, 128);
  assert.deepEqual(validateVaultUsername('  LIZ_2026  '), {
    valid: true,
    normalized: 'liz_2026'
  });
  assert.equal(validateVaultUsername('ab').valid, false);
  assert.equal(validateVaultUsername('name with spaces').valid, false);

  const first = await deriveVaultCredentials('Family.Vault', 'a-strong-passphrase-2026', webcrypto);
  const second = await deriveVaultCredentials('family.vault', 'a-different-passphrase-2026', webcrypto);
  assert.equal(first.vaultId, second.vaultId);
  assert.notDeepEqual(first.writeToken, second.writeToken);
  assert.equal(first.writeToken.length, 32);
  assert.equal(first.encryptionKey.algorithm.name, 'AES-GCM');
  assert.equal(first.encryptionKey.algorithm.length, 256);
});

test('passphrase policy enforces 12 to 128 characters', () => {
  assert.equal(validateVaultPassphrase('twelve_chars!').valid, true);
  assert.equal(validateVaultPassphrase('short').valid, false);
  assert.equal(validateVaultPassphrase('x'.repeat(129)).valid, false);
  assert.equal(validateVaultPassphrase('valid-phrase-123').valid, true);
});

test('daily bundle is compressed before AES-GCM encryption and round-trips safely', async () => {
  const credentials = await deriveVaultCredentials('test.family', 'correct-horse-battery-2026', webcrypto);
  const bundle = {
    format: 'faith-focus-daily-bundle',
    version: 1,
    dateString: '2026-11-12',
    createdAt: '2026-11-12T10:00:00.000Z',
    records: {
      'mindful_pokes_data_2026-11-12': JSON.stringify({
        'start-1': true,
        'start-2': false,
        'mid-1': false
      }),
      'faith_focus_location_checkins_v1_2026-11-12': JSON.stringify([{ place: 'Home', lat: 14.6, lng: 121.1 }])
    },
    voiceNotes: [{ dateString: '2026-11-12', ciphertext: 'already-encrypted-audio' }],
    appState: { garden: null, confidenceScore: '10', legacyWritingConfig: null }
  };
  let compressorCalled = false;
  const compressor = async serialized => {
    compressorCalled = true;
    return base64(serialized);
  };
  const decompressor = async compressed => unbase64(compressed);

  const packet = await encryptDailyBundle(bundle, credentials.encryptionKey, compressor, webcrypto);
  assert.equal(compressorCalled, true);
  assert.equal(packet.compression, 'gzip-base64');
  assert.equal(packet.algorithm, 'AES-256-GCM');
  assert.equal(packet.dateString, bundle.dateString);
  assert.equal(isValidEncryptedPacket(packet), true);
  assert.equal(JSON.stringify(packet).includes('Home'), false);
  assert.deepEqual(await decryptDailyBundle(packet, credentials.encryptionKey, decompressor, webcrypto), bundle);

  const otherCredentials = await deriveVaultCredentials('test.family', 'another-strong-passphrase-2026', webcrypto);
  await assert.rejects(
    decryptDailyBundle(packet, otherCredentials.encryptionKey, decompressor, webcrypto),
    /could not be decrypted/
  );
});

test('packet validation rejects wrong dates, algorithms, and malformed IVs', async () => {
  const credentials = await deriveVaultCredentials('test.family', 'correct-horse-battery-2026', webcrypto);
  const packet = await encryptDailyBundle({
    format: 'faith-focus-daily-bundle',
    version: 1,
    dateString: '2026-11-12',
    records: {},
    voiceNotes: []
  }, credentials.encryptionKey, async value => value, webcrypto);

  assert.equal(isValidEncryptedPacket(packet), true);
  assert.equal(isValidEncryptedPacket({ ...packet, algorithm: 'AES-128-GCM' }), false);
  assert.equal(isValidEncryptedPacket({ ...packet, dateString: '2026-02-30' }), false);
  assert.equal(isValidEncryptedPacket({ ...packet, iv: 'bad' }), false);
});

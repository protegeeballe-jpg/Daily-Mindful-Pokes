import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import {
  VAULT_KDF_ITERATIONS, MIN_PASSPHRASE_LENGTH, MAX_PASSPHRASE_LENGTH,
  RECOVERY_KDF_ITERATIONS, SECURITY_QUESTIONS,
  deriveVaultCredentials, deriveLegacyVaultCredentials,
  createNewVaultAccount, unlockVaultAccount, deriveVaultCredentialsFromMaster,
  wrapMasterKeyWithRecovery, unwrapMasterKeyWithRecovery, createPassphraseEnvelope,
  validateVaultUsername, validateVaultPassphrase, validateSecurityAnswer, validateSecuritySetup,
  encryptDailyBundle, decryptDailyBundle, isValidEncryptedPacket, wipeVaultCredentials
} from '../assets/vault-crypto.js';

const base64 = value => Buffer.from(value, 'utf8').toString('base64');
const unbase64 = value => Buffer.from(value, 'base64').toString('utf8');

test('legacy account identity remains compatible with already-encrypted vault packets', async () => {
  assert.equal(VAULT_KDF_ITERATIONS, 600000);
  assert.equal(MIN_PASSPHRASE_LENGTH, 12);
  assert.equal(MAX_PASSPHRASE_LENGTH, 128);
  assert.deepEqual(validateVaultUsername('  LIZ_2026  '), {
    valid: true,
    normalized: 'liz_2026'
  });
  assert.equal(validateVaultUsername('ab').valid, false);
  assert.equal(validateVaultUsername('name with spaces').valid, false);

  const first = await deriveLegacyVaultCredentials('Family.Vault', 'a-strong-passphrase-2026', webcrypto);
  const second = await deriveVaultCredentials('family.vault', 'a-different-passphrase-2026', webcrypto);
  assert.equal(first.vaultId, second.vaultId);
  assert.notDeepEqual(first.writeToken, second.writeToken);
  assert.equal(first.writeToken.length, 32);
  assert.equal(first.encryptionKey.algorithm.name, 'AES-GCM');
  assert.equal(first.encryptionKey.algorithm.length, 256);
  wipeVaultCredentials(first);
  wipeVaultCredentials(second);
});

test('passphrase policy enforces 12 to 128 characters', () => {
  assert.equal(validateVaultPassphrase('twelve_chars!').valid, true);
  assert.equal(validateVaultPassphrase('short').valid, false);
  assert.equal(validateVaultPassphrase('x'.repeat(129)).valid, false);
  assert.equal(validateVaultPassphrase('valid-phrase-123').valid, true);
});

test('security answers are three distinct one-word case-sensitive values', () => {
  assert.equal(SECURITY_QUESTIONS.length, 20);
  assert.equal(SECURITY_QUESTIONS[0], 'What is the name of your first pet?');
  assert.equal(SECURITY_QUESTIONS[19], 'What is your favorite music intrument?');
  assert.equal(validateSecurityAnswer('Milo').valid, true);
  assert.equal(validateSecurityAnswer('milo').valid, true);
  assert.equal(validateSecurityAnswer('two words').valid, false);
  assert.equal(validateSecurityAnswer(' two').valid, false);
  assert.equal(validateSecurityAnswer('word ').valid, false);
  assert.equal(validateSecuritySetup([1, 2, 3], ['Milo', 'Pizza', 'Maple']).valid, true);
  assert.equal(validateSecuritySetup([1, 1, 3], ['Milo', 'Pizza', 'Maple']).valid, false);
  assert.equal(validateSecuritySetup([1, 2, 3], ['Milo', 'two words', 'Maple']).valid, false);
});

test('permanent master key survives passphrase changes and username changes', async () => {
  assert.equal(RECOVERY_KDF_ITERATIONS, 900000);
  const questionIds = [1, 6, 13];
  const answers = ['Milo', 'Bluejay', 'SailorMoon'];
  const account = await createNewVaultAccount(
    'Family.Vault', 'correct-horse-battery-2026', questionIds, answers, webcrypto
  );
  assert.match(account.vaultId, /^[a-f0-9]{64}$/);
  assert.equal(account.encryptionKey.algorithm.name, 'AES-GCM');
  assert.equal(account.writeToken.length, 32);

  const signedIn = await unlockVaultAccount(
    'family.vault', 'correct-horse-battery-2026',
    account.vaultId, account.passphraseEnvelope, webcrypto
  );
  assert.deepEqual(signedIn.masterKeyBytes, account.masterKeyBytes);
  assert.deepEqual(signedIn.writeToken, account.writeToken);

  const recoveredRaw = await unwrapMasterKeyWithRecovery(
    account.recoveryEnvelope,
    [13, 1, 6],
    ['SailorMoon', 'Milo', 'Bluejay'],
    webcrypto
  );
  assert.deepEqual(recoveredRaw, account.masterKeyBytes);

  const reordered = await deriveVaultCredentialsFromMaster(
    account.vaultId, recoveredRaw, 'new.username', webcrypto
  );
  assert.equal(reordered.vaultId, account.vaultId);
  assert.equal(reordered.username, 'new.username');
  assert.deepEqual(reordered.writeToken, account.writeToken);

  const changedEnvelope = await createPassphraseEnvelope(
    recoveredRaw, 'a-new-and-different-passphrase-2026', webcrypto
  );
  const resetAccount = await unlockVaultAccount(
    'new.username', 'a-new-and-different-passphrase-2026',
    account.vaultId, changedEnvelope, webcrypto
  );
  assert.equal(resetAccount.vaultId, account.vaultId);
  assert.deepEqual(resetAccount.masterKeyBytes, account.masterKeyBytes);
  assert.deepEqual(resetAccount.writeToken, account.writeToken);

  await assert.rejects(
    unwrapMasterKeyWithRecovery(account.recoveryEnvelope, questionIds, ['milo', 'Bluejay', 'SailorMoon'], webcrypto),
    /three answers could not unlock/
  );
  await assert.rejects(
    unlockVaultAccount('Family.Vault', 'incorrect-passphrase-2026', account.vaultId, account.passphraseEnvelope, webcrypto),
    /username or passphrase was not accepted/
  );

  wipeVaultCredentials(account);
  wipeVaultCredentials(signedIn);
  wipeVaultCredentials(reordered);
  wipeVaultCredentials(resetAccount);
  recoveredRaw.fill(0);
});

test('daily bundle is compressed before AES-GCM encryption and round-trips safely', async () => {
  const credentials = await deriveLegacyVaultCredentials('test.family', 'correct-horse-battery-2026', webcrypto);
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

  const otherCredentials = await deriveLegacyVaultCredentials('test.family', 'another-strong-passphrase-2026', webcrypto);
  await assert.rejects(
    decryptDailyBundle(packet, otherCredentials.encryptionKey, decompressor, webcrypto),
    /could not be decrypted/
  );
  wipeVaultCredentials(credentials);
  wipeVaultCredentials(otherCredentials);
});

test('packet validation rejects wrong dates, algorithms, and malformed IVs', async () => {
  const credentials = await deriveLegacyVaultCredentials('test.family', 'correct-horse-battery-2026', webcrypto);
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
  wipeVaultCredentials(credentials);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import {
  VAULT_KDF_ITERATIONS, RECOVERY_KDF_ITERATIONS,
  MIN_PASSPHRASE_LENGTH, MAX_PASSPHRASE_LENGTH,
  createVaultAccount, unlockVaultAccount, recoverVaultMasterKey,
  prepareVaultPassphraseReset, validateVaultUsername,
  validateVaultPassphrase, validateRecoveryAnswers,
  encryptDailyBundle, decryptDailyBundle, isValidEncryptedPacket,
  wipeWriteToken
} from '../assets/vault-crypto.js';

const answers = [
  { questionId: 1, answer: 'Poppy' },
  { questionId: 2, answer: 'Mango' },
  { questionId: 20, answer: 'Piano' }
];
const base64 = value => Buffer.from(value, 'utf8').toString('base64');
const unbase64 = value => Buffer.from(value, 'base64').toString('utf8');

test('username is a changeable account label; a permanent random Vault ID identifies the account', async () => {
  assert.equal(VAULT_KDF_ITERATIONS, 600000);
  assert.equal(RECOVERY_KDF_ITERATIONS, 1200000);
  assert.equal(MIN_PASSPHRASE_LENGTH, 12);
  assert.equal(MAX_PASSPHRASE_LENGTH, 128);
  assert.deepEqual(validateVaultUsername('  LIZ_2026  '), {
    valid: true,
    normalized: 'liz_2026'
  });
  assert.equal(validateVaultUsername('ab').valid, false);
  assert.equal(validateVaultUsername('name with spaces').valid, false);

  const created = await createVaultAccount('Family.Vault', 'a-strong-passphrase-2026', answers, webcrypto);
  const account = created.accountRecord;
  assert.match(created.vaultId, /^[a-f0-9]{64}$/);
  assert.equal(created.vaultId, account.vaultId);

  const login = await unlockVaultAccount(account, 'a-strong-passphrase-2026', webcrypto);
  assert.equal(login.vaultId, created.vaultId);
  assert.deepEqual(login.writeToken, created.writeToken);

  const renamedAccount = { ...account, username: 'family.renamed' };
  const renamedLogin = await unlockVaultAccount(renamedAccount, 'a-strong-passphrase-2026', webcrypto);
  assert.equal(renamedLogin.vaultId, created.vaultId);
  assert.equal(renamedLogin.username, 'family.renamed');
  assert.deepEqual(renamedLogin.writeToken, login.writeToken);

  await assert.rejects(
    unlockVaultAccount(account, 'a-different-passphrase-2026', webcrypto),
    /did not unlock this account/
  );
  wipeWriteToken(created.writeToken);
  wipeWriteToken(login.writeToken);
  wipeWriteToken(renamedLogin.writeToken);
});

test('recovery requires exactly three distinct, one-word, case-sensitive answers', () => {
  assert.equal(validateRecoveryAnswers(answers).valid, true);
  assert.equal(validateRecoveryAnswers(answers.slice(0, 2)).valid, false);
  assert.equal(validateRecoveryAnswers([
    answers[0], answers[0], answers[2]
  ]).valid, false);
  assert.equal(validateRecoveryAnswers([
    answers[0], answers[1], { questionId: 20, answer: 'Baby Grand' }
  ]).valid, false);
  assert.equal(validateRecoveryAnswers([
    answers[0], answers[1], { questionId: 21, answer: 'Piano' }
  ]).valid, false);
});

test('the same three answers recover the permanent master key and permit passphrase rotation', async () => {
  const created = await createVaultAccount('test.family', 'correct-horse-battery-2026', answers, webcrypto);
  const recoveredMaster = await recoverVaultMasterKey(created.accountRecord, answers, webcrypto);
  assert.equal(recoveredMaster.length, 32);

  const wrongCase = answers.map(item => ({ ...item }));
  wrongCase[0].answer = 'poppy';
  await assert.rejects(
    recoverVaultMasterKey(created.accountRecord, wrongCase, webcrypto),
    /did not unlock this account/
  );

  const reset = await prepareVaultPassphraseReset(
    { vaultId: created.vaultId, username: created.username },
    recoveredMaster,
    'a-new-strong-passphrase-2026',
    webcrypto
  );
  const updatedAccount = {
    ...created.accountRecord,
    passphraseSalt: reset.passphraseSalt,
    passphraseIterations: reset.passphraseIterations,
    passphraseEnvelope: reset.passphraseEnvelope
  };
  const newLogin = await unlockVaultAccount(updatedAccount, 'a-new-strong-passphrase-2026', webcrypto);
  assert.equal(newLogin.vaultId, created.vaultId);
  assert.notDeepEqual(newLogin.writeToken, created.writeToken);

  await assert.rejects(
    unlockVaultAccount(updatedAccount, 'correct-horse-battery-2026', webcrypto),
    /did not unlock this account/
  );
  recoveredMaster.fill(0);
  wipeWriteToken(reset.writeToken);
  wipeWriteToken(newLogin.writeToken);
  wipeWriteToken(created.writeToken);
});

test('passphrase policy enforces 12 to 128 characters', () => {
  assert.equal(validateVaultPassphrase('twelve_chars!').valid, true);
  assert.equal(validateVaultPassphrase('short').valid, false);
  assert.equal(validateVaultPassphrase('x'.repeat(129)).valid, false);
  assert.equal(validateVaultPassphrase('valid-phrase-123').valid, true);
});

test('daily bundle compresses before AES-GCM encryption and round-trips with the permanent master key', async () => {
  const created = await createVaultAccount('test.family', 'correct-horse-battery-2026', answers, webcrypto);
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

  const packet = await encryptDailyBundle(bundle, created.encryptionKey, compressor, webcrypto);
  assert.equal(compressorCalled, true);
  assert.equal(packet.compression, 'gzip-base64');
  assert.equal(packet.algorithm, 'AES-256-GCM');
  assert.equal(packet.dateString, bundle.dateString);
  assert.equal(isValidEncryptedPacket(packet), true);
  assert.equal(JSON.stringify(packet).includes('Home'), false);

  const secondDevice = await unlockVaultAccount(created.accountRecord, 'correct-horse-battery-2026', webcrypto);
  assert.deepEqual(await decryptDailyBundle(packet, secondDevice.encryptionKey, decompressor, webcrypto), bundle);

  const otherAccount = await createVaultAccount('test.family', 'another-strong-passphrase-2026', answers, webcrypto);
  await assert.rejects(
    decryptDailyBundle(packet, otherAccount.encryptionKey, decompressor, webcrypto),
    /could not be decrypted/
  );

  wipeWriteToken(created.writeToken);
  wipeWriteToken(secondDevice.writeToken);
  wipeWriteToken(otherAccount.writeToken);
});

test('packet validation rejects wrong dates, algorithms, and malformed IVs', async () => {
  const created = await createVaultAccount('test.family', 'correct-horse-battery-2026', answers, webcrypto);
  const packet = await encryptDailyBundle({
    format: 'faith-focus-daily-bundle',
    version: 1,
    dateString: '2026-11-12',
    records: {},
    voiceNotes: []
  }, created.encryptionKey, async value => value, webcrypto);

  assert.equal(isValidEncryptedPacket(packet), true);
  assert.equal(isValidEncryptedPacket({ ...packet, algorithm: 'AES-128-GCM' }), false);
  assert.equal(isValidEncryptedPacket({ ...packet, dateString: '2026-02-30' }), false);
  assert.equal(isValidEncryptedPacket({ ...packet, iv: 'bad' }), false);
  wipeWriteToken(created.writeToken);
});

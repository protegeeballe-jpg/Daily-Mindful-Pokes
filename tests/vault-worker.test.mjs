import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import worker, { VaultCoordinator, AccountDirectory } from '../worker.js';
import {
  createNewVaultAccount, createPassphraseEnvelope, unwrapMasterKeyWithRecovery,
  wipeVaultCredentials
} from '../assets/vault-crypto.js';

const ORIGIN = 'https://protegeeballe-jpg.github.io';
const CLIENT = 'faith-focus-daily-armor-web/1';
const VAULT_ID = 'a'.repeat(64);
const WRITE_TOKEN = 'W'.repeat(43);
const PEPPER = 'account-recovery-test-pepper-with-more-than-32-bytes';
const dateString = '2026-11-12';
const packet = {
  format: 'faith-focus-encrypted-daily-packet',
  version: 1,
  dateString,
  algorithm: 'AES-256-GCM',
  compression: 'none',
  iv: btoa(String.fromCharCode(...new Uint8Array(12).fill(1))),
  ciphertext: btoa(String.fromCharCode(...new Uint8Array(16).fill(2)))
};

function responseJson(response) {
  return response.json();
}

function makeAccountDirectory() {
  const storageMap = new Map();
  const storage = {
    async get(key) { return storageMap.get(key); },
    async put(key, value) { storageMap.set(key, value); },
    async delete(key) { storageMap.delete(key); }
  };
  const state = { storage };
  const env = { RECOVERY_PEPPER: PEPPER };
  return { directory: new AccountDirectory(state, env), storageMap };
}

function directoryRequest(path, body, ip = '203.0.113.7') {
  return new Request('https://account-directory.internal' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-IP': ip },
    body: JSON.stringify(body)
  });
}

test('Worker rejects non-GitHub-Pages origins and missing custom client header', async () => {
  const wrongOrigin = await worker.fetch(new Request('https://worker.example/vault/' + VAULT_ID + '/index', {
    headers: { Origin: 'https://attacker.example', 'X-App-Client': CLIENT }
  }), {});
  assert.equal(wrongOrigin.status, 403);

  const missingClient = await worker.fetch(new Request('https://worker.example/vault/' + VAULT_ID + '/index', {
    headers: { Origin: ORIGIN }
  }), {});
  assert.equal(missingClient.status, 403);
});

test('Worker rejects requests larger than 1 MB before invoking the vault coordinator', async () => {
  const request = new Request('https://worker.example/vault/' + VAULT_ID + '/claim', {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'X-App-Client': CLIENT,
      'X-Write-Token': WRITE_TOKEN,
      'Content-Type': 'application/json',
      'Content-Length': String(1024 * 1024 + 1)
    },
    body: 'x'.repeat(1024 * 1024 + 1)
  });
  const oversized = await worker.fetch(request, {
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {},
    ACCOUNT_DIRECTORY: {}
  });
  assert.equal(oversized.status, 413);
  assert.match((await responseJson(oversized)).error, /1 MB/);
});

function makeCoordinator() {
  const storageMap = new Map();
  const kvMap = new Map();
  const storage = {
    async get(key) { return storageMap.get(key); },
    async put(key, value) { storageMap.set(key, value); },
    async delete(key) { storageMap.delete(key); }
  };
  const state = {
    storage,
    blockConcurrencyWhile(callback) { return callback(); }
  };
  const env = {
    VAULT_PACKETS: {
      async get(key) { return kvMap.get(key) ?? null; },
      async put(key, value) { kvMap.set(key, value); }
    }
  };
  return { coordinator: new VaultCoordinator(state, env), storageMap, kvMap };
}

function coordinatorRequest(path, { method = 'GET', token = WRITE_TOKEN, body, allowFirstClaim = false } = {}) {
  return new Request('https://vault-coordinator.internal' + path, {
    method,
    headers: {
      'X-Vault-Id': VAULT_ID,
      'X-Write-Token': token,
      ...(path === '/claim' ? { 'X-Allow-First-Claim': allowFirstClaim ? 'true' : 'false' } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test('Vault Coordinator only accepts first claim when Account Directory authorizes registration', async () => {
  const { coordinator, storageMap } = makeCoordinator();
  const unregistered = await coordinator.fetch(coordinatorRequest('/claim', { method: 'POST', body: {} }));
  assert.equal(unregistered.status, 401);
  assert.equal(storageMap.has('write-token-sha256'), false);

  const claim = await coordinator.fetch(coordinatorRequest('/claim', {
    method: 'POST', body: {}, allowFirstClaim: true
  }));
  assert.equal(claim.status, 200);
  assert.equal(storageMap.has('write-token-sha256'), true);
});

test('Vault Coordinator stores encrypted date packets and rejects stale writes', async () => {
  const { coordinator, storageMap, kvMap } = makeCoordinator();
  const claim = await coordinator.fetch(coordinatorRequest('/claim', {
    method: 'POST', body: {}, allowFirstClaim: true
  }));
  assert.equal(claim.status, 200);

  const firstWrite = await coordinator.fetch(coordinatorRequest('/day/' + dateString, {
    method: 'PUT',
    body: { packet, baseUpdatedAt: null }
  }));
  assert.equal(firstWrite.status, 200);
  const saved = await responseJson(firstWrite);
  assert.equal(typeof saved.updatedAt, 'string');
  assert.ok(kvMap.has(VAULT_ID + ':' + dateString));
  assert.ok(kvMap.has(VAULT_ID + ':index'));

  const staleWrite = await coordinator.fetch(coordinatorRequest('/day/' + dateString, {
    method: 'PUT',
    body: { packet, baseUpdatedAt: null }
  }));
  assert.equal(staleWrite.status, 409);

  const badToken = await coordinator.fetch(coordinatorRequest('/index', { token: 'x'.repeat(43) }));
  assert.equal(badToken.status, 401);

  const index = await coordinator.fetch(coordinatorRequest('/index'));
  assert.equal(index.status, 200);
  const indexBody = await responseJson(index);
  assert.equal(indexBody.index[dateString], saved.updatedAt);
  assert.equal(storageMap.get('write-token-sha256') !== WRITE_TOKEN, true);
});

test('Account Directory stores only peppered recovery lookup and encrypted key envelopes', async () => {
  const { directory, storageMap } = makeAccountDirectory();
  const questionIds = [1, 6, 13];
  const answers = ['Milo', 'Bluejay', 'SailorMoon'];
  const account = await createNewVaultAccount(
    'Liz.Sample', 'a-strong-account-passphrase-2026', questionIds, answers, webcrypto
  );

  const signup = await directory.fetch(directoryRequest('/account/signup', {
    username: account.username,
    vaultId: account.vaultId,
    passphraseEnvelope: account.passphraseEnvelope,
    recoveryEnvelope: account.recoveryEnvelope,
    questionIds,
    answers
  }));
  assert.equal(signup.status, 201);

  const signInInfo = await directory.fetch(directoryRequest('/account/signin', { username: 'LIZ.SAMPLE' }));
  assert.equal(signInInfo.status, 200);
  const signInData = await responseJson(signInInfo);
  assert.equal(signInData.vaultId, account.vaultId);
  assert.deepEqual(signInData.passphraseEnvelope, account.passphraseEnvelope);

  const reorderedLookup = await directory.fetch(directoryRequest('/account/recovery/lookup', {
    questionIds: [13, 1, 6],
    answers: ['SailorMoon', 'Milo', 'Bluejay']
  }));
  assert.equal(reorderedLookup.status, 200);
  const lookupData = await responseJson(reorderedLookup);
  assert.equal(lookupData.username, 'liz.sample');
  const recovered = await unwrapMasterKeyWithRecovery(
    lookupData.recoveryEnvelope, [6, 13, 1], ['Bluejay', 'SailorMoon', 'Milo'], webcrypto
  );
  assert.deepEqual(recovered, account.masterKeyBytes);

  const wrongCase = await directory.fetch(directoryRequest('/account/recovery/lookup', {
    questionIds, answers: ['milo', 'Bluejay', 'SailorMoon']
  }, '203.0.113.8'));
  assert.equal(wrongCase.status, 401);

  const nextPassphraseEnvelope = await createPassphraseEnvelope(
    recovered, 'a-replacement-account-passphrase-2026', webcrypto
  );
  const update = await directory.fetch(directoryRequest('/account/recovery/update', {
    questionIds: [13, 6, 1],
    answers: ['SailorMoon', 'Bluejay', 'Milo'],
    vaultId: account.vaultId,
    newUsername: 'Liz.NewName',
    passphraseEnvelope: nextPassphraseEnvelope
  }));
  assert.equal(update.status, 200);
  const oldName = await directory.fetch(directoryRequest('/account/signin', { username: 'liz.sample' }));
  assert.equal(oldName.status, 404);
  const newName = await directory.fetch(directoryRequest('/account/signin', { username: 'liz.newname' }));
  assert.equal(newName.status, 200);
  const newNameData = await responseJson(newName);
  assert.equal(newNameData.vaultId, account.vaultId);
  assert.deepEqual(newNameData.passphraseEnvelope, nextPassphraseEnvelope);

  const storedText = JSON.stringify([...storageMap.entries()]);
  for (const answer of answers) assert.equal(storedText.includes(answer), false);
  wipeVaultCredentials(account);
  recovered.fill(0);
});

test('Account Directory rate-limits repeated recovery guesses by client IP', async () => {
  const { directory } = makeAccountDirectory();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await directory.fetch(directoryRequest('/account/recovery/lookup', {
      questionIds: [1, 2, 3],
      answers: ['wrongone', 'wrongtwo', 'wrongthree']
    }, '203.0.113.99'));
    assert.equal(response.status, 401);
  }
  const limited = await directory.fetch(directoryRequest('/account/recovery/lookup', {
    questionIds: [1, 2, 3],
    answers: ['wrongone', 'wrongtwo', 'wrongthree']
  }, '203.0.113.99'));
  assert.equal(limited.status, 429);
});

test('Worker account routes require the app origin, custom client header, and recovery secret', async () => {
  const { directory } = makeAccountDirectory();
  const request = new Request('https://worker.example/account/signin', {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'X-App-Client': CLIENT,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username: 'liz.sample' })
  });
  const routed = await worker.fetch(request, {
    ACCOUNT_DIRECTORY: { idFromName: () => 'directory-id', get: () => directory },
    RECOVERY_PEPPER: PEPPER
  });
  assert.equal(routed.status, 404);
});

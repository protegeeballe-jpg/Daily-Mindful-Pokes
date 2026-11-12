import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import worker, { AccountRegistry, VaultCoordinator } from '../worker.js';

const ORIGIN = 'https://protegeeballe-jpg.github.io';
const CLIENT = 'faith-focus-daily-armor-web/1';
const VAULT_ID = 'a'.repeat(64);
const WRITE_TOKEN = 'W'.repeat(43);
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
    VAULT_COORDINATOR: {}
  });
  assert.equal(oversized.status, 413);
  assert.match((await responseJson(oversized)).error, /1 MB/);
});

function makeCoordinator() {
  const storageMap = new Map();
  const kvMap = new Map();
  const storage = {
    async get(key) { return storageMap.get(key); },
    async put(key, value) { storageMap.set(key, value); }
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

function coordinatorRequest(path, { method = 'GET', token = WRITE_TOKEN, legacyToken, body } = {}) {
  return new Request('https://vault-coordinator.internal' + path, {
    method,
    headers: {
      'X-Vault-Id': VAULT_ID,
      'X-Write-Token': token,
      ...(legacyToken ? { 'X-Legacy-Write-Token': legacyToken } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test('Vault Coordinator claims once, stores encrypted date packets, and rejects stale writes', async () => {
  const { coordinator, storageMap, kvMap } = makeCoordinator();

  const prematureClaim = await coordinator.fetch(coordinatorRequest('/claim', { method: 'POST', body: {} }));
  assert.equal(prematureClaim.status, 401);

  const initialize = await coordinator.fetch(coordinatorRequest('/admin/initialize', {
    method: 'POST',
    body: {}
  }));
  assert.equal(initialize.status, 200);
  assert.equal(storageMap.has('write-token-sha256'), true);

  const claim = await coordinator.fetch(coordinatorRequest('/claim', { method: 'POST', body: {} }));
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
});


function makeDurableNamespace(DurableClass, env) {
  const instances = new Map();
  const storageMaps = new Map();
  return {
    idFromName(name) { return String(name); },
    get(id) {
      if (!instances.has(id)) {
        const map = new Map();
        storageMaps.set(id, map);
        const storage = {
          async get(key) { return map.get(key); },
          async put(key, value) { map.set(key, value); },
          async delete(key) { return map.delete(key); }
        };
        const state = {
          storage,
          blockConcurrencyWhile(callback) { return callback(); }
        };
        instances.set(id, new DurableClass(state, env));
      }
      return { fetch: request => instances.get(id).fetch(request) };
    },
    storageMaps
  };
}

function accountRequest(path, { body = {}, token } = {}) {
  return new Request('https://faith-focus-proxy.nine-westhigh.workers.dev' + path, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'X-App-Client': CLIENT,
      'Content-Type': 'application/json',
      ...(token ? { 'X-Write-Token': token } : {})
    },
    body: JSON.stringify(body)
  });
}

test('Account Registry creates one stable vault, verifies recovery answers, and rotates username/passphrase', async () => {
  const kvMap = new Map();
  const env = {
    RECOVERY_PEPPER: 'test-only-recovery-pepper-with-more-than-32-characters',
    VAULT_PACKETS: {
      async get(key) { return kvMap.get(key) ?? null; },
      async put(key, value) { kvMap.set(key, value); }
    }
  };
  env.VAULT_COORDINATOR = makeDurableNamespace(VaultCoordinator, env);
  env.ACCOUNT_REGISTRY = makeDurableNamespace(AccountRegistry, env);

  const vaultId = 'c'.repeat(64);
  const writeToken = 'A'.repeat(43);
  const recoveryAnswers = [
    { questionId: 1, answer: 'Poppy' },
    { questionId: 2, answer: 'Mango' },
    { questionId: 20, answer: 'Piano' }
  ];
  const envelope = {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: btoa(String.fromCharCode(...new Uint8Array(12).fill(4))),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(48).fill(5)))
  };
  const signup = await worker.fetch(accountRequest('/account/signup', {
    body: {
      username: 'Family.Vault',
      vaultId,
      passphraseSalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(1))),
      passphraseIterations: 600000,
      passphraseEnvelope: envelope,
      recoverySalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(2))),
      recoveryIterations: 1200000,
      recoveryEnvelope: envelope,
      questionAnswers: recoveryAnswers,
      writeToken
    }
  }), env);
  assert.equal(signup.status, 201);
  assert.equal((await responseJson(signup)).vaultId, vaultId);

  const signin = await worker.fetch(accountRequest('/account/signin', {
    body: { username: 'family.vault' }
  }), env);
  assert.equal(signin.status, 200);
  const signinData = await responseJson(signin);
  assert.equal(signinData.vaultId, vaultId);
  assert.equal('passphraseEnvelope' in signinData, false);

  const unlock = await worker.fetch(accountRequest('/account/unlock', {
    body: { vaultId }, token: writeToken
  }), env);
  assert.equal(unlock.status, 200);
  assert.equal((await responseJson(unlock)).passphraseEnvelope.algorithm, 'AES-256-GCM');

  const wrongAnswers = recoveryAnswers.map(item => ({ ...item }));
  wrongAnswers[0].answer = 'poppy';
  const rejectedRecovery = await worker.fetch(accountRequest('/account/recover', {
    body: { questionAnswers: wrongAnswers }
  }), env);
  assert.equal(rejectedRecovery.status, 401);

  const recovery = await worker.fetch(accountRequest('/account/recover', {
    body: { questionAnswers: recoveryAnswers }
  }), env);
  assert.equal(recovery.status, 200);
  const recoveryData = await responseJson(recovery);
  assert.equal(recoveryData.username, 'family.vault');
  assert.equal(recoveryData.vaultId, vaultId);
  assert.equal(recoveryData.recoveryEnvelope.algorithm, 'AES-256-GCM');
  assert.equal('questionAnswers' in recoveryData, false);

  const newWriteToken = 'B'.repeat(43);
  const renamed = await worker.fetch(accountRequest('/account/complete-recovery', {
    body: {
      grant: recoveryData.grant,
      newUsername: 'family.renamed',
      passphraseSalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(6))),
      passphraseIterations: 600000,
      passphraseEnvelope: { ...envelope, iv: btoa(String.fromCharCode(...new Uint8Array(12).fill(7))) },
      writeToken: newWriteToken
    }
  }), env);
  assert.equal(renamed.status, 200);
  const renamedData = await responseJson(renamed);
  assert.equal(renamedData.username, 'family.renamed');
  assert.equal(renamedData.vaultId, vaultId);
  assert.equal(renamedData.usernameChanged, true);
  assert.equal(renamedData.passphraseChanged, true);

  const oldUsername = await worker.fetch(accountRequest('/account/signin', {
    body: { username: 'family.vault' }
  }), env);
  assert.equal(oldUsername.status, 401);

  const newUsername = await worker.fetch(accountRequest('/account/signin', {
    body: { username: 'family.renamed' }
  }), env);
  assert.equal(newUsername.status, 200);
  assert.equal((await responseJson(newUsername)).vaultId, vaultId);

  const oldTokenUnlock = await worker.fetch(accountRequest('/account/unlock', {
    body: { vaultId }, token: writeToken
  }), env);
  assert.equal(oldTokenUnlock.status, 401);

  const newTokenUnlock = await worker.fetch(accountRequest('/account/unlock', {
    body: { vaultId }, token: newWriteToken
  }), env);
  assert.equal(newTokenUnlock.status, 200);

  const registryStorage = env.ACCOUNT_REGISTRY.storageMaps.get('global-account-registry');
  const persistedAccount = [...registryStorage.entries()]
    .find(([key]) => key === 'account:' + vaultId)?.[1];
  assert.ok(persistedAccount);
  const persistedText = JSON.stringify(persistedAccount);
  assert.equal(persistedText.includes('Poppy'), false);
  assert.equal(persistedText.includes('Mango'), false);
  assert.equal(persistedText.includes('Piano'), false);
});

test('Account Registry rejects duplicate questions, spaces, invalid answers, and duplicate usernames', async () => {
  const kvMap = new Map();
  const env = {
    RECOVERY_PEPPER: 'another-test-recovery-pepper-longer-than-32-characters',
    VAULT_PACKETS: {
      async get(key) { return kvMap.get(key) ?? null; },
      async put(key, value) { kvMap.set(key, value); }
    }
  };
  env.VAULT_COORDINATOR = makeDurableNamespace(VaultCoordinator, env);
  env.ACCOUNT_REGISTRY = makeDurableNamespace(AccountRegistry, env);

  const envelope = {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: btoa(String.fromCharCode(...new Uint8Array(12).fill(8))),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(48).fill(9)))
  };
  const validBody = {
    username: 'second.family',
    vaultId: 'd'.repeat(64),
    passphraseSalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(1))),
    passphraseIterations: 600000,
    passphraseEnvelope: envelope,
    recoverySalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(2))),
    recoveryIterations: 1200000,
    recoveryEnvelope: envelope,
    questionAnswers: [
      { questionId: 3, answer: 'Neighbor' },
      { questionId: 7, answer: 'Awake' },
      { questionId: 15, answer: 'Melody' }
    ],
    writeToken: 'C'.repeat(43)
  };

  const invalidAnswers = await worker.fetch(accountRequest('/account/signup', {
    body: { ...validBody, questionAnswers: [
      { questionId: 3, answer: 'Neighbor' },
      { questionId: 3, answer: 'Awake' },
      { questionId: 15, answer: 'Melody' }
    ] }
  }), env);
  assert.equal(invalidAnswers.status, 400);

  const spacedAnswer = await worker.fetch(accountRequest('/account/signup', {
    body: { ...validBody, questionAnswers: [
      { questionId: 3, answer: 'Next Door' },
      { questionId: 7, answer: 'Awake' },
      { questionId: 15, answer: 'Melody' }
    ] }
  }), env);
  assert.equal(spacedAnswer.status, 400);

  const signup = await worker.fetch(accountRequest('/account/signup', { body: validBody }), env);
  assert.equal(signup.status, 201);

  const duplicateUsername = await worker.fetch(accountRequest('/account/signup', {
    body: { ...validBody, vaultId: 'e'.repeat(64), writeToken: 'D'.repeat(43), recoverySalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(4))) }
  }), env);
  assert.equal(duplicateUsername.status, 409);
});


test('Vault Coordinator upgrades an existing legacy token only after verifying the old credential', async () => {
  const { coordinator, storageMap } = makeCoordinator();
  const oldToken = 'L'.repeat(43);
  const newToken = 'N'.repeat(43);

  const initialize = await coordinator.fetch(coordinatorRequest('/admin/initialize', {
    method: 'POST',
    token: oldToken,
    body: {}
  }));
  assert.equal(initialize.status, 200);

  const rejectedUpgrade = await coordinator.fetch(coordinatorRequest('/admin/migrate-legacy', {
    method: 'POST',
    token: newToken,
    legacyToken: 'X'.repeat(43)
  }));
  assert.equal(rejectedUpgrade.status, 401);

  const acceptedUpgrade = await coordinator.fetch(coordinatorRequest('/admin/migrate-legacy', {
    method: 'POST',
    token: newToken,
    legacyToken: oldToken
  }));
  assert.equal(acceptedUpgrade.status, 200);

  const oldClaim = await coordinator.fetch(coordinatorRequest('/claim', {
    method: 'POST',
    token: oldToken,
    body: {}
  }));
  assert.equal(oldClaim.status, 401);

  const newClaim = await coordinator.fetch(coordinatorRequest('/claim', {
    method: 'POST',
    token: newToken,
    body: {}
  }));
  assert.equal(newClaim.status, 200);
  assert.equal(typeof storageMap.get('upgraded-at'), 'string');
});

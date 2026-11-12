import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import worker, { VaultCoordinator } from '../worker.js';

globalThis.crypto = webcrypto;

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

function coordinatorRequest(path, { method = 'GET', token = WRITE_TOKEN, body } = {}) {
  return new Request('https://vault-coordinator.internal' + path, {
    method,
    headers: {
      'X-Vault-Id': VAULT_ID,
      'X-Write-Token': token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test('Vault Coordinator claims once, stores encrypted date packets, and rejects stale writes', async () => {
  const { coordinator, storageMap, kvMap } = makeCoordinator();

  const claim = await coordinator.fetch(coordinatorRequest('/claim', { method: 'POST', body: {} }));
  assert.equal(claim.status, 200);
  assert.equal(storageMap.has('write-token-sha256'), true);

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

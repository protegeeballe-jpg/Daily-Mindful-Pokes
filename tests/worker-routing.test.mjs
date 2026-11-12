import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

test('vault PUT requests forward their JSON body to the Durable Object', async () => {
  const vaultId = 'a'.repeat(64);
  const payload = {
    packet: {
      format: 'faith-focus-encrypted-daily-packet',
      version: 1,
      dateString: '2026-11-13',
      algorithm: 'AES-256-GCM',
      compression: 'none',
      iv: 'AAAAAAAAAAAAAAAA',
      ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA=='
    },
    baseUpdatedAt: null
  };
  const expectedBody = JSON.stringify(payload);
  let forwarded = null;

  const env = {
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {
      idFromName: id => id,
      get: id => ({
        fetch: async request => {
          forwarded = {
            method: request.method,
            body: await request.text(),
            contentType: request.headers.get('Content-Type'),
            vaultId: request.headers.get('X-Vault-Id')
          };
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })
    }
  };

  const request = new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/vault/' + vaultId + '/day/2026-11-13',
    {
      method: 'PUT',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'X-Write-Token': 'a'.repeat(43),
        'Content-Type': 'application/json',
        'X-Base-Updated-At': 'none'
      },
      body: expectedBody
    }
  );

  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  assert.deepEqual(forwarded, {
    method: 'PUT',
    body: expectedBody,
    contentType: 'application/json',
    vaultId
  });
});

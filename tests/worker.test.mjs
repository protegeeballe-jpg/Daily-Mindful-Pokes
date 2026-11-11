import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

const APP_ORIGIN = 'https://protegeeballe-jpg.github.io';
const WORKER_URL = 'https://faith-focus-proxy.example.workers.dev';

async function call(path, init = {}) {
    return worker.fetch(new Request(`${WORKER_URL}${path}`, init), {});
}

test('the status endpoint reports that the API is deliberately not ready', async () => {
    const response = await call('/health');

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
        service: 'faith-focus-proxy',
        status: 'maintenance',
        apiReady: false
    });
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('CORS exposes only the exact GitHub Pages application origin', async () => {
    const allowed = await call('/health', {
        headers: { Origin: APP_ORIGIN }
    });
    assert.equal(allowed.headers.get('access-control-allow-origin'), APP_ORIGIN);
    assert.equal(allowed.headers.get('vary'), 'Origin');

    const untrusted = await call('/health', {
        headers: { Origin: 'https://attacker.example' }
    });
    assert.equal(untrusted.headers.get('access-control-allow-origin'), null);
    assert.equal(untrusted.headers.get('vary'), 'Origin');
});

test('the old Gist proxy and all unimplemented routes are closed', async () => {
    const requests = [
        ['/gists', { method: 'GET' }],
        ['/gists/123456', { method: 'PATCH', body: '{}' }],
        ['/users/example/gists', { method: 'POST', body: '{}' }],
        ['/repos/owner/repo', { method: 'DELETE' }],
        ['/', { method: 'GET' }],
        ['/health?debug=1', { method: 'GET' }]
    ];

    for (const [path, init] of requests) {
        const response = await call(path, init);
        assert.equal(response.status, 404, `${init.method} ${path} must remain closed`);
        assert.deepEqual(await response.json(), { error: 'not_found' });
    }
});

test('the health endpoint accepts GET only and provides no preflight permission', async () => {
    const post = await call('/health', { method: 'POST', body: '{}' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET');

    const options = await call('/health', { method: 'OPTIONS' });
    assert.equal(options.status, 405);
    assert.equal(options.headers.get('access-control-allow-methods'), null);
});

test('requests are never forwarded to an upstream service', async () => {
    const originalFetch = globalThis.fetch;
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls += 1;
        throw new Error('Unexpected upstream request');
    };

    try {
        await call('/gists', { method: 'POST', body: JSON.stringify({ files: {} }) });
        await call('/health');
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(upstreamCalls, 0);
});

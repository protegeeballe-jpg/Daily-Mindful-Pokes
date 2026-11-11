/**
 * Phase 1 security hold for Faith & Focus.
 *
 * The previous implementation was an unrestricted GitHub Gist proxy. This
 * Worker intentionally exposes no data, authentication, or proxy routes until
 * the Cloudflare API is designed and tested in the later implementation
 * phases. It does not read secrets, inspect request bodies, or make upstream
 * requests.
 */

const APP_ORIGIN = 'https://protegeeballe-jpg.github.io';
const STATUS_PATH = '/health';

function createHeaders(origin) {
    const headers = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
    });

    if (origin) {
        headers.set('Vary', 'Origin');
    }

    // This is a response-sharing rule for the public status endpoint only.
    // It is not authentication and does not authorize private API operations.
    if (origin === APP_ORIGIN) {
        headers.set('Access-Control-Allow-Origin', APP_ORIGIN);
    }

    return headers;
}

function jsonResponse(payload, status, origin, extraHeaders = {}) {
    const headers = createHeaders(origin);
    for (const [name, value] of Object.entries(extraHeaders)) {
        headers.set(name, value);
    }

    return new Response(JSON.stringify(payload), { status, headers });
}

export default {
    async fetch(request) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');

        // A deliberately non-operational status endpoint confirms that the
        // Worker is deployed without implying that account APIs are ready.
        if (url.pathname === STATUS_PATH && url.search === '') {
            if (request.method !== 'GET') {
                return jsonResponse(
                    { error: 'method_not_allowed' },
                    405,
                    origin,
                    { Allow: 'GET' }
                );
            }

            return jsonResponse(
                {
                    service: 'faith-focus-proxy',
                    status: 'maintenance',
                    apiReady: false
                },
                503,
                origin
            );
        }

        // All former Gist proxy paths and every future API path remain closed
        // until an authenticated, route-specific implementation is ready.
        return jsonResponse({ error: 'not_found' }, 404, origin);
    }
};

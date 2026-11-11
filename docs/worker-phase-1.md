# Phase 1 — Secure the Cloudflare Worker

## Phase 1 outcome

The repository Worker is being moved to a temporary, fail-closed state while the real Cloudflare API is built in later phases.

The Worker exposes one non-operational status endpoint:

- `GET /health` returns HTTP 503 with `apiReady: false`.
- Any other path returns HTTP 404.
- Any method other than GET on `/health` returns HTTP 405.
- The Worker does not read request bodies, read environment secrets, call another service, or log request data.
- CORS response sharing is limited to the deployed GitHub Pages origin, `https://protegeeballe-jpg.github.io`. No wildcard origin, credential permission, or broad preflight permission is returned.

This is a security hold, not the completed account API. No registration, login, database, storage, or synchronization routes are active.

## Why the previous Worker had to be closed

The previous `worker.js` forwarded the caller's arbitrary path and query string to `api.github.com`, accepted GET/POST/PATCH/PUT/DELETE, copied caller-controlled headers, and attached the Worker's `GITHUB_TOKEN`. It also returned wildcard CORS headers.

That combination made the Worker an unauthenticated privileged proxy. Anyone who discovered the Worker URL could attempt GitHub API operations using the Worker's token. CORS would not prevent direct requests from scripts or command-line clients.

## App dependency check

The current repository's application HTML and JavaScript were checked for the Worker URL, `workers.dev` calls, and Gist API calls. No frontend dependency on this proxy was found. The current `index.html` Content Security Policy also does not authorize the Worker origin.

The protected Diary, Garden, Checklist, voice-note, location, app-gate, and Google Drive modules were not modified. The existing Google Drive backup remains separate.

## Files changed in this phase

- `worker.js`: replace the arbitrary GitHub proxy with the fail-closed status-only Worker.
- `tests/worker.test.mjs`: add isolated tests for closed routes, exact-origin CORS, method restrictions, security headers, and the absence of upstream requests.
- `.github/workflows/tests.yml`: add a syntax check for the Worker; the existing app regression test command continues to run all `tests/*.test.mjs`.
- This document records the deployment and verification requirements.

`wrangler.toml` and all existing app modules are intentionally unchanged.

## Connect the existing Cloudflare Worker to this repository

Use the existing Worker named `faith-focus-proxy`. Do not create a second Worker.

Cloudflare Workers Builds supports connecting an already-created Worker to GitHub:

1. Open the Cloudflare dashboard and go to **Workers & Pages**.
2. Select the existing **faith-focus-proxy** Worker.
3. Open **Settings → Builds** and choose **Connect**.
4. Authorize the GitHub integration when Cloudflare prompts you.
5. Select Git account `protegeeballe-jpg` and repository `Faith-and-Focus-Daily-Armor`.
6. Set the project root directory to the repository root (or leave it blank if the dashboard treats blank as root). The `wrangler.toml` file is already at the repository root.
7. Leave the build command empty; this Worker has no compilation step. Use the default deploy command, `npx wrangler deploy`.
8. Under **Settings → Build → Branch control**, set the production branch to `security/phase-1-harden-worker` before triggering production deployment. Do not deploy `main` while it still contains the old Gist proxy.
9. Confirm the build's deployed commit is the reviewed branch head. Check the Worker URL against the route tests below before considering the old proxy retired.

Cloudflare documents that an existing Worker can be connected under **Settings → Builds**, and that the Git production branch controls which commits are deployed to production. The repository's Wrangler `name` is `faith-focus-proxy`, matching the existing Worker name.

**Credential distinction:** Cloudflare's GitHub integration authorizes repository access through Cloudflare's Git integration. The existing runtime secret `GITHUB_TOKEN` was only used by the old Worker to call GitHub's API. It is not the GitHub integration credential and it is not a Cloudflare deployment credential. The new Worker source does not use it.


After the hardened Worker is deployed:

1. Remove the `GITHUB_TOKEN` secret binding from the `faith-focus-proxy` Worker. This code no longer reads it.
2. Revoke the GitHub personal access token created exclusively for the old proxy. If that token is used by another service, first identify and separate that use rather than unexpectedly breaking it.
3. Verify the deployed Worker directly:
   - `GET /health` → HTTP 503 and `apiReady: false`.
   - `GET /gists` → HTTP 404.
   - `POST /gists` → HTTP 404.
   - `OPTIONS /health` → HTTP 405, with no preflight-method grant.
   - An untrusted Origin must not receive an `Access-Control-Allow-Origin` header.
4. Confirm the deployed Worker no longer makes requests to GitHub.

The live Cloudflare deployment could not be independently queried from the development environment during this review. Therefore, the repository changes and isolated tests do not establish that production has already been updated.

## Local verification

Run:

```sh
node --check worker.js
node --test tests/worker.test.mjs
node --test tests/*.test.mjs
```

The new Worker tests are isolated from the app's browser modules. The complete repository test suite must pass in GitHub Actions before this phase is accepted.

## Phase 1 exit criteria

- The reviewed Worker source has no GitHub proxy logic or secret access.
- The isolated Worker tests pass.
- The existing application regression suite passes.
- The deployed Worker is verified to match the reviewed source.
- The obsolete GitHub token secret and dedicated token have been removed/revoked.

Only after these checks should Phase 2 provision D1 and R2. No account or data routes should be added before their authorization and encryption designs are reviewed.

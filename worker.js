const APP_ORIGIN = "https://protegeeballe-jpg.github.io";
const BACKUP_PATH = "/backup";
const BACKUP_FILE_NAME = "faith-focus-daily-armor.enc.json";
const MAX_REQUEST_BYTES = 950000;

function jsonResponse(body, status, origin) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  });
  if (origin === APP_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", APP_ORIGIN);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function sameSecret(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

function validGistId(value) {
  return typeof value === "string" && /^[0-9a-f]{20,40}$/i.test(value);
}

function validUpdateBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.description !== "string" || !value.files || typeof value.files !== "object") return false;
  const names = Object.keys(value.files);
  return names.length === 1
    && names[0] === BACKUP_FILE_NAME
    && typeof value.files[BACKUP_FILE_NAME]?.content === "string";
}

async function githubRequest(url, token, options = {}) {
  const headers = new Headers({
    "Authorization": "Bearer " + token,
    "Accept": "application/vnd.github+json",
    "User-Agent": "Faith-and-Focus-Daily-Armor",
    "X-GitHub-Api-Version": "2022-11-28"
  });
  if (options.body) headers.set("Content-Type", "application/json");
  return fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body || undefined,
    redirect: "error"
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (origin !== APP_ORIGIN) {
      return jsonResponse({ error: "Origin not allowed." }, 403, null);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": APP_ORIGIN,
          "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Sync-Key, If-Match",
          "Access-Control-Max-Age": "600",
          "Vary": "Origin"
        }
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== BACKUP_PATH || url.search) {
      return jsonResponse({ error: "Route not found." }, 404, origin);
    }
    if (!["GET", "PUT"].includes(request.method)) {
      return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }

    if (!env.GITHUB_TOKEN || !validGistId(env.GIST_ID)
        || typeof env.SYNC_KEY !== "string" || env.SYNC_KEY.length < 32) {
      return jsonResponse({ error: "The Worker is missing required secret configuration." }, 503, origin);
    }

    const suppliedKey = request.headers.get("X-Sync-Key") || "";
    if (!sameSecret(suppliedKey, env.SYNC_KEY)) {
      return jsonResponse({ error: "Unauthorized." }, 401, origin);
    }

    const gistUrl = "https://api.github.com/gists/" + encodeURIComponent(env.GIST_ID);

    try {
      if (request.method === "GET") {
        const response = await githubRequest(gistUrl, env.GITHUB_TOKEN);
        if (!response.ok) {
          return jsonResponse({ error: "GitHub could not read the configured Gist.", status: response.status }, response.status, origin);
        }
        const gist = await response.json();
        const file = gist.files?.[BACKUP_FILE_NAME];

        return jsonResponse({
          content: typeof file?.content === "string" ? file.content : null,
          truncated: file?.truncated === true,
          etag: response.headers.get("ETag") || ""
        }, 200, origin);
      }

      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
        return jsonResponse({ error: "Backup request is too large." }, 413, origin);
      }

      let update;
      try {
        update = JSON.parse(rawBody);
      } catch (error) {
        return jsonResponse({ error: "Invalid JSON request body." }, 400, origin);
      }
      if (!validUpdateBody(update)) {
        return jsonResponse({ error: "Only the configured Faith & Focus backup file may be updated." }, 400, origin);
      }

      const expectedEtag = request.headers.get("If-Match");
      if (!expectedEtag) {
        return jsonResponse({ error: "A backup version is required before updating." }, 428, origin);
      }

      const currentResponse = await githubRequest(gistUrl, env.GITHUB_TOKEN);
      if (!currentResponse.ok) {
        return jsonResponse({ error: "GitHub could not verify the current Gist version.", status: currentResponse.status }, currentResponse.status, origin);
      }
      const currentEtag = currentResponse.headers.get("ETag") || "";
      const currentGist = await currentResponse.json();
      const currentFile = currentGist.files?.[BACKUP_FILE_NAME];
      if (currentFile?.truncated) {
        return jsonResponse({ error: "The existing backup file is too large to verify safely." }, 413, origin);
      }
      if (!currentEtag || currentEtag !== expectedEtag) {
        return jsonResponse({ error: "The Gist changed after this device last loaded it." }, 409, origin);
      }

      // GitHub supports ETags for conditional GETs, but not conditional PATCH writes.
      // This pre-write check detects stale devices; strict atomic serialization needs
      // a Cloudflare Durable Object lock.
      const updateResponse = await githubRequest(gistUrl, env.GITHUB_TOKEN, {
        method: "PATCH",
        body: JSON.stringify(update)
      });
      if (!updateResponse.ok) {
        return jsonResponse({ error: "GitHub could not update the configured Gist.", status: updateResponse.status }, updateResponse.status, origin);
      }

      const updated = await updateResponse.json();
      const etag = updateResponse.headers.get("ETag") || "";
      return jsonResponse({ ok: true, etag, updatedAt: updated.updated_at || null }, 200, origin);
    } catch (error) {
      return jsonResponse({ error: "The secure Gist service could not complete the request." }, 502, origin);
    }
  }
};

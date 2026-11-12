const APP_ORIGIN = "https://protegeeballe-jpg.github.io";
const APP_CLIENT = "faith-focus-daily-armor-web/1";
const MAX_REQUEST_BYTES = 1024 * 1024;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VAULT_ID_PATTERN = /^[a-f0-9]{64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PACKET_FORMAT = "faith-focus-encrypted-daily-packet";
const encoder = new TextEncoder();

function jsonResponse(body, status, origin = null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  });
  if (origin === APP_ORIGIN) headers.set("Access-Control-Allow-Origin", APP_ORIGIN);
  return new Response(JSON.stringify(body), { status, headers });
}

function validDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validPacket(packet, dateString) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return false;
  if (packet.format !== PACKET_FORMAT || packet.version !== 1
      || packet.dateString !== dateString || packet.algorithm !== "AES-256-GCM"
      || !["none", "gzip-base64"].includes(packet.compression)
      || typeof packet.iv !== "string" || typeof packet.ciphertext !== "string") return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(packet.iv)
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(packet.ciphertext)) return false;
  try {
    return atob(packet.iv).length === 12 && atob(packet.ciphertext).length >= 16;
  } catch {
    return false;
  }
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function readBodyLimited(request, limit) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function withCorsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": APP_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Client, X-Write-Token, X-Base-Updated-At",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (origin !== APP_ORIGIN) return jsonResponse({ error: "Origin not allowed." }, 403);
    if (request.method === "OPTIONS") return withCorsPreflight();
    if (request.headers.get("X-App-Client") !== APP_CLIENT) {
      return jsonResponse({ error: "The application client header is required." }, 403, origin);
    }

    const url = new URL(request.url);
    const match = /^\/vault\/([a-f0-9]{64})\/(claim|index|day\/(\d{4}-\d{2}-\d{2}))$/.exec(url.pathname);
    if (!match || url.search || !VAULT_ID_PATTERN.test(match[1])) {
      return jsonResponse({ error: "Route not found." }, 404, origin);
    }
    if (!env.VAULT_PACKETS || !env.VAULT_COORDINATOR) {
      return jsonResponse({ error: "Cloudflare KV and Durable Object bindings are not configured." }, 503, origin);
    }

    const [, vaultId, resource, dateString] = match;
    const expectedMethods = resource === "claim" ? ["POST"]
      : resource === "index" ? ["GET"] : ["GET", "PUT"];
    if (!expectedMethods.includes(request.method)) {
      return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }
    if (dateString && !validDate(dateString)) {
      return jsonResponse({ error: "Invalid calendar date." }, 400, origin);
    }

    let bodyText = "";
    if (request.method === "POST" || request.method === "PUT") {
      bodyText = await readBodyLimited(request, MAX_REQUEST_BYTES);
      if (bodyText === null) return jsonResponse({ error: "Request payload exceeds the 1 MB limit." }, 413, origin);
    }

    const token = request.headers.get("X-Write-Token") || "";
    if (!TOKEN_PATTERN.test(token)) {
      return jsonResponse({ error: "A valid vault write credential is required." }, 401, origin);
    }

    const coordinatorId = env.VAULT_COORDINATOR.idFromName(vaultId);
    const coordinator = env.VAULT_COORDINATOR.get(coordinatorId);
    const internalUrl = new URL("/" + resource, "https://vault-coordinator.internal");
    if (dateString) internalUrl.pathname = "/day/" + dateString;

    const headers = new Headers({
      "Content-Type": "application/json",
      "X-Write-Token": token,
      "X-Vault-Id": vaultId
    });
    if (request.method === "PUT") {
      headers.set("X-Base-Updated-At", request.headers.get("X-Base-Updated-At") || "none");
    }
    const response = await coordinator.fetch(new Request(internalUrl, {
      method: request.method,
      headers,
      body: bodyText || undefined
    }));
    const responseText = await response.text();
    return new Response(responseText, {
      status: response.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": APP_ORIGIN,
        "Vary": "Origin",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
};

export class VaultCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
    this.initialized = this.state.blockConcurrencyWhile(async () => {
      if (!(await this.state.storage.get("vault-index"))) {
        let index = {};
        try {
          index = await this.env.VAULT_PACKETS.get(this.indexKey(), "json") || {};
        } catch {
          index = {};
        }
        await this.state.storage.put("vault-index", index);
      }
    });
  }

  indexKey() {
    return this.state.id.name + ":index";
  }

  packetKey(dateString) {
    return this.state.id.name + ":" + dateString;
  }

  serialized(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  async enforceKvWriteSpacing(key) {
    const storageKey = "kv-write-time:" + key;
    const lastWrite = await this.state.storage.get(storageKey) || 0;
    const waitMs = Math.max(0, 1100 - (Date.now() - lastWrite));
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    await this.state.storage.put(storageKey, Date.now());
  }

  async authenticate(request, { allowFirstClaim = false } = {}) {
    const token = request.headers.get("X-Write-Token") || "";
    const suppliedHash = await sha256Hex(token);
    const storedHash = await this.state.storage.get("write-token-sha256");
    if (!storedHash && allowFirstClaim) {
      await this.state.storage.put("write-token-sha256", suppliedHash);
      await this.state.storage.put("created-at", new Date().toISOString());
      return true;
    }
    if (!storedHash) return false;
    return constantTimeEqual(storedHash, suppliedHash);
  }

  async unauthorized() {
    const bucket = Math.floor(Date.now() / 60000);
    const key = "auth-failures:" + bucket;
    const failures = (await this.state.storage.get(key)) || 0;
    if (failures >= 12) return jsonResponse({ error: "Too many vault authentication attempts. Try again in one minute." }, 429);
    await this.state.storage.put(key, failures + 1);
    return jsonResponse({ error: "Vault credentials were not accepted." }, 401);
  }

  async fetch(request) {
    await this.initialized;
    return this.serialized(async () => {
      const path = new URL(request.url).pathname;
      if (path === "/claim") {
        if (!(await this.authenticate(request, { allowFirstClaim: true }))) return this.unauthorized();
        return jsonResponse({ ok: true, claimed: true }, 200);
      }

      if (!(await this.authenticate(request))) return this.unauthorized();

      if (path === "/index" && request.method === "GET") {
        const index = (await this.state.storage.get("vault-index")) || {};
        return jsonResponse({ index }, 200);
      }

      const dayMatch = /^\/day\/(\d{4}-\d{2}-\d{2})$/.exec(path);
      if (!dayMatch) return jsonResponse({ error: "Route not found." }, 404);
      const dateString = dayMatch[1];
      if (!validDate(dateString)) return jsonResponse({ error: "Invalid calendar date." }, 400);
      const packetStorageKey = "vault-packet:" + dateString;

      if (request.method === "GET") {
        let packet = await this.state.storage.get(packetStorageKey);
        if (!packet) {
          const stored = await this.env.VAULT_PACKETS.get(this.packetKey(dateString), "json");
          if (stored?.packet) {
            packet = stored.packet;
            await this.state.storage.put(packetStorageKey, packet);
          }
        }
        const index = (await this.state.storage.get("vault-index")) || {};
        return jsonResponse({
          packet: packet || null,
          updatedAt: index[dateString]?.updatedAt || null
        }, 200);
      }

      if (request.method !== "PUT") return jsonResponse({ error: "Method not allowed." }, 405);
      let update;
      try { update = await request.json(); }
      catch { return jsonResponse({ error: "Invalid JSON request body." }, 400); }
      if (!update || typeof update !== "object" || Array.isArray(update)
          || !validPacket(update.packet, dateString)
          || ![null, "none"].includes(update.baseUpdatedAt) && typeof update.baseUpdatedAt !== "string") {
        return jsonResponse({ error: "The daily packet or its version is invalid." }, 400);
      }

      const index = (await this.state.storage.get("vault-index")) || {};
      const currentVersion = index[dateString]?.updatedAt || null;
      const suppliedBase = update.baseUpdatedAt === "none" ? null : update.baseUpdatedAt;
      if (suppliedBase !== currentVersion) {
        return jsonResponse({
          error: "This date changed on another device. Local data was kept; reload the latest version before retrying.",
          conflict: true,
          updatedAt: currentVersion
        }, 409);
      }

      await this.enforceKvWriteSpacing(this.packetKey(dateString));
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(currentVersion || "1970-01-01T00:00:00.000Z") + 1)).toISOString();
      const storedRecord = { packet: update.packet, updatedAt };
      await this.env.VAULT_PACKETS.put(this.packetKey(dateString), JSON.stringify(storedRecord));

      const nextIndex = {
        ...index,
        [dateString]: { updatedAt }
      };
      await this.state.storage.put(packetStorageKey, update.packet);
      await this.state.storage.put("vault-index", nextIndex);

      try {
        await this.enforceKvWriteSpacing(this.indexKey());
        await this.env.VAULT_PACKETS.put(this.indexKey(), JSON.stringify(nextIndex));
      } catch {
        // Durable Object metadata remains authoritative; later requests can refresh KV index.
      }

      return jsonResponse({ ok: true, updatedAt }, 200);
    });
  }
}

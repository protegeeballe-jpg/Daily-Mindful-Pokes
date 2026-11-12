const APP_ORIGIN = "https://protegeeballe-jpg.github.io";
const APP_CLIENT = "faith-focus-daily-armor-web/1";
const MAX_REQUEST_BYTES = 1024 * 1024;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VAULT_ID_PATTERN = /^[a-f0-9]{64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PACKET_FORMAT = "faith-focus-encrypted-daily-packet";
const ACCOUNT_KDF_ITERATIONS = 600000;
const RECOVERY_KDF_ITERATIONS = 900000;
const encoder = new TextEncoder();

function normalizeAccountUsername(value) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
}

function validAccountUsername(value) {
  return /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(normalizeAccountUsername(value));
}

function decodeBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
  catch { return null; }
}

function validAccountEnvelope(envelope, iterations) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
      || envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM"
      || envelope.kdf !== "PBKDF2-HMAC-SHA-256" || envelope.iterations !== iterations) return false;
  const salt = decodeBase64(envelope.salt);
  const iv = decodeBase64(envelope.iv);
  const ciphertext = decodeBase64(envelope.ciphertext);
  return Boolean(salt?.length === 16 && iv?.length === 12 && ciphertext?.length === 80);
}

function validRecoveryInput(questionIds, answers) {
  if (!Array.isArray(questionIds) || !Array.isArray(answers)
      || questionIds.length !== 3 || answers.length !== 3) return false;
  const ids = questionIds.map(Number);
  return ids.every(id => Number.isInteger(id) && id >= 1 && id <= 20)
    && new Set(ids).size === 3
    && answers.every(answer => typeof answer === "string"
      && answer.length >= 1 && answer.length <= 64
      && answer.trim() === answer && !/\\s/u.test(answer));
}

async function recoveryLookupHash(questionIds, answers, pepper) {
  const pairs = questionIds.map((id, index) => ({ id: Number(id), answer: answers[index] }))
    .sort((left, right) => left.id - right.id);
  const key = await crypto.subtle.importKey("raw", encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify(pairs))));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

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
    if (url.search) return jsonResponse({ error: "Query parameters are not supported." }, 400, origin);

    if (url.pathname.startsWith("/account/")) {
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, origin);
      if (!env.ACCOUNT_DIRECTORY || typeof env.RECOVERY_PEPPER !== "string"
          || encoder.encode(env.RECOVERY_PEPPER).length < 32) {
        return jsonResponse({ error: "Account recovery services are not configured. Contact the app administrator." }, 503, origin);
      }
      const bodyText = await readBodyLimited(request, 64 * 1024);
      if (bodyText === null) return jsonResponse({ error: "Account request is too large." }, 413, origin);
      const directory = env.ACCOUNT_DIRECTORY.get(env.ACCOUNT_DIRECTORY.idFromName("faith-focus-account-directory-v1"));
      const internalUrl = new URL(url.pathname, "https://account-directory.internal");
      const headers = new Headers({
        "Content-Type": "application/json",
        "X-Client-IP": request.headers.get("CF-Connecting-IP") || "unknown"
      });
      const response = await directory.fetch(new Request(internalUrl, { method: "POST", headers, body: bodyText || "{}" }));
      return new Response(await response.text(), {
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
    this.initialized = null;
  }

  indexKey() {
    return this.vaultId + ":index";
  }

  packetKey(dateString) {
    return this.vaultId + ":" + dateString;
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
    this.vaultId = request.headers.get("X-Vault-Id") || "";
    if (!VAULT_ID_PATTERN.test(this.vaultId)) return jsonResponse({ error: "Invalid vault identifier." }, 400);
    if (!this.initialized) {
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
          updatedAt: index[dateString] || null
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
      const currentVersion = index[dateString] || null;
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
        [dateString]: updatedAt
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

/**
 * Global account directory. Plaintext answers are evaluated transiently in
 * this Durable Object and converted to a peppered HMAC lookup. Only the HMAC,
 * selected question IDs, and encrypted master-key envelopes are persisted.
 */
export class AccountDirectory {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
  }

  serialized(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  async rateLimit(request) {
    const ip = request.headers.get("X-Client-IP") || "unknown";
    const key = "recovery-rate:" + await sha256Hex(ip);
    const cutoff = Date.now() - 15 * 60 * 1000;
    const prior = (await this.state.storage.get(key)) || [];
    const attempts = Array.isArray(prior) ? prior.filter(time => Number.isFinite(time) && time > cutoff) : [];
    if (attempts.length >= 5) return jsonResponse({
      error: "Too many recovery attempts. Please try again in 15 minutes."
    }, 429);
    attempts.push(Date.now());
    await this.state.storage.put(key, attempts, { expirationTtl: 3600 });
    return null;
  }

  async getRecoveryRecord(body) {
    if (!validRecoveryInput(body.questionIds, body.answers)) return null;
    const lookup = await recoveryLookupHash(body.questionIds, body.answers, this.env.RECOVERY_PEPPER);
    const vaultId = await this.state.storage.get("recovery:" + lookup);
    if (typeof vaultId !== "string" || !VAULT_ID_PATTERN.test(vaultId)) return null;
    const record = await this.state.storage.get("account:" + vaultId);
    if (!record || record.recoveryLookupHash !== lookup) return null;
    return { lookup, vaultId, record };
  }

  async fetch(request) {
    return this.serialized(async () => {
      const path = new URL(request.url).pathname;
      let body;
      try { body = await request.json(); }
      catch { return jsonResponse({ error: "Invalid account request." }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse({ error: "Invalid account request." }, 400);
      }

      if (path === "/account/signup") {
        const username = normalizeAccountUsername(body.username);
        const vaultId = body.vaultId;
        if (!validAccountUsername(username) || !VAULT_ID_PATTERN.test(vaultId || "")
            || !validAccountEnvelope(body.passphraseEnvelope, ACCOUNT_KDF_ITERATIONS)
            || !validAccountEnvelope(body.recoveryEnvelope, RECOVERY_KDF_ITERATIONS)
            || !validRecoveryInput(body.questionIds, body.answers)) {
          return jsonResponse({ error: "The account details or recovery setup are invalid." }, 400);
        }
        const lookup = await recoveryLookupHash(body.questionIds, body.answers, this.env.RECOVERY_PEPPER);
        const existingUsername = await this.state.storage.get("username:" + username);
        const existingVault = await this.state.storage.get("account:" + vaultId);
        const existingRecovery = await this.state.storage.get("recovery:" + lookup);
        if (existingUsername || existingVault) {
          return jsonResponse({ error: "That username is already registered. Choose another username or sign in." }, 409);
        }
        if (existingRecovery) {
          return jsonResponse({
            error: "That three-answer combination is already used by an account. Choose different, less predictable answers."
          }, 409);
        }

        const questionIds = body.questionIds.map(Number).sort((a, b) => a - b);
        const now = new Date().toISOString();
        const record = {
          vaultId, username, questionIds,
          passphraseEnvelope: body.passphraseEnvelope,
          recoveryEnvelope: body.recoveryEnvelope,
          recoveryLookupHash: lookup, createdAt: now, updatedAt: now
        };
        await this.state.storage.put("account:" + vaultId, record);
        await this.state.storage.put("username:" + username, vaultId);
        await this.state.storage.put("recovery:" + lookup, vaultId);
        return jsonResponse({ ok: true, vaultId, username }, 201);
      }

      if (path === "/account/signin") {
        const username = normalizeAccountUsername(body.username);
        if (!validAccountUsername(username)) {
          return jsonResponse({ error: "The username or passphrase was not accepted." }, 404);
        }
        const vaultId = await this.state.storage.get("username:" + username);
        const record = typeof vaultId === "string"
          ? await this.state.storage.get("account:" + vaultId) : null;
        if (!record) {
          return jsonResponse({ error: "The username or passphrase was not accepted.", legacyAccount: true }, 404);
        }
        return jsonResponse({
          vaultId: record.vaultId, username: record.username,
          passphraseEnvelope: record.passphraseEnvelope
        }, 200);
      }

      if (path === "/account/recovery/lookup" || path === "/account/recovery/update") {
        const blocked = await this.rateLimit(request);
        if (blocked) return blocked;
        const match = await this.getRecoveryRecord(body);
        if (!match) return jsonResponse({
          error: "The selected questions or answers were not accepted. Check all three answers, including capitalization."
        }, 401);

        if (path === "/account/recovery/lookup") {
          return jsonResponse({
            vaultId: match.vaultId, username: match.record.username,
            questionIds: match.record.questionIds, recoveryEnvelope: match.record.recoveryEnvelope
          }, 200);
        }

        if (body.vaultId !== match.vaultId) {
          return jsonResponse({ error: "The recovery session is invalid. Start again." }, 401);
        }
        const requestedUsername = body.newUsername === undefined || body.newUsername === null || body.newUsername === ""
          ? match.record.username : normalizeAccountUsername(body.newUsername);
        if (!validAccountUsername(requestedUsername)) {
          return jsonResponse({ error: "Use a 3–32 character username with letters, numbers, dots, underscores, or hyphens." }, 400);
        }
        if (body.passphraseEnvelope !== null && body.passphraseEnvelope !== undefined
            && !validAccountEnvelope(body.passphraseEnvelope, ACCOUNT_KDF_ITERATIONS)) {
          return jsonResponse({ error: "The new passphrase envelope is invalid." }, 400);
        }
        const owner = await this.state.storage.get("username:" + requestedUsername);
        if (owner && owner !== match.vaultId) {
          return jsonResponse({ error: "That username is already in use. Choose another." }, 409);
        }

        if (requestedUsername !== match.record.username) {
          await this.state.storage.delete("username:" + match.record.username);
          await this.state.storage.put("username:" + requestedUsername, match.vaultId);
        }
        const updated = {
          ...match.record, username: requestedUsername,
          ...(body.passphraseEnvelope ? { passphraseEnvelope: body.passphraseEnvelope } : {}),
          updatedAt: new Date().toISOString()
        };
        await this.state.storage.put("account:" + match.vaultId, updated);
        return jsonResponse({ ok: true, vaultId: match.vaultId, username: requestedUsername }, 200);
      }

      return jsonResponse({ error: "Account route not found." }, 404);
    });
  }
}

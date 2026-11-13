const APP_ORIGIN = "https://protegeeballe-jpg.github.io";
const APP_CLIENT = "faith-focus-daily-armor-web/1";
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_PACKET_CIPHERTEXT_BYTES = 700 * 1024 + 16;
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
  const allowedFields = new Set(["format", "version", "dateString", "algorithm", "compression", "iv", "ciphertext"]);
  const fields = Object.keys(packet);
  if (fields.length !== allowedFields.size || fields.some(field => !allowedFields.has(field))) return false;
  if (packet.format !== PACKET_FORMAT || packet.version !== 1
      || packet.dateString !== dateString || packet.algorithm !== "AES-256-GCM"
      || !["none", "gzip-base64"].includes(packet.compression)
      || typeof packet.iv !== "string" || typeof packet.ciphertext !== "string") return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(packet.iv)
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(packet.ciphertext)) return false;
  try {
    const iv = atob(packet.iv);
    const ciphertext = atob(packet.ciphertext);
    return iv.length === 12
      && ciphertext.length >= 16
      && ciphertext.length <= MAX_PACKET_CIPHERTEXT_BYTES;
  } catch {
    return false;
  }
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new TypeError("Invalid base64.");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function fromHex(value) {
  if (typeof value !== "string" || !/^[a-f0-9]+$/i.test(value) || value.length % 2) {
    throw new TypeError("Invalid hexadecimal value.");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function encodeBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeUsername(value) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
}

function validUsername(value) {
  const normalized = normalizeUsername(value);
  return /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(normalized) ? normalized : null;
}

function validQuestionAnswers(answers) {
  if (!Array.isArray(answers) || answers.length !== 3) return false;
  const seen = new Set();
  return answers.every(item => {
    const id = Number(item?.questionId);
    const answer = item?.answer;
    if (!Number.isInteger(id) || id < 1 || id > 20 || seen.has(id)
        || typeof answer !== "string" || answer.length < 1 || answer.length > 64 || /\s/u.test(answer)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function canonicalRecoveryAnswers(answers) {
  if (!validQuestionAnswers(answers)) throw new TypeError("Exactly three distinct one-word answers are required.");
  return JSON.stringify(answers
    .map(item => ({ questionId: Number(item.questionId), answer: item.answer }))
    .sort((left, right) => left.questionId - right.questionId));
}

async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value));
}

async function sha256Hex(value) {
  const digest = await sha256Bytes(value);
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(signature, byte => byte.toString(16).padStart(2, "0")).join("");
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

async function recoverySealKey(pepper) {
  const raw = await sha256Bytes("FaithFocus|recovery-envelope-seal|v1|" + pepper);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function sealRecoveryEnvelope(envelope, vaultId, pepper) {
  const key = await recoverySealKey(pepper);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(envelope));
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM", iv, additionalData: encoder.encode("FaithFocus|recovery-envelope|v1|" + vaultId), tagLength: 128
  }, key, plaintext);
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

async function unsealRecoveryEnvelope(sealed, vaultId, pepper) {
  const key = await recoverySealKey(pepper);
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: fromBase64(sealed.iv),
    additionalData: encoder.encode("FaithFocus|recovery-envelope|v1|" + vaultId),
    tagLength: 128
  }, key, fromBase64(sealed.ciphertext));
  const envelope = JSON.parse(new TextDecoder().decode(plaintext));
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM"
      || fromBase64(envelope.iv).length !== 12 || fromBase64(envelope.ciphertext).length !== 48) {
    throw new Error("The sealed recovery envelope is invalid.");
  }
  return envelope;
}

function validBase64Length(value, expectedLength) {
  try { return fromBase64(value).length === expectedLength; }
  catch { return false; }
}

function validEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.version !== 1 || value.algorithm !== "AES-256-GCM"
      || typeof value.iv !== "string" || typeof value.ciphertext !== "string") return false;
  try {
    return fromBase64(value.iv).length === 12 && fromBase64(value.ciphertext).length === 48;
  } catch {
    return false;
  }
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

async function parseJsonBody(bodyText) {
  try {
    const parsed = JSON.parse(bodyText || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
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

async function callCoordinator(env, vaultId, path, { token, oldToken, body } = {}) {
  const id = env.VAULT_COORDINATOR.idFromName(vaultId);
  const stub = env.VAULT_COORDINATOR.get(id);
  const headers = new Headers({ "X-Vault-Id": vaultId });
  if (token) headers.set("X-Write-Token", token);
  if (oldToken) headers.set("X-Legacy-Write-Token", oldToken);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return stub.fetch(new Request("https://vault-coordinator.internal" + path, {
    method: body === undefined ? "POST" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
}

async function callRegistry(env, path, body, request) {
  const id = env.ACCOUNT_REGISTRY.idFromName("global-account-registry");
  const stub = env.ACCOUNT_REGISTRY.get(id);
  const headers = new Headers({ "Content-Type": "application/json" });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) headers.set("X-Recovery-Client-IP", ip);
  return stub.fetch(new Request("https://account-registry.internal" + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  }));
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
    const accountRoute = /^\/account\/(signup|migrate-legacy|signin|unlock|recover|complete-recovery)$/.exec(url.pathname);
    let bodyText = "";
    if (request.method === "POST" || request.method === "PUT") {
      const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
      if (contentType !== "application/json") {
        return jsonResponse({ error: "Requests with a body must use Content-Type: application/json." }, 415, origin);
      }
      try {
        bodyText = await readBodyLimited(request, MAX_REQUEST_BYTES);
      } catch (error) {
        return jsonResponse({ error: "The request body could not be read safely." }, 400, origin);
      }
      if (bodyText === null) return jsonResponse({ error: "Request payload exceeds the 1 MB limit." }, 413, origin);
    }

    if (accountRoute) {
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, origin);
      if (!env.ACCOUNT_REGISTRY || !env.VAULT_COORDINATOR) {
        return jsonResponse({ error: "The account registry services are not configured. Please contact the app maintainer." }, 503, origin);
      }
      const route = accountRoute[1];
      if (["signup", "migrate-legacy", "recover"].includes(route)
          && (!env.RECOVERY_PEPPER || String(env.RECOVERY_PEPPER).length < 32)) {
        return jsonResponse({ error: "Account recovery is not configured. Please contact the app maintainer." }, 503, origin);
      }
      const payload = await parseJsonBody(bodyText);
      if (!payload) return jsonResponse({ error: "Invalid JSON request body." }, 400, origin);
      if (route === "unlock") {
        const vaultId = payload.vaultId;
        const token = request.headers.get("X-Write-Token") || "";
        if (!VAULT_ID_PATTERN.test(vaultId || "") || !TOKEN_PATTERN.test(token)) {
          return jsonResponse({ error: "The account credentials were not accepted." }, 401, origin);
        }
        const claimResponse = await callCoordinator(env, vaultId, "/claim", { token });
        if (!claimResponse.ok) return jsonResponse({ error: "The username or passphrase was not accepted." }, claimResponse.status, origin);
        const metadataResponse = await callRegistry(env, "/authenticated-envelope", { vaultId }, request);
        const metadata = await metadataResponse.json();
        if (!metadataResponse.ok) return jsonResponse(metadata, metadataResponse.status, origin);
        return jsonResponse(metadata, 200, origin);
      }

      const registryResponse = await callRegistry(env, "/" + route, payload, request);
      const responseText = await registryResponse.text();
      return new Response(responseText, {
        status: registryResponse.status,
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
    if (request.method !== "GET" && request.method !== "POST" && request.method !== "PUT") {
      return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }

    const token = request.headers.get("X-Write-Token") || "";
    if (!TOKEN_PATTERN.test(token)) {
      return jsonResponse({ error: "A valid vault write credential is required." }, 401, origin);
    }

    const id = env.VAULT_COORDINATOR.idFromName(vaultId);
    const coordinator = env.VAULT_COORDINATOR.get(id);
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

export class AccountRegistry {
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

  usernameKey(username) {
    return "username:" + username;
  }

  accountKey(vaultId) {
    return "account:" + vaultId;
  }

  async recoveryDigest(answers) {
    return hmacHex(this.env.RECOVERY_PEPPER, canonicalRecoveryAnswers(answers));
  }

  async rateLimitRecovery(request) {
    const ip = request.headers.get("X-Recovery-Client-IP") || "unknown-client";
    const windowNumber = Math.floor(Date.now() / (15 * 60 * 1000));
    const ipDigest = await hmacHex(this.env.RECOVERY_PEPPER, "recovery-ip|" + ip);
    const key = "recovery-attempts:" + ipDigest + ":" + windowNumber;
    const attempts = (await this.state.storage.get(key)) || 0;
    if (attempts >= 5) return false;
    await this.state.storage.put(key, attempts + 1);
    return true;
  }

  async initializeVault(vaultId, writeToken) {
    const response = await callCoordinator(this.env, vaultId, "/admin/initialize", { token: writeToken });
    if (!response.ok) throw new Error("The account vault could not be initialized.");
  }

  async fetch(request) {
    return this.serialized(() => this.handle(request));
  }

  async handle(request) {
    const path = new URL(request.url).pathname;
    let payload;
    try {
      payload = await request.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid payload.");
    } catch {
      return jsonResponse({ error: "Invalid account request." }, 400);
    }

    if (path === "/signup") {
      const username = validUsername(payload.username);
      const vaultId = payload.vaultId;
      const answers = payload.questionAnswers;
      if (!username || !VAULT_ID_PATTERN.test(vaultId || "")
          || !validBase64Length(payload.passphraseSalt, 16)
          || payload.passphraseIterations !== 600000 || !validEnvelope(payload.passphraseEnvelope)
          || !validBase64Length(payload.recoverySalt, 16)
          || payload.recoveryIterations !== 1200000 || !validEnvelope(payload.recoveryEnvelope)
          || !validQuestionAnswers(answers) || !TOKEN_PATTERN.test(payload.writeToken || "")) {
        return jsonResponse({ error: "The sign-up information is incomplete or invalid." }, 400);
      }
      const usernameIndexKey = this.usernameKey(username);
      if (await this.state.storage.get(usernameIndexKey)) {
        return jsonResponse({ error: "That username is already in use. Please choose another." }, 409);
      }

      const recoveryDigest = await this.recoveryDigest(answers);
      if (await this.state.storage.get("recovery:" + recoveryDigest)) {
        return jsonResponse({
          error: "That exact security-question combination is already in use. Choose different questions or less predictable answers."
        }, 409);
      }

      try {
        const sealedRecoveryEnvelope = await sealRecoveryEnvelope(
          payload.recoveryEnvelope, vaultId, this.env.RECOVERY_PEPPER
        );
        const record = {
          username,
          vaultId,
          passphraseSalt: payload.passphraseSalt,
          passphraseIterations: payload.passphraseIterations,
          passphraseEnvelope: payload.passphraseEnvelope,
          recoverySalt: payload.recoverySalt,
          recoveryIterations: payload.recoveryIterations,
          sealedRecoveryEnvelope,
          recoveryDigest,
          createdAt: new Date().toISOString()
        };
        await this.initializeVault(vaultId, payload.writeToken);
        await this.state.storage.put(this.accountKey(vaultId), record);
        await this.state.storage.put(usernameIndexKey, vaultId);
        await this.state.storage.put("recovery:" + recoveryDigest, vaultId);
        return jsonResponse({ ok: true, username, vaultId }, 201);
      } catch (error) {
        // Log only the error category. Never log account data or recovery answers.
        console.error("Account Registry sign-up failed:", error instanceof Error ? error.name : "UnknownError");
        return jsonResponse({ error: "The account could not be created. Please try again." }, 503);
      }
    }

    if (path === "/migrate-legacy") {
      const username = validUsername(payload.username);
      const vaultId = payload.vaultId;
      const answers = payload.questionAnswers;
      if (!username || !VAULT_ID_PATTERN.test(vaultId || "")
          || !validBase64Length(payload.passphraseSalt, 16)
          || payload.passphraseIterations !== 600000 || !validEnvelope(payload.passphraseEnvelope)
          || !validBase64Length(payload.recoverySalt, 16)
          || payload.recoveryIterations !== 1200000 || !validEnvelope(payload.recoveryEnvelope)
          || !validQuestionAnswers(answers)
          || !TOKEN_PATTERN.test(payload.writeToken || "")
          || !TOKEN_PATTERN.test(payload.legacyWriteToken || "")) {
        return jsonResponse({ error: "The legacy account upgrade information is incomplete or invalid." }, 400);
      }
      if (await this.state.storage.get(this.usernameKey(username))) {
        return jsonResponse({ error: "This username already has a registered account." }, 409);
      }
      const recoveryDigest = await this.recoveryDigest(answers);
      if (await this.state.storage.get("recovery:" + recoveryDigest)) {
        return jsonResponse({
          error: "That exact security-question combination is already in use. Choose different questions or less predictable answers."
        }, 409);
      }
      try {
        const sealedRecoveryEnvelope = await sealRecoveryEnvelope(
          payload.recoveryEnvelope, vaultId, this.env.RECOVERY_PEPPER
        );
        const record = {
          username,
          vaultId,
          passphraseSalt: payload.passphraseSalt,
          passphraseIterations: payload.passphraseIterations,
          passphraseEnvelope: payload.passphraseEnvelope,
          recoverySalt: payload.recoverySalt,
          recoveryIterations: payload.recoveryIterations,
          sealedRecoveryEnvelope,
          recoveryDigest,
          createdAt: new Date().toISOString(),
          upgradedFromLegacyVault: true
        };
        const migrated = await callCoordinator(this.env, vaultId, "/admin/migrate-legacy", {
          token: payload.writeToken,
          oldToken: payload.legacyWriteToken
        });
        if (!migrated.ok) {
          return jsonResponse({ error: "The existing vault credentials could not be verified. No account changes were made." }, 401);
        }
        await this.state.storage.put(this.accountKey(vaultId), record);
        await this.state.storage.put(this.usernameKey(username), vaultId);
        await this.state.storage.put("recovery:" + recoveryDigest, vaultId);
        return jsonResponse({ ok: true, username, vaultId, upgraded: true }, 200);
      } catch (error) {
        // Log only the error category, never account data or recovery answers.
        console.error("Account Registry legacy migration failed:", error instanceof Error ? error.name : "UnknownError");
        return jsonResponse({ error: "The existing account could not be upgraded. Keep your previous account credentials and try again." }, 503);
      }
    }

    if (path === "/signin") {
      const username = validUsername(payload.username);
      if (!username) return jsonResponse({ error: "The username or passphrase was not accepted." }, 401);
      const vaultId = await this.state.storage.get(this.usernameKey(username));
      if (!vaultId) return jsonResponse({ error: "The username or passphrase was not accepted." }, 401);
      const record = await this.state.storage.get(this.accountKey(vaultId));
      if (!record) return jsonResponse({ error: "The username or passphrase was not accepted." }, 401);
      return jsonResponse({
        username: record.username,
        vaultId: record.vaultId,
        passphraseSalt: record.passphraseSalt,
        passphraseIterations: record.passphraseIterations
      }, 200);
    }

    if (path === "/authenticated-envelope") {
      const vaultId = payload.vaultId;
      if (!VAULT_ID_PATTERN.test(vaultId || "")) return jsonResponse({ error: "Account not found." }, 404);
      const record = await this.state.storage.get(this.accountKey(vaultId));
      if (!record) return jsonResponse({ error: "Account not found." }, 404);
      return jsonResponse({
        username: record.username,
        vaultId: record.vaultId,
        passphraseEnvelope: record.passphraseEnvelope
      }, 200);
    }

    if (path === "/recover") {
      if (!(await this.rateLimitRecovery(request))) {
        return jsonResponse({ error: "Too many recovery attempts. Please try again in 15 minutes." }, 429);
      }
      if (!validQuestionAnswers(payload.questionAnswers)) {
        return jsonResponse({ error: "Choose the same three questions and enter each one-word answer exactly as during sign-up." }, 400);
      }
      let vaultId;
      try {
        const digest = await this.recoveryDigest(payload.questionAnswers);
        vaultId = await this.state.storage.get("recovery:" + digest);
      } catch {
        return jsonResponse({ error: "The recovery answers could not be verified." }, 400);
      }
      if (!vaultId) return jsonResponse({ error: "The three answers did not match an account. Check the selected questions, spelling, and letter case." }, 401);
      const record = await this.state.storage.get(this.accountKey(vaultId));
      if (!record) return jsonResponse({ error: "The account recovery record could not be found." }, 404);
      let recoveryEnvelope;
      try {
        recoveryEnvelope = await unsealRecoveryEnvelope(
          record.sealedRecoveryEnvelope, vaultId, this.env.RECOVERY_PEPPER
        );
      } catch {
        return jsonResponse({ error: "The recovery record could not be opened. Contact the app maintainer." }, 503);
      }
      const grantBytes = crypto.getRandomValues(new Uint8Array(32));
      const grant = encodeBase64Url(grantBytes);
      const grantHash = await sha256Hex(grant);
      await this.state.storage.put("recovery-grant:" + grantHash, {
        vaultId,
        expiresAt: Date.now() + 10 * 60 * 1000
      });
      return jsonResponse({
        grant,
        username: record.username,
        vaultId: record.vaultId,
        recoverySalt: record.recoverySalt,
        recoveryIterations: record.recoveryIterations,
        recoveryEnvelope
      }, 200);
    }

    if (path === "/complete-recovery") {
      const grant = payload.grant;
      if (!TOKEN_PATTERN.test(grant || "")) return jsonResponse({ error: "The recovery session is invalid or expired." }, 401);
      const grantHash = await sha256Hex(grant);
      const grantKey = "recovery-grant:" + grantHash;
      const grantRecord = await this.state.storage.get(grantKey);
      if (!grantRecord || grantRecord.expiresAt < Date.now()) {
        if (grantRecord) await this.state.storage.delete(grantKey);
        return jsonResponse({ error: "The recovery session expired. Please verify your answers again." }, 401);
      }

      const record = await this.state.storage.get(this.accountKey(grantRecord.vaultId));
      if (!record) return jsonResponse({ error: "The account could not be found." }, 404);
      const newUsername = payload.newUsername ? validUsername(payload.newUsername) : null;
      if (payload.newUsername && !newUsername) {
        return jsonResponse({ error: "The new username must contain 3–32 letters, numbers, dots, hyphens, or underscores." }, 400);
      }
      const passwordFieldsPresent = payload.passphraseSalt !== undefined
        || payload.passphraseEnvelope !== undefined || payload.passphraseIterations !== undefined
        || payload.writeToken !== undefined;
      if (passwordFieldsPresent && (
        !validBase64Length(payload.passphraseSalt, 16)
        || payload.passphraseIterations !== 600000 || !validEnvelope(payload.passphraseEnvelope)
        || !TOKEN_PATTERN.test(payload.writeToken || "")
      )) {
        return jsonResponse({ error: "The new passphrase information is invalid." }, 400);
      }
      if (!newUsername && !passwordFieldsPresent) {
        return jsonResponse({ error: "Choose a new username, a new passphrase, or both." }, 400);
      }

      const oldUsername = record.username;
      if (newUsername && newUsername !== oldUsername) {
        const existingVault = await this.state.storage.get(this.usernameKey(newUsername));
        if (existingVault && existingVault !== record.vaultId) {
          return jsonResponse({ error: "That username is already in use. Choose another." }, 409);
        }
      }

      if (passwordFieldsPresent) {
        const rotated = await callCoordinator(this.env, record.vaultId, "/admin/rotate-token", { token: payload.writeToken });
        if (!rotated.ok) return jsonResponse({ error: "The account passphrase could not be updated." }, 503);
        record.passphraseSalt = payload.passphraseSalt;
        record.passphraseIterations = payload.passphraseIterations;
        record.passphraseEnvelope = payload.passphraseEnvelope;
      }
      if (newUsername && newUsername !== oldUsername) {
        await this.state.storage.delete(this.usernameKey(oldUsername));
        record.username = newUsername;
        await this.state.storage.put(this.usernameKey(newUsername), record.vaultId);
      }
      await this.state.storage.put(this.accountKey(record.vaultId), record);
      await this.state.storage.delete(grantKey);
      return jsonResponse({
        ok: true,
        username: record.username,
        vaultId: record.vaultId,
        usernameChanged: record.username !== oldUsername,
        passphraseChanged: passwordFieldsPresent
      }, 200);
    }

    return jsonResponse({ error: "Account route not found." }, 404);
  }
}

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

      // These administrative paths are reachable only through internal Worker
      // bindings; the public router never forwards client-controlled paths here.
      if (path === "/admin/initialize") {
        const token = request.headers.get("X-Write-Token") || "";
        if (!TOKEN_PATTERN.test(token)) return jsonResponse({ error: "Invalid initial write token." }, 400);
        const existing = await this.state.storage.get("write-token-sha256");
        if (existing) return jsonResponse({ error: "Vault is already initialized." }, 409);
        await this.state.storage.put("write-token-sha256", await sha256Hex(token));
        await this.state.storage.put("created-at", new Date().toISOString());
        return jsonResponse({ ok: true }, 200);
      }

      if (path === "/admin/migrate-legacy") {
        const oldToken = request.headers.get("X-Legacy-Write-Token") || "";
        const newToken = request.headers.get("X-Write-Token") || "";
        if (!TOKEN_PATTERN.test(oldToken) || !TOKEN_PATTERN.test(newToken)) {
          return jsonResponse({ error: "The legacy upgrade credentials are invalid." }, 400);
        }
        const storedHash = await this.state.storage.get("write-token-sha256");
        if (!storedHash || !constantTimeEqual(storedHash, await sha256Hex(oldToken))) {
          return this.unauthorized();
        }
        await this.state.storage.put("write-token-sha256", await sha256Hex(newToken));
        await this.state.storage.put("upgraded-at", new Date().toISOString());
        return jsonResponse({ ok: true }, 200);
      }

      if (path === "/admin/rotate-token") {
        const token = request.headers.get("X-Write-Token") || "";
        if (!TOKEN_PATTERN.test(token)) return jsonResponse({ error: "Invalid replacement token." }, 400);
        if (!(await this.state.storage.get("write-token-sha256"))) {
          return jsonResponse({ error: "Vault has not been initialized." }, 404);
        }
        await this.state.storage.put("write-token-sha256", await sha256Hex(token));
        return jsonResponse({ ok: true }, 200);
      }

      if (path === "/claim") {
        if (!(await this.authenticate(request))) return this.unauthorized();
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

      const nextIndex = { ...index, [dateString]: updatedAt };
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

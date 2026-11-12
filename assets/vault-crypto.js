/**
 * Account and packet cryptography for Faith & Focus: Daily Armor.
 * A random permanent Vault ID and master key keep data stable when the
 * user's username or passphrase changes.
 */
export const VAULT_KDF_ITERATIONS = 600000;
export const RECOVERY_KDF_ITERATIONS = 1200000;
export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_PASSPHRASE_LENGTH = 128;
export const VAULT_PACKET_FORMAT = 'faith-focus-encrypted-daily-packet';
export const VAULT_PACKET_VERSION = 1;
const encoder = new TextEncoder();
const PASS_KEY_AAD = 'FaithFocus|master-key|v1|passphrase|';
const RECOVERY_KEY_AAD = 'FaithFocus|master-key|v1|recovery|';
const LEGACY_VAULT_ID_DOMAIN = 'FaithFocus|VaultID|v1|';
const LEGACY_VAULT_SALT_DOMAIN = 'FaithFocus|PBKDF2-Salt|v1|';
const PACKET_AAD_DOMAIN = 'Faith & Focus|Vault Daily Packet|v1|';

export function normalizeVaultUsername(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().toLowerCase();
}

export function validateVaultUsername(value) {
  const normalized = normalizeVaultUsername(value);
  return {
    valid: /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(normalized),
    normalized
  };
}

export function validateVaultPassphrase(value, { creating = false } = {}) {
  const passphrase = typeof value === 'string' ? value : '';
  if (passphrase.length > MAX_PASSPHRASE_LENGTH) {
    return { valid: false, message: 'Passphrases must be 128 characters or fewer.' };
  }
  if (creating && passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return { valid: false, message: 'Choose a passphrase with at least 12 characters.' };
  }
  if (!creating && passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return { valid: false, message: 'Enter the passphrase for this account.' };
  }
  return { valid: true, message: '' };
}

export function validateRecoveryAnswers(answers) {
  if (!Array.isArray(answers) || answers.length !== 3) {
    return { valid: false, message: 'Choose and answer exactly three security questions.' };
  }
  const ids = new Set();
  for (const item of answers) {
    const id = Number(item?.questionId);
    const answer = item?.answer;
    if (!Number.isInteger(id) || id < 1 || id > 20 || ids.has(id)) {
      return { valid: false, message: 'Choose three different security questions.' };
    }
    if (typeof answer !== 'string' || answer.length < 1 || answer.length > 64 || /\s/u.test(answer)) {
      return { valid: false, message: 'Each security answer must be one word, with no spaces.' };
    }
    ids.add(id);
  }
  return { valid: true, message: '' };
}

export function canonicalizeRecoveryAnswers(answers) {
  const validation = validateRecoveryAnswers(answers);
  if (!validation.valid) throw new TypeError(validation.message);
  return JSON.stringify(answers
    .map(item => ({ questionId: Number(item.questionId), answer: item.answer }))
    .sort((left, right) => left.questionId - right.questionId));
}

function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new TypeError('Invalid base64 value.');
  }
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function encodeBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new TypeError('Invalid write token encoding.');
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '=';
  return fromBase64(normalized);
}

function concatBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function randomBytes(length, cryptoApi) {
  return cryptoApi.getRandomValues(new Uint8Array(length));
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function derivePassphraseMaterial(passphrase, salt, vaultId, cryptoApi = globalThis.crypto) {
  const material = await cryptoApi.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveBits']
  );
  const derived = new Uint8Array(await cryptoApi.subtle.deriveBits({
    name: 'PBKDF2',
    salt: concatBytes(salt, encoder.encode('|FaithFocus|passphrase|v1|' + vaultId)),
    iterations: VAULT_KDF_ITERATIONS,
    hash: 'SHA-256'
  }, material, 512));
  const wrappingKey = await cryptoApi.subtle.importKey(
    'raw', derived.slice(0, 32), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  const writeToken = derived.slice(32, 64);
  derived.fill(0);
  return { wrappingKey, writeToken };
}

async function deriveRecoveryWrappingKey(answers, salt, vaultId, cryptoApi = globalThis.crypto) {
  const canonical = canonicalizeRecoveryAnswers(answers);
  const material = await cryptoApi.subtle.importKey(
    'raw', encoder.encode(canonical), 'PBKDF2', false, ['deriveKey']
  );
  return cryptoApi.subtle.deriveKey({
    name: 'PBKDF2',
    salt: concatBytes(salt, encoder.encode('|FaithFocus|recovery|v1|' + vaultId)),
    iterations: RECOVERY_KDF_ITERATIONS,
    hash: 'SHA-256'
  }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrapMasterKey(masterBytes, wrappingKey, aad, cryptoApi = globalThis.crypto) {
  const iv = randomBytes(12, cryptoApi);
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad), tagLength: 128 },
    wrappingKey, masterBytes
  );
  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext))
  };
}

async function unwrapMasterKey(envelope, wrappingKey, aad, cryptoApi = globalThis.crypto) {
  if (!isValidKeyEnvelope(envelope)) throw new Error('The account recovery or passphrase envelope is invalid.');
  try {
    const raw = await cryptoApi.subtle.decrypt({
      name: 'AES-GCM',
      iv: fromBase64(envelope.iv),
      additionalData: encoder.encode(aad),
      tagLength: 128
    }, wrappingKey, fromBase64(envelope.ciphertext));
    const bytes = new Uint8Array(raw);
    if (bytes.length !== 32) {
      bytes.fill(0);
      throw new Error('The account master key has an invalid length.');
    }
    return bytes;
  } catch {
    throw new Error('The passphrase or security answers did not unlock this account.');
  }
}

export function isValidKeyEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM'
      || typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') return false;
  try {
    return fromBase64(envelope.iv).length === 12 && fromBase64(envelope.ciphertext).length === 48;
  } catch {
    return false;
  }
}

export async function createVaultAccount(username, passphrase, answers, cryptoApi = globalThis.crypto) {
  const usernameResult = validateVaultUsername(username);
  const passphraseResult = validateVaultPassphrase(passphrase, { creating: true });
  const answerResult = validateRecoveryAnswers(answers);
  if (!usernameResult.valid) throw new Error('Use a 3–32 character username with letters, numbers, dots, underscores, or hyphens.');
  if (!passphraseResult.valid) throw new Error(passphraseResult.message);
  if (!answerResult.valid) throw new Error(answerResult.message);
  if (!cryptoApi?.subtle || !cryptoApi?.getRandomValues) throw new Error('Secure browser cryptography is unavailable. Open the app over HTTPS.');

  const vaultId = bytesToHex(randomBytes(32, cryptoApi));
  const masterBytes = randomBytes(32, cryptoApi);
  const passphraseSalt = randomBytes(16, cryptoApi);
  const recoverySalt = randomBytes(16, cryptoApi);
  let passphraseMaterial;
  try {
    passphraseMaterial = await derivePassphraseMaterial(passphrase, passphraseSalt, vaultId, cryptoApi);
    const recoveryKey = await deriveRecoveryWrappingKey(answers, recoverySalt, vaultId, cryptoApi);
    const passphraseEnvelope = await wrapMasterKey(masterBytes, passphraseMaterial.wrappingKey, PASS_KEY_AAD + vaultId, cryptoApi);
    const recoveryEnvelope = await wrapMasterKey(masterBytes, recoveryKey, RECOVERY_KEY_AAD + vaultId, cryptoApi);
    const encryptionKey = await cryptoApi.subtle.importKey(
      'raw', masterBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    return {
      username: usernameResult.normalized,
      vaultId,
      encryptionKey,
      writeToken: passphraseMaterial.writeToken,
      accountRecord: {
        username: usernameResult.normalized,
        vaultId,
        passphraseSalt: toBase64(passphraseSalt),
        passphraseIterations: VAULT_KDF_ITERATIONS,
        passphraseEnvelope,
        recoverySalt: toBase64(recoverySalt),
        recoveryIterations: RECOVERY_KDF_ITERATIONS,
        recoveryEnvelope,
        questionAnswers: answers.map(item => ({ questionId: Number(item.questionId), answer: item.answer }))
      }
    };
  } finally {
    masterBytes.fill(0);
    passphraseSalt.fill(0);
    recoverySalt.fill(0);
  }
}

export async function deriveVaultLoginMaterial(account, passphrase, cryptoApi = globalThis.crypto) {
  const passphraseResult = validateVaultPassphrase(passphrase);
  if (!passphraseResult.valid) throw new Error(passphraseResult.message);
  if (!account || !/^[a-f0-9]{64}$/.test(account.vaultId || '')
      || account.passphraseIterations !== VAULT_KDF_ITERATIONS) {
    throw new Error('The account information is invalid or uses an unsupported encryption version.');
  }
  const salt = fromBase64(account.passphraseSalt);
  if (salt.length !== 16) throw new Error('The account encryption settings are invalid.');
  const derived = await derivePassphraseMaterial(passphrase, salt, account.vaultId, cryptoApi);
  return {
    username: normalizeVaultUsername(account.username),
    vaultId: account.vaultId,
    wrappingKey: derived.wrappingKey,
    writeToken: derived.writeToken
  };
}

export async function finishVaultLogin(account, loginMaterial, passphraseEnvelope, cryptoApi = globalThis.crypto) {
  if (!account || !loginMaterial?.wrappingKey || loginMaterial.vaultId !== account.vaultId) {
    throw new TypeError('A verified account login is required.');
  }
  const masterBytes = await unwrapMasterKey(
    passphraseEnvelope, loginMaterial.wrappingKey, PASS_KEY_AAD + account.vaultId, cryptoApi
  );
  const encryptionKey = await cryptoApi.subtle.importKey(
    'raw', masterBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  masterBytes.fill(0);
  return {
    username: normalizeVaultUsername(account.username),
    vaultId: account.vaultId,
    encryptionKey,
    writeToken: loginMaterial.writeToken
  };
}

export async function deriveLegacyVaultCredentials(username, passphrase, cryptoApi = globalThis.crypto) {
  const usernameResult = validateVaultUsername(username);
  const passphraseResult = validateVaultPassphrase(passphrase);
  if (!usernameResult.valid) throw new Error('The username is not valid.');
  if (!passphraseResult.valid) throw new Error(passphraseResult.message);
  const usernameBytes = encoder.encode(usernameResult.normalized);
  const vaultIdBytes = await sha256(encoder.encode(LEGACY_VAULT_ID_DOMAIN + usernameResult.normalized), cryptoApi);
  const salt = await sha256(concatBytes(encoder.encode(LEGACY_VAULT_SALT_DOMAIN), usernameBytes), cryptoApi);
  const material = await cryptoApi.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveBits']
  );
  const derived = new Uint8Array(await cryptoApi.subtle.deriveBits({
    name: 'PBKDF2', salt, iterations: VAULT_KDF_ITERATIONS, hash: 'SHA-256'
  }, material, 512));
  const masterKeyBytes = derived.slice(0, 32);
  const writeToken = derived.slice(32, 64);
  const encryptionKey = await cryptoApi.subtle.importKey(
    'raw', masterKeyBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  const vaultId = bytesToHex(vaultIdBytes);
  derived.fill(0);
  salt.fill(0);
  return { username: usernameResult.normalized, vaultId, encryptionKey, masterKeyBytes, writeToken };
}

export async function createLegacyVaultUpgrade(username, passphrase, answers, legacyCredentials, cryptoApi = globalThis.crypto) {
  const usernameResult = validateVaultUsername(username);
  const passphraseResult = validateVaultPassphrase(passphrase, { creating: true });
  const answerResult = validateRecoveryAnswers(answers);
  if (!usernameResult.valid || !passphraseResult.valid || !answerResult.valid) {
    throw new Error(!usernameResult.valid ? 'The username is not valid.'
      : !passphraseResult.valid ? passphraseResult.message : answerResult.message);
  }
  if (!legacyCredentials || legacyCredentials.username !== usernameResult.normalized
      || !/^[a-f0-9]{64}$/.test(legacyCredentials.vaultId || '')
      || !(legacyCredentials.masterKeyBytes instanceof Uint8Array)
      || legacyCredentials.masterKeyBytes.length !== 32
      || !(legacyCredentials.writeToken instanceof Uint8Array)
      || legacyCredentials.writeToken.length !== 32) {
    throw new TypeError('A verified legacy account key is required.');
  }

  const masterBytes = legacyCredentials.masterKeyBytes.slice();
  const passphraseSalt = randomBytes(16, cryptoApi);
  const recoverySalt = randomBytes(16, cryptoApi);
  try {
    const passphraseMaterial = await derivePassphraseMaterial(passphrase, passphraseSalt, legacyCredentials.vaultId, cryptoApi);
    const recoveryKey = await deriveRecoveryWrappingKey(answers, recoverySalt, legacyCredentials.vaultId, cryptoApi);
    const passphraseEnvelope = await wrapMasterKey(
      masterBytes, passphraseMaterial.wrappingKey, PASS_KEY_AAD + legacyCredentials.vaultId, cryptoApi
    );
    const recoveryEnvelope = await wrapMasterKey(
      masterBytes, recoveryKey, RECOVERY_KEY_AAD + legacyCredentials.vaultId, cryptoApi
    );
    const encryptionKey = await cryptoApi.subtle.importKey(
      'raw', masterBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    return {
      username: usernameResult.normalized,
      vaultId: legacyCredentials.vaultId,
      encryptionKey,
      writeToken: passphraseMaterial.writeToken,
      legacyWriteToken: legacyCredentials.writeToken.slice(),
      accountRecord: {
        username: usernameResult.normalized,
        vaultId: legacyCredentials.vaultId,
        passphraseSalt: toBase64(passphraseSalt),
        passphraseIterations: VAULT_KDF_ITERATIONS,
        passphraseEnvelope,
        recoverySalt: toBase64(recoverySalt),
        recoveryIterations: RECOVERY_KDF_ITERATIONS,
        recoveryEnvelope,
        questionAnswers: answers.map(item => ({ questionId: Number(item.questionId), answer: item.answer }))
      }
    };
  } finally {
    masterBytes.fill(0);
    passphraseSalt.fill(0);
    recoverySalt.fill(0);
  }
}

export async function unlockVaultAccount(account, passphrase, cryptoApi = globalThis.crypto) {
  const loginMaterial = await deriveVaultLoginMaterial(account, passphrase, cryptoApi);
  try {
    return await finishVaultLogin(account, loginMaterial, account.passphraseEnvelope, cryptoApi);
  } catch (error) {
    wipeWriteToken(loginMaterial.writeToken);
    throw error;
  }
}

export async function recoverVaultMasterKey(account, answers, cryptoApi = globalThis.crypto) {
  const validation = validateRecoveryAnswers(answers);
  if (!validation.valid) throw new Error(validation.message);
  if (!account || !/^[a-f0-9]{64}$/.test(account.vaultId || '')
      || account.recoveryIterations !== RECOVERY_KDF_ITERATIONS) {
    throw new Error('The recovery information is invalid or uses an unsupported version.');
  }
  const salt = fromBase64(account.recoverySalt);
  if (salt.length !== 16) throw new Error('The recovery settings are invalid.');
  const recoveryKey = await deriveRecoveryWrappingKey(answers, salt, account.vaultId, cryptoApi);
  return unwrapMasterKey(account.recoveryEnvelope, recoveryKey, RECOVERY_KEY_AAD + account.vaultId, cryptoApi);
}

export async function prepareVaultPassphraseReset(account, masterBytes, newPassphrase, cryptoApi = globalThis.crypto) {
  const validation = validateVaultPassphrase(newPassphrase, { creating: true });
  if (!validation.valid) throw new Error(validation.message);
  if (!(masterBytes instanceof Uint8Array) || masterBytes.length !== 32) {
    throw new TypeError('A verified account master key is required.');
  }
  const passphraseSalt = randomBytes(16, cryptoApi);
  const passphraseSaltBase64 = toBase64(passphraseSalt);
  try {
    const derived = await derivePassphraseMaterial(newPassphrase, passphraseSalt, account.vaultId, cryptoApi);
    const passphraseEnvelope = await wrapMasterKey(
      masterBytes, derived.wrappingKey, PASS_KEY_AAD + account.vaultId, cryptoApi
    );
    const encryptionKey = await cryptoApi.subtle.importKey(
      'raw', masterBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    return {
      username: normalizeVaultUsername(account.username),
      vaultId: account.vaultId,
      encryptionKey,
      writeToken: derived.writeToken,
      passphraseSalt: passphraseSaltBase64,
      passphraseIterations: VAULT_KDF_ITERATIONS,
      passphraseEnvelope
    };
  } finally {
    passphraseSalt.fill(0);
  }
}

export function wipeWriteToken(token) {
  if (token instanceof Uint8Array) token.fill(0);
}

export async function encryptDailyBundle(bundle, encryptionKey, compressor, cryptoApi = globalThis.crypto) {
  if (!encryptionKey || !bundle || !isValidDateString(bundle.dateString)) {
    throw new TypeError('A valid daily bundle and unlocked account key are required.');
  }
  if (typeof compressor !== 'function') throw new TypeError('A daily packet compressor is required.');
  const serialized = JSON.stringify(bundle);
  const compressed = await compressor(serialized);
  const compression = compressed === serialized ? 'none' : 'gzip-base64';
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(PACKET_AAD_DOMAIN + bundle.dateString);
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    encryptionKey, encoder.encode(compressed)
  );
  return {
    format: VAULT_PACKET_FORMAT,
    version: VAULT_PACKET_VERSION,
    dateString: bundle.dateString,
    algorithm: 'AES-256-GCM',
    compression,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext))
  };
}

export async function decryptDailyBundle(packet, encryptionKey, decompressor, cryptoApi = globalThis.crypto) {
  if (!isValidEncryptedPacket(packet) || !encryptionKey) {
    throw new TypeError('The encrypted daily packet is invalid or the account is locked.');
  }
  if (typeof decompressor !== 'function') throw new TypeError('A daily packet decompressor is required.');
  let plaintext;
  try {
    const decrypted = await cryptoApi.subtle.decrypt({
      name: 'AES-GCM',
      iv: fromBase64(packet.iv),
      additionalData: encoder.encode(PACKET_AAD_DOMAIN + packet.dateString),
      tagLength: 128
    }, encryptionKey, fromBase64(packet.ciphertext));
    plaintext = new TextDecoder().decode(decrypted);
  } catch {
    throw new Error('This daily packet could not be decrypted with the current account credentials.');
  }
  const unpacked = packet.compression === 'gzip-base64'
    ? await decompressor(plaintext)
    : plaintext;
  let bundle;
  try { bundle = JSON.parse(unpacked); }
  catch { throw new Error('The decrypted daily packet is damaged.'); }
  if (!bundle || bundle.format !== 'faith-focus-daily-bundle' || bundle.version !== 1
      || bundle.dateString !== packet.dateString || !bundle.records
      || typeof bundle.records !== 'object' || Array.isArray(bundle.records)
      || !Array.isArray(bundle.voiceNotes)) {
    throw new Error('The decrypted daily bundle has an unsupported structure.');
  }
  return bundle;
}

export function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidEncryptedPacket(packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return false;
  if (packet.format !== VAULT_PACKET_FORMAT || packet.version !== VAULT_PACKET_VERSION
      || packet.algorithm !== 'AES-256-GCM'
      || !['none', 'gzip-base64'].includes(packet.compression)
      || !isValidDateString(packet.dateString)
      || typeof packet.iv !== 'string' || typeof packet.ciphertext !== 'string') return false;
  try {
    return fromBase64(packet.iv).length === 12 && fromBase64(packet.ciphertext).length >= 16;
  } catch {
    return false;
  }
}

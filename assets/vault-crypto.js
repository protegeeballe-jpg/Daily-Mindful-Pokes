/**
 * Shared account cryptography for Faith & Focus: Daily Armor.
 * Usernames are public identifiers; passphrases are the only user secret.
 */
export const VAULT_KDF_ITERATIONS = 600000;
export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_PASSPHRASE_LENGTH = 128;
export const VAULT_PACKET_FORMAT = 'faith-focus-encrypted-daily-packet';
export const VAULT_PACKET_VERSION = 1;
const encoder = new TextEncoder();
const VAULT_ID_DOMAIN = 'FaithFocus|VaultID|v1|';
const VAULT_SALT_DOMAIN = 'FaithFocus|PBKDF2-Salt|v1|';
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

async function sha256(bytes, cryptoApi = globalThis.crypto) {
  return new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
}

export async function deriveVaultCredentials(username, passphrase, cryptoApi = globalThis.crypto) {
  const usernameResult = validateVaultUsername(username);
  const passphraseResult = validateVaultPassphrase(passphrase);
  if (!usernameResult.valid) throw new Error('Use a 3–32 character username with letters, numbers, dots, underscores, or hyphens.');
  if (!passphraseResult.valid) throw new Error(passphraseResult.message);
  if (!cryptoApi?.subtle || !cryptoApi?.getRandomValues) throw new Error('Secure browser cryptography is unavailable. Open the app over HTTPS.');

  const normalizedUsername = usernameResult.normalized;
  const usernameBytes = encoder.encode(normalizedUsername);
  const vaultIdBytes = await sha256(encoder.encode(VAULT_ID_DOMAIN + normalizedUsername), cryptoApi);
  const salt = await sha256(concatBytes(encoder.encode(VAULT_SALT_DOMAIN), usernameBytes), cryptoApi);
  const material = await cryptoApi.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveBits']
  );
  const derived = new Uint8Array(await cryptoApi.subtle.deriveBits({
    name: 'PBKDF2', salt, iterations: VAULT_KDF_ITERATIONS, hash: 'SHA-256'
  }, material, 512));

  const encryptionMaterial = derived.slice(0, 32);
  const writeToken = derived.slice(32, 64);
  const encryptionKey = await cryptoApi.subtle.importKey(
    'raw', encryptionMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  derived.fill(0);
  encryptionMaterial.fill(0);
  salt.fill(0);

  return {
    username: normalizedUsername,
    vaultId: Array.from(vaultIdBytes, byte => byte.toString(16).padStart(2, '0')).join(''),
    encryptionKey,
    writeToken
  };
}

function concatBytes(left, right) {
  const result = new Uint8Array(left.length + right.length);
  result.set(left, 0);
  result.set(right, left.length);
  return result;
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

export function wipeWriteToken(token) {
  if (token instanceof Uint8Array) token.fill(0);
}

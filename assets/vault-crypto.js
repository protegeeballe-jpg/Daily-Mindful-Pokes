/**
 * Unified account cryptography.
 * A random 64-byte master secret is wrapped separately by the passphrase and
 * the three-answer recovery credential. The first half encrypts daily packets;
 * the second half remains a stable vault write credential across username or
 * passphrase changes.
 */
export const VAULT_KDF_ITERATIONS = 600000;
export const RECOVERY_KDF_ITERATIONS = 900000;
export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_PASSPHRASE_LENGTH = 128;
export const MAX_SECURITY_ANSWER_LENGTH = 64;
export const VAULT_PACKET_FORMAT = 'faith-focus-encrypted-daily-packet';
export const VAULT_PACKET_VERSION = 1;

const encoder = new TextEncoder();
const LEGACY_VAULT_ID_DOMAIN = 'FaithFocus|VaultID|v1|';
const LEGACY_VAULT_SALT_DOMAIN = 'FaithFocus|PBKDF2-Salt|v1|';
const PASSWORD_AAD = encoder.encode('FaithFocus|AccountMasterKey|PasswordWrap|v1');
const RECOVERY_AAD = encoder.encode('FaithFocus|AccountMasterKey|RecoveryWrap|v1');
const PACKET_AAD_DOMAIN = 'Faith & Focus|Vault Daily Packet|v1|';

export const SECURITY_QUESTIONS = Object.freeze([
  'What is the name of your first pet?',
  'What is your favorite food?',
  'What is the nickname of your favorite neighbor?',
  'What is the brand of your favorite shirt?',
  'What is your favorite part of your house?',
  'What was the nickname you hated most in school?',
  'What is the longest amount of time you have ever stayed awake?',
  'What was the first video game or board game you ever beat someone at?',
  'What is a song that instantly reminds you of a specific road trip or vacation?',
  'What was the first name of your very first childhood crush?',
  'What was the color of the first watch you ever owned?',
  'What is the one household chore you despised?',
  'What was the name of your favorite cartoon character?',
  'What was the first foreign language you ever tried to learn?',
  'What is the title of your favorite song?',
  'What is the one food item you cannot eat?',
  'How many times do you take a bath in a week?',
  'What is the Country you love to visit?',
  'What is the title of the first movie you watched?',
  'What is your favorite music intrument?'
]);

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

export function validateVaultPassphrase(value) {
  const passphrase = typeof value === 'string' ? value : '';
  if (passphrase.length > MAX_PASSPHRASE_LENGTH) {
    return { valid: false, message: 'Passphrases must be 128 characters or fewer.' };
  }
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return { valid: false, message: 'Choose a passphrase with at least 12 characters.' };
  }
  return { valid: true, message: '' };
}

export function validateSecurityAnswer(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SECURITY_ANSWER_LENGTH) {
    return { valid: false, message: 'Enter one word of up to 64 characters.' };
  }
  if (value.trim() !== value || /\s/u.test(value)) {
    return { valid: false, message: 'Answers must be one word with no spaces.' };
  }
  return { valid: true, message: '' };
}

export function validateSecuritySetup(questionIds, answers) {
  if (!Array.isArray(questionIds) || !Array.isArray(answers)
      || questionIds.length !== 3 || answers.length !== 3) {
    return { valid: false, message: 'Choose and answer exactly three security questions.' };
  }
  const ids = questionIds.map(Number);
  if (ids.some(id => !Number.isInteger(id) || id < 1 || id > SECURITY_QUESTIONS.length)
      || new Set(ids).size !== 3) {
    return { valid: false, message: 'Choose three different security questions.' };
  }
  for (const answer of answers) {
    const result = validateSecurityAnswer(answer);
    if (!result.valid) return result;
  }
  return { valid: true, message: '' };
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new TypeError('Invalid encrypted account data.');
  }
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function encodeBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new TypeError('Invalid vault write credential.');
  }
  return base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/') + '=');
}

async function sha256(bytes, cryptoApi = globalThis.crypto) {
  return new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
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

async function deriveWrappingKey(secret, salt, iterations, cryptoApi = globalThis.crypto) {
  const material = await cryptoApi.subtle.importKey(
    'raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']
  );
  return cryptoApi.subtle.deriveKey({
    name: 'PBKDF2', salt, iterations, hash: 'SHA-256'
  }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function validateEnvelope(envelope, expectedIterations) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM'
      || envelope.kdf !== 'PBKDF2-HMAC-SHA-256'
      || envelope.iterations !== expectedIterations) {
    throw new TypeError('This account uses an unsupported key envelope.');
  }
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length !== 80) {
    throw new TypeError('The encrypted account key is incomplete or damaged.');
  }
  return { salt, iv, ciphertext };
}

export async function wrapMasterKeyWithPassphrase(masterKeyBytes, passphrase, cryptoApi = globalThis.crypto) {
  const passphraseResult = validateVaultPassphrase(passphrase);
  if (!passphraseResult.valid) throw new Error(passphraseResult.message);
  if (!(masterKeyBytes instanceof Uint8Array) || masterKeyBytes.length !== 64) {
    throw new TypeError('The account master key must contain 64 bytes.');
  }
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const key = await deriveWrappingKey(passphrase, salt, VAULT_KDF_ITERATIONS, cryptoApi);
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: PASSWORD_AAD, tagLength: 128 },
    key, masterKeyBytes
  );
  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-HMAC-SHA-256',
    iterations: VAULT_KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

export async function unwrapMasterKeyWithPassphrase(envelope, passphrase, cryptoApi = globalThis.crypto) {
  const passphraseResult = validateVaultPassphrase(passphrase);
  if (!passphraseResult.valid) throw new Error(passphraseResult.message);
  const { salt, iv, ciphertext } = validateEnvelope(envelope, VAULT_KDF_ITERATIONS);
  const key = await deriveWrappingKey(passphrase, salt, VAULT_KDF_ITERATIONS, cryptoApi);
  try {
    const raw = new Uint8Array(await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: PASSWORD_AAD, tagLength: 128 },
      key, ciphertext
    ));
    if (raw.length !== 64) throw new Error('Invalid account master key length.');
    return raw;
  } catch {
    throw new Error('The username or passphrase was not accepted.');
  }
}

function canonicalRecoverySecret(questionIds, answers) {
  const validation = validateSecuritySetup(questionIds, answers);
  if (!validation.valid) throw new Error(validation.message);
  const pairs = questionIds.map((id, index) => ({ id: Number(id), answer: answers[index] }))
    .sort((left, right) => left.id - right.id);
  return JSON.stringify(pairs);
}

export async function wrapMasterKeyWithRecovery(masterKeyBytes, questionIds, answers, cryptoApi = globalThis.crypto) {
  if (!(masterKeyBytes instanceof Uint8Array) || masterKeyBytes.length !== 64) {
    throw new TypeError('The account master key must contain 64 bytes.');
  }
  const recoverySecret = canonicalRecoverySecret(questionIds, answers);
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const key = await deriveWrappingKey(recoverySecret, salt, RECOVERY_KDF_ITERATIONS, cryptoApi);
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: RECOVERY_AAD, tagLength: 128 },
    key, masterKeyBytes
  );
  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-HMAC-SHA-256',
    iterations: RECOVERY_KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

export async function unwrapMasterKeyWithRecovery(envelope, questionIds, answers, cryptoApi = globalThis.crypto) {
  const recoverySecret = canonicalRecoverySecret(questionIds, answers);
  const { salt, iv, ciphertext } = validateEnvelope(envelope, RECOVERY_KDF_ITERATIONS);
  const key = await deriveWrappingKey(recoverySecret, salt, RECOVERY_KDF_ITERATIONS, cryptoApi);
  try {
    const raw = new Uint8Array(await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: RECOVERY_AAD, tagLength: 128 },
      key, ciphertext
    ));
    if (raw.length !== 64) throw new Error('Invalid account master key length.');
    return raw;
  } catch {
    throw new Error('The three answers could not unlock this account. Check the selected questions and spelling, including capitalization.');
  }
}

export async function deriveVaultCredentialsFromMaster(vaultId, masterKeyBytes, username = '', cryptoApi = globalThis.crypto) {
  if (typeof vaultId !== 'string' || !/^[a-f0-9]{64}$/.test(vaultId)) {
    throw new TypeError('The permanent Vault ID is invalid.');
  }
  if (!(masterKeyBytes instanceof Uint8Array) || masterKeyBytes.length !== 64) {
    throw new TypeError('The account master key must contain 64 bytes.');
  }
  const encryptionKey = await cryptoApi.subtle.importKey(
    'raw', masterKeyBytes.slice(0, 32), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  return {
    username: normalizeVaultUsername(username),
    vaultId,
    encryptionKey,
    writeToken: masterKeyBytes.slice(32, 64),
    masterKeyBytes: masterKeyBytes.slice()
  };
}

export function createVaultId(cryptoApi = globalThis.crypto) {
  return bytesToHex(cryptoApi.getRandomValues(new Uint8Array(32)));
}

export async function createNewVaultAccount(username, passphrase, questionIds, answers, cryptoApi = globalThis.crypto) {
  const usernameResult = validateVaultUsername(username);
  if (!usernameResult.valid) throw new Error('Use a 3–32 character username with letters, numbers, dots, underscores, or hyphens.');
  const passphraseResult = validateVaultPassphrase(passphrase);
  if (!passphraseResult.valid) throw new Error(passphraseResult.message);
  const securityResult = validateSecuritySetup(questionIds, answers);
  if (!securityResult.valid) throw new Error(securityResult.message);

  const vaultId = createVaultId(cryptoApi);
  const masterKeyBytes = cryptoApi.getRandomValues(new Uint8Array(64));
  const passphraseEnvelope = await wrapMasterKeyWithPassphrase(masterKeyBytes, passphrase, cryptoApi);
  const recoveryEnvelope = await wrapMasterKeyWithRecovery(masterKeyBytes, questionIds, answers, cryptoApi);
  const credentials = await deriveVaultCredentialsFromMaster(vaultId, masterKeyBytes, usernameResult.normalized, cryptoApi);
  masterKeyBytes.fill(0);
  return { ...credentials, passphraseEnvelope, recoveryEnvelope, questionIds: questionIds.map(Number) };
}

/**
 * Compatibility helper for accounts created before permanent Vault IDs existed.
 * It reproduces the previous PBKDF2 split and deterministic ID exactly so
 * existing encrypted packets remain readable during account enrollment.
 */
export async function deriveLegacyVaultCredentials(username, passphrase, cryptoApi = globalThis.crypto) {
  const usernameResult = validateVaultUsername(username);
  const passphraseResult = validateVaultPassphrase(passphrase);
  if (!usernameResult.valid) throw new Error('Use a valid 3–32 character username.');
  if (!passphraseResult.valid) throw new Error(passphraseResult.message);
  const usernameBytes = encoder.encode(usernameResult.normalized);
  const vaultIdBytes = await sha256(encoder.encode(LEGACY_VAULT_ID_DOMAIN + usernameResult.normalized), cryptoApi);
  const salt = await sha256(concatBytes(encoder.encode(LEGACY_VAULT_SALT_DOMAIN), usernameBytes), cryptoApi);
  const material = await cryptoApi.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveBits']
  );
  const masterKeyBytes = new Uint8Array(await cryptoApi.subtle.deriveBits({
    name: 'PBKDF2', salt, iterations: VAULT_KDF_ITERATIONS, hash: 'SHA-256'
  }, material, 512));
  salt.fill(0);
  const vaultId = bytesToHex(vaultIdBytes);
  const credentials = await deriveVaultCredentialsFromMaster(vaultId, masterKeyBytes, usernameResult.normalized, cryptoApi);
  masterKeyBytes.fill(0);
  credentials.legacy = true;
  return credentials;
}

export async function unlockVaultAccount(username, passphrase, vaultId, passphraseEnvelope, cryptoApi = globalThis.crypto) {
  const masterKeyBytes = await unwrapMasterKeyWithPassphrase(passphraseEnvelope, passphrase, cryptoApi);
  return deriveVaultCredentialsFromMaster(vaultId, masterKeyBytes, username, cryptoApi);
}

export async function createPassphraseEnvelope(masterKeyBytes, passphrase, cryptoApi = globalThis.crypto) {
  return wrapMasterKeyWithPassphrase(masterKeyBytes, passphrase, cryptoApi);
}

export function wipeVaultCredentials(credentials) {
  if (!credentials || typeof credentials !== 'object') return;
  if (credentials.writeToken instanceof Uint8Array) credentials.writeToken.fill(0);
  if (credentials.masterKeyBytes instanceof Uint8Array) credentials.masterKeyBytes.fill(0);
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
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
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
      iv: base64ToBytes(packet.iv),
      additionalData: encoder.encode(PACKET_AAD_DOMAIN + packet.dateString),
      tagLength: 128
    }, encryptionKey, base64ToBytes(packet.ciphertext));
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
    return base64ToBytes(packet.iv).length === 12 && base64ToBytes(packet.ciphertext).length >= 16;
  } catch {
    return false;
  }
}

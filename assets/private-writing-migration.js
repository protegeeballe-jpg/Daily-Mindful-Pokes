export async function isRecordReadableWithKey(record, decryptWithKey) {
    if (typeof decryptWithKey !== 'function') {
        throw new TypeError('A record decryption function is required.');
    }
    try {
        await decryptWithKey(record);
        return true;
    } catch {
        return false;
    }
}

export async function migrateRecordToTargetKey(record, {
    decryptTarget,
    decryptLegacy,
    encryptTarget
} = {}) {
    if (typeof decryptTarget !== 'function'
        || typeof decryptLegacy !== 'function'
        || typeof encryptTarget !== 'function') {
        throw new TypeError('Target-key and legacy-key migration functions are required.');
    }

    // Some restored records may already use the account key. Keep their exact
    // ciphertext; only convert records that still require the previous key.
    if (await isRecordReadableWithKey(record, decryptTarget)) return record;

    const plaintext = await decryptLegacy(record);
    return encryptTarget(plaintext);
}

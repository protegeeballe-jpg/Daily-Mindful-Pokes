import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isRecordReadableWithKey,
    migrateRecordToTargetKey
} from '../assets/private-writing-migration.js';

function codec(key) {
    return {
        encrypt: async value => JSON.stringify({ key, value }),
        decrypt: async record => {
            const parsed = JSON.parse(record);
            if (parsed.key !== key) throw new Error('Wrong encryption key.');
            return parsed.value;
        }
    };
}

test('records already encrypted with the account key are kept byte-for-byte', async () => {
    const account = codec('account-key');
    const legacy = codec('legacy-key');
    const original = await account.encrypt({ diary: 'already migrated' });
    let legacyDecryptCalled = false;

    const migrated = await migrateRecordToTargetKey(original, {
        decryptTarget: account.decrypt,
        decryptLegacy: async record => {
            legacyDecryptCalled = true;
            return legacy.decrypt(record);
        },
        encryptTarget: account.encrypt
    });

    assert.equal(migrated, original);
    assert.equal(legacyDecryptCalled, false);
    assert.equal(await account.decrypt(migrated).then(value => value.diary), 'already migrated');
});

test('legacy records are converted to the account key', async () => {
    const account = codec('account-key');
    const legacy = codec('legacy-key');
    const original = await legacy.encrypt({ diary: 'keep this entry' });

    const migrated = await migrateRecordToTargetKey(original, {
        decryptTarget: account.decrypt,
        decryptLegacy: legacy.decrypt,
        encryptTarget: account.encrypt
    });

    assert.notEqual(migrated, original);
    assert.deepEqual(await account.decrypt(migrated), { diary: 'keep this entry' });
    await assert.rejects(() => legacy.decrypt(migrated), /Wrong encryption key/);
});

test('records that neither key can decrypt are rejected without producing replacement data', async () => {
    const account = codec('account-key');
    const legacy = codec('legacy-key');
    const unknown = JSON.stringify({ key: 'unknown-key', value: 'unreadable' });
    let encryptCalled = false;

    await assert.rejects(() => migrateRecordToTargetKey(unknown, {
        decryptTarget: account.decrypt,
        decryptLegacy: legacy.decrypt,
        encryptTarget: async value => {
            encryptCalled = true;
            return account.encrypt(value);
        }
    }), /Wrong encryption key/);

    assert.equal(encryptCalled, false);
});

test('key classification reports readable and unreadable records without modifying them', async () => {
    const account = codec('account-key');
    const legacy = codec('legacy-key');
    const current = await account.encrypt('current');
    const previous = await legacy.encrypt('previous');

    assert.equal(await isRecordReadableWithKey(current, account.decrypt), true);
    assert.equal(await isRecordReadableWithKey(previous, account.decrypt), false);
    assert.equal(previous, await legacy.encrypt('previous'));
});

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {changePassphrase, createVault, open, openVault, seal} from './vault.js';

const crypto = globalThis.crypto;
const ITERATIONS = 1000;
const META = {name: 'Home', currency: 'INR', decimals: 2, created: '2026-11-15'};
const PATH = 'devices/01JB0000000000000000000000/00000001.bin';

const newVault = () => createVault({crypto, passphrase: 'correct horse', meta: META, iterations: ITERATIONS});

test('a new vault opens with its passphrase and gives back the meta', async () => {
    const {vaultText, key} = await newVault();
    assert.equal(key.extractable, false);
    const vault = JSON.parse(vaultText);
    assert.deepEqual([vault.format, vault.kdf.name, vault.kdf.iterations], [1, 'PBKDF2-SHA256', ITERATIONS]);
    assert.ok(!vaultText.includes('INR') && !vaultText.includes('Home'), 'the meta is encrypted');

    const opened = await openVault({crypto, passphrase: 'correct horse', vaultText});
    assert.deepEqual(opened.meta, META);
    assert.equal(opened.key.extractable, false);
    assert.equal(await open(crypto, opened.key, PATH, await seal(crypto, key, PATH, 'hello')), 'hello');
});

test('a wrong passphrase is refused', async () => {
    const {vaultText} = await newVault();
    await assert.rejects(openVault({crypto, passphrase: 'wrong horse', vaultText}), /Wrong passphrase/);
});

test('short passphrases and broken vault files are refused', async () => {
    await assert.rejects(createVault({crypto, passphrase: 'short', meta: META, iterations: ITERATIONS}), /at least 8/);
    await assert.rejects(openVault({crypto, passphrase: 'x', vaultText: 'not json'}), /not valid JSON/);
    await assert.rejects(openVault({crypto, passphrase: 'x', vaultText: '{"format":2}'}), /unknown format/);
});

test('sealed files round-trip, and tampering or moving them is detected', async () => {
    const {key} = await newVault();
    const text = '{"kind":"txn"}\n{"kind":"category"}\n';
    const bytes = await seal(crypto, key, PATH, text);
    assert.equal(bytes[0], 1);
    assert.equal(await open(crypto, key, PATH, bytes), text);

    const flipped = bytes.slice();
    flipped[flipped.length - 1] ^= 1;
    await assert.rejects(open(crypto, key, PATH, flipped), /could not be decrypted/);
    await assert.rejects(open(crypto, key, PATH.replace('00000001', '00000002'), bytes), /could not be decrypted/);
    await assert.rejects(open(crypto, key, PATH, bytes.subarray(0, 5)), /unknown format/);
    await assert.rejects(open(crypto, key, PATH, Uint8Array.of(2, ...bytes.subarray(1))), /unknown format/);

    const other = await newVault();
    await assert.rejects(open(crypto, other.key, PATH, bytes), /could not be decrypted/);
});

test('two seals of the same text differ (random nonce)', async () => {
    const {key} = await newVault();
    const a = await seal(crypto, key, PATH, 'same');
    const b = await seal(crypto, key, PATH, 'same');
    assert.notDeepEqual(a, b);
});

test('changing the passphrase keeps the data key and the meta', async () => {
    const {vaultText, key} = await newVault();
    const bytes = await seal(crypto, key, PATH, 'kept');
    const changed = await changePassphrase({
        crypto,
        oldPassphrase: 'correct horse',
        newPassphrase: 'battery staple',
        vaultText,
        iterations: ITERATIONS,
    });
    await assert.rejects(openVault({crypto, passphrase: 'correct horse', vaultText: changed}), /Wrong passphrase/);
    const opened = await openVault({crypto, passphrase: 'battery staple', vaultText: changed});
    assert.deepEqual(opened.meta, META);
    assert.equal(await open(crypto, opened.key, PATH, bytes), 'kept');
    await assert.rejects(
        changePassphrase({crypto, oldPassphrase: 'nope nope', newPassphrase: 'battery staple', vaultText, iterations: ITERATIONS}),
        /Wrong passphrase/,
    );
});

// vault.json holds the data key, wrapped with a key derived from the passphrase, and the encrypted
// project meta. Every log file is sealed with the data key, using its repo path as additional data.

import {fromBase64, fromUtf8, toBase64, utf8} from './bytes.js';

const DEFAULT_ITERATIONS = 600000;
const FORMAT = 1;
const FILE_VERSION = 1;
const NONCE_BYTES = 12;
const META_PATH = 'vault.json#meta';
const DATA_KEY = {name: 'AES-GCM', length: 256};

async function deriveWrappingKey(crypto, passphrase, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations, hash: 'SHA-256'}, base, {name: 'AES-KW', length: 256}, false, [
        'wrapKey',
        'unwrapKey',
    ]);
}

function unwrap(crypto, wrapped, wrappingKey, extractable) {
    return crypto.subtle.unwrapKey('raw', wrapped, wrappingKey, 'AES-KW', DATA_KEY, extractable, ['encrypt', 'decrypt']);
}

async function vaultText(crypto, dataKey, passphrase, iterations, sealedMeta) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const wrappingKey = await deriveWrappingKey(crypto, passphrase, salt, iterations);
    const wrapped = new Uint8Array(await crypto.subtle.wrapKey('raw', dataKey, wrappingKey, 'AES-KW'));
    const vault = {
        format: FORMAT,
        kdf: {name: 'PBKDF2-SHA256', iterations, salt: toBase64(salt)},
        wrappedKey: toBase64(wrapped),
        meta: toBase64(sealedMeta),
    };
    return {text: `${JSON.stringify(vault, null, 2)}\n`, wrapped, wrappingKey};
}

function parseVault(text) {
    let vault;
    try {
        vault = JSON.parse(text);
    } catch {
        throw new Error('vault.json is not valid JSON');
    }
    if (vault?.format !== FORMAT || vault.kdf?.name !== 'PBKDF2-SHA256') {
        throw new Error('vault.json has an unknown format');
    }
    return vault;
}

async function unlock(crypto, passphrase, vault, extractable) {
    const wrappingKey = await deriveWrappingKey(crypto, passphrase, fromBase64(vault.kdf.salt), vault.kdf.iterations);
    try {
        return await unwrap(crypto, fromBase64(vault.wrappedKey), wrappingKey, extractable);
    } catch {
        throw new Error('Wrong passphrase');
    }
}

/** A new vault for the meta. The returned key cannot be read back out of WebCrypto. */
export async function createVault({crypto, passphrase, meta, iterations = DEFAULT_ITERATIONS}) {
    if (passphrase.length < 8) {
        throw new Error('Use a passphrase of at least 8 characters');
    }
    const dataKey = await crypto.subtle.generateKey(DATA_KEY, true, ['encrypt', 'decrypt']);
    const sealedMeta = await seal(crypto, dataKey, META_PATH, JSON.stringify(meta));
    const {text, wrapped, wrappingKey} = await vaultText(crypto, dataKey, passphrase, iterations, sealedMeta);
    return {vaultText: text, key: await unwrap(crypto, wrapped, wrappingKey, false)};
}

/** The data key and meta of an existing vault. Throws "Wrong passphrase" when it doesn't fit. */
export async function openVault({crypto, passphrase, vaultText: text}) {
    const vault = parseVault(text);
    const key = await unlock(crypto, passphrase, vault, false);
    const meta = JSON.parse(await open(crypto, key, META_PATH, fromBase64(vault.meta)));
    return {key, meta};
}

/** vault.json re-wrapped for a new passphrase. The data key and all log files stay as they are. */
export async function changePassphrase({crypto, oldPassphrase, newPassphrase, vaultText: text, iterations = DEFAULT_ITERATIONS}) {
    if (newPassphrase.length < 8) {
        throw new Error('Use a passphrase of at least 8 characters');
    }
    const vault = parseVault(text);
    const dataKey = await unlock(crypto, oldPassphrase, vault, true);
    return (await vaultText(crypto, dataKey, newPassphrase, iterations, fromBase64(vault.meta))).text;
}

/** version byte, random nonce, AES-GCM ciphertext; the path is bound in as additional data. */
export async function seal(crypto, key, path, text) {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce, additionalData: utf8(path)}, key, utf8(text)),
    );
    const bytes = new Uint8Array(1 + NONCE_BYTES + ciphertext.length);
    bytes[0] = FILE_VERSION;
    bytes.set(nonce, 1);
    bytes.set(ciphertext, 1 + NONCE_BYTES);
    return bytes;
}

export async function open(crypto, key, path, bytes) {
    if (bytes.length < 1 + NONCE_BYTES || bytes[0] !== FILE_VERSION) {
        throw new Error(`${path} has an unknown format`);
    }
    try {
        const plain = await crypto.subtle.decrypt(
            {name: 'AES-GCM', iv: bytes.subarray(1, 1 + NONCE_BYTES), additionalData: utf8(path)},
            key,
            bytes.subarray(1 + NONCE_BYTES),
        );
        return fromUtf8(new Uint8Array(plain));
    } catch {
        throw new Error(`${path} could not be decrypted: it was changed, moved, or sealed with another key`);
    }
}

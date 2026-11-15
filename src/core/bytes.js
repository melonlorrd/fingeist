const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

export function utf8(text) {
    return encoder.encode(text);
}

export function fromUtf8(bytes) {
    return decoder.decode(bytes);
}

export function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

export function fromBase64(text) {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

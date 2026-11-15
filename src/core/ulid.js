const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID: 10 characters of millisecond time, then 16 of randomness from random(n) bytes. */
export function ulid(nowMs, random) {
    let time = '';
    let ms = nowMs;
    for (let i = 0; i < 10; i++) {
        time = ALPHABET[ms % 32] + time;
        ms = Math.floor(ms / 32);
    }
    const bytes = random(16);
    let rest = '';
    for (let i = 0; i < 16; i++) {
        rest += ALPHABET[bytes[i] % 32];
    }
    return time + rest;
}

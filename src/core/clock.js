// Hybrid logical clock: "<unix ms, 13 digits>-<counter, 4 digits>". Plain string comparison orders it.

const CLOCK = /^(\d{13})-(\d{4})$/;
export const ZERO_CLOCK = '0000000000000-0000';

export function isClock(text) {
    return CLOCK.test(String(text));
}

function parts(clock) {
    const m = CLOCK.exec(clock);
    if (!m) {
        throw new Error(`invalid clock "${clock}"`);
    }
    return [Number(m[1]), Number(m[2])];
}

function format(ms, counter) {
    return `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}`;
}

/** The clock for a new local change: after both the last clock seen and the wall clock. */
export function nextClock(last, nowMs) {
    const [ms, counter] = parts(last);
    if (nowMs > ms) {
        return format(nowMs, 0);
    }
    if (counter === 9999) {
        return format(ms + 1, 0);
    }
    return format(ms, counter + 1);
}

export function laterClock(a, b) {
    return a > b ? a : b;
}

// The device's wall clock and time zone, in the shape core/app.js expects.

import {offsetText} from '../core/time.js';

const pad = (n) => String(n).padStart(2, '0');

export const deviceClock = {
    now() {
        const d = new Date();
        return {
            ms: d.getTime(),
            date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
            clock: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
            offset: offsetText(-d.getTimezoneOffset()),
        };
    },
    /** The device's offset at that local date and time, so a past date gets its own summer or winter time. */
    offsetAt(date, clock) {
        const [y, m, day] = date.split('-').map(Number);
        const [h, min] = clock.split(':').map(Number);
        return offsetText(-new Date(y, m - 1, day, h, min).getTimezoneOffset());
    },
};

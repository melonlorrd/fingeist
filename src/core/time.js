// Times are stored as RFC 3339 with offset, or as a bare date meaning "time unknown". The date, hour
// and weekday of a row come from its own text, never from converting it to the device's zone.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;
const CLOCK = /^(\d{2}):(\d{2})$/;
const DAY_MS = 86400000;

/** Splits a stored time into its wall-clock parts. Throws on anything else. */
export function parseWhen(text) {
    if (isDate(text)) {
        return {time: text, date: text, hour: null, minute: null, unknown: true, instant: null};
    }
    const m = STAMP.exec(String(text));
    const [year, month, day, hour, minute, second] = m ? m.slice(1, 7).map(Number) : [];
    const offsetMinutes = m && m[8] !== 'Z' ? (m[9] === '-' ? -1 : 1) * (Number(m[10]) * 60 + Number(m[11])) : 0;
    if (!m || !validDay(year, month, day) || hour > 23 || minute > 59 || second > 59 || Math.abs(offsetMinutes) >= 24 * 60) {
        throw new Error(`invalid time "${text}": use 2026-11-07T14:30:00+05:30 or 2026-11-07`);
    }
    const fractionMs = m[7] ? Number(m[7].slice(1, 4).padEnd(3, '0')) : 0;
    return {
        time: text,
        date: text.slice(0, 10),
        hour,
        minute,
        unknown: false,
        instant: Date.UTC(year, month - 1, day, hour, minute, second, fractionMs) - offsetMinutes * 60000,
    };
}

export function isDate(text) {
    const m = DATE.exec(String(text));
    return m !== null && validDay(Number(m[1]), Number(m[2]), Number(m[3]));
}

function validDay(year, month, day) {
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toDays(date) {
    return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
}

function fromDays(days) {
    return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date, n) {
    return fromDays(toDays(date) + n);
}

/** Days from a to b; negative when b is before a. */
export function daysBetween(a, b) {
    return toDays(b) - toDays(a);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date) {
    return ((toDays(date) % 7) + 11) % 7;
}

/** 0 = Monday … 6 = Sunday. */
export function mondayFirst(weekday) {
    return (weekday + 6) % 7;
}

export function monthOf(date) {
    return date.slice(0, 7);
}

/** "2026-11" moved by n months. */
export function addMonths(month, n) {
    const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
    return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** "+05:30" for minutes east of UTC. */
export function offsetText(minutesEast) {
    const sign = minutesEast < 0 ? '-' : '+';
    const abs = Math.abs(minutesEast);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** A stored time from a date, an "HH:MM" clock and an offset such as "+05:30". */
export function stamp(date, clock, offset) {
    const m = CLOCK.exec(clock);
    if (!isDate(date) || !m || Number(m[1]) > 23 || Number(m[2]) > 59) {
        throw new Error(`invalid date or time "${date} ${clock}"`);
    }
    return `${date}T${clock}:00${offset}`;
}

/** The month a date belongs to when months start on startDay (1 to 28), e.g. a salary cycle. */
export function cycleOf(date, startDay = 1) {
    const month = monthOf(date);
    return Number(date.slice(8, 10)) >= startDay ? month : addMonths(month, -1);
}

/** The first day of a cycle month. */
export function cycleStart(month, startDay = 1) {
    return `${month}-${String(startDay).padStart(2, '0')}`;
}

/** The last day of a cycle month. */
export function cycleEnd(month, startDay = 1) {
    return addDays(cycleStart(addMonths(month, 1), startDay), -1);
}

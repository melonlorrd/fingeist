// Fingeist's own line icons: 24px grid, round 1.8px strokes in the current text colour.
const PATHS = {
    dashboard: ['M5 20v-8', 'M12 20V5', 'M19 20v-5', 'M3 20h18'],
    ledger: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6h1', 'M4 12h1', 'M4 18h1'],
    accounts: ['M3.5 8.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z', 'M6 6.5l9.5-3 1 3', 'M15.5 13h2'],
    categories: [
        'M3.5 4.5a1 1 0 0 1 1-1h7.2a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-7.2 7.2a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7z',
        'M8.5 7a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3',
    ],
    settings: ['M4 7h9', 'M17 7h3', 'M15 4.5v5', 'M4 17h3', 'M11 17h9', 'M9 14.5v5'],
    plus: ['M12 5v14', 'M5 12h14'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    previous: ['M15 6l-6 6 6 6'],
    next: ['M9 6l6 6-6 6'],
};

const SVG = 'http://www.w3.org/2000/svg';

/** A decorative icon; the button or label next to it carries the accessible name. */
export function icon(name) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of PATHS[name]) {
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('d', d);
        svg.append(path);
    }
    return svg;
}

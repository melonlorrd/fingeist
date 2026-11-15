import {readFileSync} from 'node:fs';

import {defineConfig} from 'vite';

// The sync hosts the app may talk to; the Content-Security-Policy in index.html allows only these.
const syncHosts = JSON.parse(readFileSync(new URL('./src/sync-hosts.json', import.meta.url), 'utf8'));

export default defineConfig({
    base: './',
    plugins: [
        {
            name: 'sync-hosts-csp',
            transformIndexHtml: (html) => html.replace('%SYNC_HOSTS%', syncHosts.join(' ')),
        },
    ],
    // One bundle on purpose: the service worker caches exactly what index.html references.
    build: {chunkSizeWarningLimit: 800},
    server: {host: '127.0.0.1', port: 5173},
});

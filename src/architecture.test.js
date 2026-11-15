// The rules in AGENTS.md that code review alone would miss, checked against the source text.

import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {test} from 'node:test';

const SRC = new URL('.', import.meta.url).pathname;

function sources(dir) {
    return readdirSync(dir)
        .flatMap((name) => {
            const path = join(dir, name);
            return statSync(path).isDirectory() ? sources(path) : [path];
        })
        .filter((path) => path.endsWith('.js') && !path.endsWith('.test.js'));
}

const files = sources(SRC).map((path) => ({path: relative(SRC, path), text: readFileSync(path, 'utf8')}));
const layer = (prefix) => files.filter((f) => f.path.startsWith(prefix));

/** Lines of the file matching the pattern, as "path:line: text", ignoring comments. */
function offending(file, pattern) {
    return file.text.split('\n').flatMap((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        return pattern.test(code) ? [`${file.path}:${i + 1}: ${line.trim()}`] : [];
    });
}

function assertNone(group, pattern, message) {
    const found = group.flatMap((f) => offending(f, pattern));
    assert.deepEqual(found, [], message);
}

test('core imports nothing from ui or platform', () => {
    assertNone(layer('core/'), /from\s+['"][^'"]*\/(ui|platform)\//, 'core must not depend on ui or platform');
});

test('platform and core never import ui', () => {
    assertNone([...layer('core/'), ...layer('platform/')], /from\s+['"][^'"]*\/ui\//, 'only main.js wires ui in');
});

test('core touches no browser globals and reads no clock of its own', () => {
    assertNone(
        layer('core/').filter((f) => f.path !== 'core/testing.js'),
        /\b(window|document|indexedDB|localStorage|sessionStorage|navigator|globalThis)\b|Date\.now\(|new Date\(\)/,
        'core gets these as parameters (AGENTS.md: Architecture rules)',
    );
});

test('money never goes through floating point', () => {
    assertNone(files, /\bparseFloat\(|\.toFixed\(/, 'use core/money.js');
    assertNone(
        files.filter((f) => f.path !== 'core/report/amount.js'),
        /\b(Number|parseInt)\(\s*[\w.]*(amount|minor|spend|balance|opening|budget|total|price)/i,
        'only report/amount.js turns an amount into a Number, for drawing',
    );
});

test('ui does no money math', () => {
    assertNone(layer('ui/'), /\bBigInt\(|\b\d+n\b|\.minor\b/, 'ui shows the text and size core hands it');
});

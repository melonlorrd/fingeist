// The sync log in a GitHub repo, through the REST API. fetch is passed in so tests never touch the network.

import {fromUtf8, toBase64, utf8} from '../bytes.js';
import {AuthError, ExistsError, RemoteError} from './errors.js';

const GITHUB_API = 'https://api.github.com';
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

/** A remote for "owner/name" with a fine-grained token that has Contents: read and write. */
export function githubRemote({fetch, repo, token, api = GITHUB_API}) {
    if (!REPO.test(repo)) {
        throw new Error('Enter the repository as owner/name');
    }
    const base = `${api}/repos/${repo}`;
    /** @type {string | null} */
    let branch = null;

    /**
     * @param {string} method
     * @param {string} path
     * @param {{body?: object, accept?: string, allow?: number[]}} [options]
     */
    async function request(method, path, {body, accept = 'application/vnd.github+json', allow = []} = {}) {
        const response = await fetch(`${base}${path}`, {
            method,
            cache: 'no-store',
            headers: {
                Accept: accept,
                Authorization: `Bearer ${token}`,
                ...(body ? {'Content-Type': 'application/json'} : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (response.ok || allow.includes(response.status)) {
            return response;
        }
        if (response.status === 401) {
            throw new AuthError('GitHub rejected the token. It may have expired or been revoked.');
        }
        if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
            throw new RemoteError('GitHub rate limit reached; sync will try again later.');
        }
        if (response.status === 403) {
            throw new AuthError(`The token can't write to ${repo}. Give it Contents: read and write on that repository.`);
        }
        if (response.status === 404 && path === '') {
            throw new AuthError(`${repo} was not found, or the token can't see it.`);
        }
        throw new RemoteError(`GitHub answered ${response.status} for ${method} ${path || '/'}`);
    }

    /** @returns {Promise<string>} */
    async function defaultBranch() {
        const name = branch ?? (await (await request('GET', '')).json()).default_branch;
        branch = name;
        return name;
    }

    async function fileSha(path) {
        const response = await request('GET', `/contents/${encodePath(path)}`, {allow: [404]});
        return response.status === 404 ? null : (await response.json()).sha;
    }

    async function put(path, bytes, message, sha) {
        return request('PUT', `/contents/${encodePath(path)}`, {
            body: {message, content: toBase64(bytes), ...(sha ? {sha} : {})},
            allow: [409, 422],
        });
    }

    return {
        /** Checks that the repo exists and the token can see it. */
        async check() {
            await defaultBranch();
        },

        /** The commit at the tip of the default branch, or null for an empty repo. */
        async head() {
            const response = await request('GET', `/git/ref/heads/${encodeURIComponent(await defaultBranch())}`, {allow: [404, 409]});
            return response.ok ? (await response.json()).object.sha : null;
        },

        async list(head) {
            const tree = await (await request('GET', `/git/trees/${head}?recursive=1`)).json();
            if (tree.truncated) {
                throw new RemoteError('The repository has too many files to list in one go.');
            }
            return tree.tree.filter((e) => e.type === 'blob').map((e) => ({path: e.path, blobId: e.sha}));
        },

        async read(entry) {
            const response = await request('GET', `/git/blobs/${entry.blobId}`, {accept: 'application/vnd.github.raw+json'});
            return new Uint8Array(await response.arrayBuffer());
        },

        /** Creates a file that must not exist yet. Throws ExistsError when it does. */
        async create(path, bytes) {
            const response = await put(path, bytes, `Add ${path}`);
            if (response.ok) {
                return;
            }
            if (response.status === 422 && (await fileSha(path))) {
                throw new ExistsError(`${path} already exists`);
            }
            throw new RemoteError(`GitHub answered ${response.status} when adding ${path}; sync will try again.`);
        },

        async readVault() {
            const response = await request('GET', '/contents/vault.json', {accept: 'application/vnd.github.raw+json', allow: [404]});
            return response.status === 404 ? null : fromUtf8(new Uint8Array(await response.arrayBuffer()));
        },

        async writeVault(text) {
            const response = await put('vault.json', utf8(text), 'Update vault.json', await fileSha('vault.json'));
            if (!response.ok) {
                throw new RemoteError(`GitHub answered ${response.status} when writing vault.json`);
            }
        },
    };
}

/** The token was rejected or can't reach the repo. Sync pauses until the user fixes it. */
export class AuthError extends Error {}

/** A file already exists at the path being created. */
export class ExistsError extends Error {}

/** Anything else the remote refused or failed at; sync retries later. */
export class RemoteError extends Error {}

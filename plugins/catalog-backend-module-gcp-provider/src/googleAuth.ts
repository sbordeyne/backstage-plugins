import fs from 'fs';
import { JWTInput } from 'google-auth-library';
import { google } from 'googleapis';
import { LoggerService } from '@backstage/backend-plugin-api';

/**
 * The `googleapis` auth type, named here because the library exposes it only as a constructor.
 */
export type GcpGoogleAuth = InstanceType<typeof google.auth.GoogleAuth>;

/** Resolved once: every provider in a backend reads the same file from the same environment. */
let cachedCredentials: { credentials?: JWTInput } | undefined;

/**
 * The service account key `GOOGLE_APPLICATION_CREDENTIALS` points at, when it points at a readable
 * one.
 *
 * A missing or unparseable file is logged and ignored rather than thrown: `GoogleAuth` still has
 * `gcloud` credentials, Workload Identity and the metadata server to fall back on, and a provider
 * is constructed during backend startup — throwing here takes the whole backend down over an
 * environment variable that may not even have been meant for this plugin.
 */
function credentialsFromEnv(logger: LoggerService): JWTInput | undefined {
  if (cachedCredentials) {
    return cachedCredentials.credentials;
  }
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) {
    cachedCredentials = {};
    return undefined;
  }
  try {
    logger.info(`Using GOOGLE_APPLICATION_CREDENTIALS: ${path}`);
    cachedCredentials = { credentials: JSON.parse(fs.readFileSync(path, 'utf8')) };
  } catch (error) {
    logger.warn(
      `Ignoring GOOGLE_APPLICATION_CREDENTIALS=${path}, which is not a readable JSON key file; ` +
        `falling back to application default credentials`,
      error as Error,
    );
    cachedCredentials = {};
  }
  return cachedCredentials.credentials;
}

/**
 * Credentials for every `googleapis` client this module builds.
 *
 * `GoogleAuth` resolves a key file, `gcloud` application default credentials, Workload Identity and
 * the metadata server on its own, so one instance covers every way this module is deployed and
 * there is no separate code path for running on GCP.
 *
 * Everything that talks to GCP goes through here rather than constructing its own auth. A client
 * built without it still *works* — it just reaches the API unauthenticated and every call comes
 * back as a missing-credentials error, which the callers treat as an empty result. That failure is
 * silent by design, so an unauthenticated client is a bug that costs relations rather than one that
 * announces itself.
 */
export function createGoogleAuth(logger: LoggerService): GcpGoogleAuth {
  const credentials = credentialsFromEnv(logger);
  return new google.auth.GoogleAuth({
    ...(credentials ? { credentials } : {}),
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
}

# secure-share-backend

Backend for the `secure-share` plugin: short-lived, end-to-end encrypted sharing of
credentials, text and files between Backstage users and groups.

## What this backend can and cannot see

Encryption and decryption happen **in the browser**. This backend stores:

- ciphertext chunks of the payload, in the configured blob store;
- the paste's data key, once per recipient device, **wrapped** to that device's public key;
- the paste's title, filename and mime type as a **sealed** blob;
- device public keys, recipient entity refs, timestamps and read counters.

It never receives a data key, a device private key, or plaintext. A dump of the
database and the bucket together yields nothing readable.

The limit worth knowing: a sender fetches recipient public keys **from this backend**. An
attacker who controls the running backend (or the served frontend bundle) can answer with a
key they hold and read pastes created afterwards. The frontend pins recipient fingerprints
in the sender's browser and refuses to send to an unrecognised key until the sender
confirms it, which makes such a substitution visible — it does not make it impossible. This
design protects against a leaked dump, a curious administrator and log exposure, not
against a compromised deployment.

## Keys are per browser

A device key is generated in one browser and its private half never leaves that
browser's IndexedDB. A new laptop, a new browser or cleared site data means a new key,
and pastes wrapped for the previous key stay unreadable. That is acceptable because
pastes are short lived; it is not a bug to be fixed by escrowing keys.

Group shares are expanded at send time. Somebody who joins the group afterwards cannot
read an earlier paste — only the sender ever held the data key, so no re-wrapping is
possible server side.

## Configuration

See `config.d.ts` for the full schema. The `secureShare` block is declared once, here,
and the frontend reads the entries marked `@visibility frontend` through the same
reader (`@sbordeyne/secure-share-common`), so both sides enforce identical limits.

```yaml
secureShare:
  card:
    limit: 5
  expiration:
    default: { hours: 24 }
    max: { days: 7 }
    options: [{ hours: 1 }, { hours: 8 }, { hours: 24 }, { days: 7 }]
  limits:
    maxFileSize: 100MB
    maxTextSize: 1MB
    chunkSize: 4MB
    maxRecipientKeys: 500
    maxDeviceKeysPerUser: 10
  storage:
    type: local
    local:
      path: ./secure-share-blobs
  cleanup:
    frequency: { minutes: 10 }
    burnGracePeriod: { minutes: 5 }
```

For production, use GCS instead:

```yaml
secureShare:
  storage:
    type: gcs
    gcs:
      bucket: example-secure-share
      prefix: pastes/
```

## API

| Method                          | Purpose                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| `POST /device-keys`             | Enroll the calling browser's public key. Idempotent per key.           |
| `GET /device-keys`              | List the caller's enrolled devices.                                    |
| `DELETE /device-keys/:id`       | Revoke one of the caller's own devices.                                |
| `POST /device-keys/resolve`     | Expand user and group refs into the device keys to wrap a paste for.   |
| `POST /pastes`                  | Register a paste and its wrapped keys, before uploading ciphertext.    |
| `PUT /pastes/:id/chunks/:index` | Upload one ciphertext chunk (`application/octet-stream`), sender only. |
| `POST /pastes/:id/finalize`     | Seal the paste. Refused unless every declared chunk is present.        |
| `GET /pastes/shared-with-me`    | Pastes one device can decrypt, newest first.                           |
| `GET /pastes/mine`              | Pastes the caller sent.                                                |
| `GET /pastes/:id?deviceKeyId=`  | Metadata plus the wrapped key for that device.                         |
| `GET /pastes/:id/chunks/:index` | Stream ciphertext. Fetching chunk 0 counts as a read.                  |
| `GET /pastes/:id/reads`         | Read trail, sender only.                                               |
| `DELETE /pastes/:id`            | Delete a paste and its ciphertext, sender only.                        |
| `GET /link/:id`                 | Secret link read. Unauthenticated, token in the header (see below).    |
| `GET /link/:id/chunks/:index`   | Secret link ciphertext stream.                                         |

Notes on the read paths:

- **One error for everything.** A paste that is missing, expired, burned, over its read
  cap, or simply not shared with the caller all return the same 404. The API cannot be
  used to discover which paste ids exist.
- **Holding a wrapped key is the authorization.** There is no separate ACL check for
  recipients: if no wrapped key exists for a device the caller owns, there is nothing they
  could decrypt anyway.
- **Secret links** live under `/link` because that is the only prefix opened to
  unauthenticated callers. The token travels in the `x-secure-share-link-token` header to
  keep it out of access logs, and is stored only as a SHA-256 digest, compared in constant
  time. The data key stays in the URL fragment and never reaches the backend.
- **Burn after read** marks a paste consumed when its first chunk is fetched. It stays
  readable for `cleanup.burnGracePeriod` so an interrupted download can be retried, then
  becomes unreadable and is purged. A retry counts as another read, which matters if
  `maxReads` is also set.

## Installation

```ts
// packages/backend/src/index.ts
backend.add(import('@sbordeyne/backstage-plugin-secure-share-backend'));
```

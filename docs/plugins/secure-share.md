# Secure Share

`@sbordeyne/backstage-plugin-secure-share` · `@sbordeyne/backstage-plugin-secure-share-backend` ·
`@sbordeyne/secure-share-common`

Short-lived, end-to-end encrypted sharing of credentials, text and files between Backstage users
and groups. Encryption and decryption happen in the browser; the backend stores ciphertext and
wrapped keys and never sees a data key or plaintext.

## What each side can see

The browser generates a P-256 ECDH key pair per device, whose private half is stored in
IndexedDB as a non-extractable `CryptoKey` — no code, this plugin included, can read the key
bytes. A paste is encrypted with a fresh AES-256-GCM data key, and that data key is wrapped once
per recipient device public key.

The backend therefore holds:

- ciphertext chunks of the payload, in the configured blob store;
- the data key **wrapped** per recipient device;
- title, filename and mime type as a **sealed** blob;
- device public keys, recipient entity refs, timestamps and read counters.

A dump of the database and the bucket together yields nothing readable.

!!! warning "The limit worth knowing"

    A sender fetches recipient public keys **from this backend**. An attacker who controls the
    running backend — or the served frontend bundle — can answer with a key they hold and read
    pastes created afterwards. The frontend pins recipient fingerprints in the sender's browser
    and refuses to send to an unrecognised key until the sender confirms it, which makes such a
    substitution visible. It does not make it impossible. This design protects against a leaked
    dump, a curious administrator and log exposure; not against a compromised deployment.

Keys are per browser. A new laptop, a new browser or cleared site data means a new key, and
pastes wrapped for the previous key stay unreadable. Group shares are expanded at send time, so
somebody who joins a group afterwards cannot read an earlier paste — only the sender ever held
the data key, and no re-wrapping is possible server side.

## Installation

### Backend

```bash
yarn --cwd packages/backend add @sbordeyne/backstage-plugin-secure-share-backend
```

```ts
// packages/backend/src/index.ts
backend.add(import('@sbordeyne/backstage-plugin-secure-share-backend'));
```

Migrations run at startup. The backend also opens `/api/secure-share/link` to unauthenticated
callers, which is what makes secret links work — see [Secret links](#secret-links).

### Frontend

The frontend requires the [new frontend system](https://backstage.io/docs/frontend-system/); it
exposes no legacy `createPlugin` extensions.

```bash
yarn --cwd packages/app add @sbordeyne/backstage-plugin-secure-share
```

```tsx
// packages/app/src/App.tsx
import secureSharePlugin from '@sbordeyne/backstage-plugin-secure-share/alpha';

const app = createApp({
  features: [secureSharePlugin],
});
```

The page brings its own title and icon, which is what puts `Secure Share` in the sidebar — no
`SidebarItem` to add. Both are overridable, along with the path, from `app-config.yaml`:

```yaml
app:
  extensions:
    - page:secure-share:
        config:
          path: /secrets
          title: Secrets
```

The plugin also ships a home page widget listing what was recently shared with the signed-in
user. Like every home page widget it is added from the home page's own customization, and it
honours `secureShare.card.limit` unless the viewer overrides the count in the widget settings.

Routes inside the plugin:

| Path                      | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `/secure-share`           | Share a secret, see what was shared with you, manage devices  |
| `/secure-share/paste/:id` | Open a paste shared with you, using this browser's device key |
| `/secure-share/link/:id`  | Open a paste from a secret link, whose key is in the fragment |

## Configuration

The `secureShare` block is declared once, by the backend package. The frontend reads the keys
marked `@visibility frontend` through the same reader in `@sbordeyne/secure-share-common`, so
the limits the form enforces are exactly the ones the backend enforces. A client-side check is
not a control: every limit below is re-checked server side on every request.

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

| Key                           | Type       | Default                           | Frontend visible | Meaning                                                  |
| ----------------------------- | ---------- | --------------------------------- | ---------------- | -------------------------------------------------------- |
| `card.limit`                  | number     | `5`                               | yes              | Pastes shown by the "Shared with me" card                |
| `expiration.default`          | duration   | `{ hours: 24 }`                   | yes              | Pre-selected lifetime in the create form                 |
| `expiration.max`              | duration   | `{ days: 7 }`                     | yes              | Longest lifetime a paste may be given                    |
| `expiration.options`          | duration[] | 1h, 8h, 24h, 7d                   | yes              | Lifetimes offered in the create form                     |
| `limits.maxFileSize`          | size       | `100MB`                           | yes              | Largest file that may be shared                          |
| `limits.maxTextSize`          | size       | `1MB`                             | yes              | Largest text paste that may be shared                    |
| `limits.chunkSize`            | size       | `4MB`                             | yes              | Chunk size a payload is split into before encryption     |
| `limits.maxRecipientKeys`     | number     | `500`                             | no               | Cap on device keys a single paste may be wrapped for     |
| `limits.maxDeviceKeysPerUser` | number     | `10`                              | no               | Cap on active device keys one user may enroll            |
| `storage.type`                | enum       | `local`                           | no               | `local` or `gcs`                                         |
| `storage.local.path`          | string     | `./secure-share-blobs`            | no               | Directory holding encrypted chunks                       |
| `storage.gcs.bucket`          | string     | **required for `gcs`**            | no               | Bucket holding encrypted chunks                          |
| `storage.gcs.prefix`          | string     | `pastes/`                         | no               | Key prefix inside the bucket                             |
| `storage.gcs.keyFilename`     | string     | _application default credentials_ | no               | Path to a service account key file                       |
| `cleanup.frequency`           | duration   | `{ minutes: 10 }`                 | no               | How often expired pastes are purged                      |
| `cleanup.burnGracePeriod`     | duration   | `{ minutes: 5 }`                  | no               | How long a burn-after-read paste survives its first read |

Inconsistent configuration is rejected at startup rather than at send time: `default` may not
exceed `max`, no entry in `options` may exceed `max`, and `chunkSize` may not exceed
`maxFileSize`.

### Production storage

`local` writes chunks to the backend's filesystem, which is fine for a single-replica
development setup and wrong for anything else — replicas do not share the directory. Use GCS in
production:

```yaml
secureShare:
  storage:
    type: gcs
    gcs:
      bucket: example-secure-share
      prefix: pastes/
```

Credentials are Application Default Credentials unless `keyFilename` is set. The backend needs
to create, read and delete objects under the prefix:

```bash
gcloud storage buckets add-iam-policy-binding gs://example-secure-share \
  --member="serviceAccount:backstage@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role=roles/storage.objectAdmin
```

Object deletion is genuinely required — the purge task removes ciphertext for expired, consumed
and fully read pastes, and an install without delete permission accumulates orphaned chunks
that no longer have a database row.

Give the bucket a lifecycle rule as a backstop, and consider a
[CMEK](https://cloud.google.com/storage/docs/encryption/customer-managed-keys) key if your
threat model includes the storage layer — though note the payload is already encrypted before
it reaches the bucket.

## API

Mounted at `/api/secure-share`.

| Method   | Path                        | Purpose                                                               |
| -------- | --------------------------- | --------------------------------------------------------------------- |
| `POST`   | `/device-keys`              | Enroll the calling browser's public key. Idempotent per key           |
| `GET`    | `/device-keys`              | List the caller's enrolled devices                                    |
| `DELETE` | `/device-keys/:id`          | Revoke one of the caller's own devices                                |
| `POST`   | `/device-keys/resolve`      | Expand user and group refs into the device keys to wrap a paste for   |
| `POST`   | `/pastes`                   | Register a paste and its wrapped keys, before uploading ciphertext    |
| `PUT`    | `/pastes/:id/chunks/:index` | Upload one ciphertext chunk (`application/octet-stream`), sender only |
| `POST`   | `/pastes/:id/finalize`      | Seal the paste. Refused unless every declared chunk is present        |
| `GET`    | `/pastes/shared-with-me`    | Pastes one device can decrypt, newest first                           |
| `GET`    | `/pastes/mine`              | Pastes the caller sent                                                |
| `GET`    | `/pastes/:id?deviceKeyId=`  | Metadata plus the wrapped key for that device                         |
| `GET`    | `/pastes/:id/chunks/:index` | Stream ciphertext. Fetching chunk 0 counts as a read                  |
| `GET`    | `/pastes/:id/reads`         | Read trail, sender only                                               |
| `DELETE` | `/pastes/:id`               | Delete a paste and its ciphertext, sender only                        |
| `GET`    | `/link/:id`                 | Secret link read. Unauthenticated, token in a header                  |
| `GET`    | `/link/:id/chunks/:index`   | Secret link ciphertext stream                                         |

Notes on the read paths:

- **One error for everything.** A paste that is missing, expired, burned, over its read cap, or
  simply not shared with the caller all return the same 404, so the API cannot be used to
  discover which paste ids exist.
- **Holding a wrapped key is the authorization.** There is no separate ACL check for recipients:
  if no wrapped key exists for a device the caller owns, there is nothing they could decrypt.

### Secret links

`/link` is the only prefix opened to unauthenticated callers, because a link holder proves
nothing but possession of the token. The token travels in the `x-secure-share-link-token` header
to keep it out of access logs, and is stored only as a SHA-256 digest compared in constant time.
The data key stays in the URL fragment and never reaches the backend at all.

Burn-after-read marks a paste consumed when its first chunk is fetched. It stays readable for
`cleanup.burnGracePeriod` so an interrupted download can be retried, then becomes unreadable and
is purged. A retry counts as another read, which matters if a read cap is also set.

## Operating notes

- **Losing a browser is losing the pastes shared with it.** That is a design decision, not a
  bug to be fixed by escrowing keys; pastes are short lived by construction.
- **`maxDeviceKeysPerUser`** bounds how many browsers one person can enroll. Users who hit it
  should revoke a device from the manage-devices card rather than have the limit raised.
- **Purge frequency** is the only thing standing between you and unbounded blob growth. Leave
  the task enabled.

# secure-share

Frontend for the `secure-share` plugin: share credentials, text and files with
Backstage users and groups, encrypted in the browser and expiring on their own.

## Where the crypto lives

All encryption and decryption happen here, in the browser:

- each browser generates a **P-256 ECDH key pair** whose private half is stored in
  IndexedDB as a non-extractable `CryptoKey`, so no code — including this plugin — can
  read the key bytes;
- a paste is encrypted with a fresh AES-256-GCM data key, and that data key is wrapped
  once per recipient device public key;
- the backend receives ciphertext and wrapped keys only.

A consequence worth repeating in the UI: a new browser means a new key, and pastes
shared with the previous one cannot be read there. Pastes are short lived by design, so
this is a cheap trade for having no key escrow anywhere.

Recipient public keys are fetched from the backend, which is the one thing a sender cannot
verify on its own. Fingerprints are therefore pinned per recipient, in this browser's
`localStorage` and nowhere else: pins kept server side would be under the control of the
very backend they are meant to check.

When a recipient presents a key that has never been pinned for them, the sender is shown
the fingerprint and has to confirm it before the paste can be sent. That check cannot tell
a substituted key from a recipient's new laptop, which is exactly why it asks instead of
deciding. Keys are pinned only after a paste has actually been sent, so an abandoned form
never silently trusts anything.

## Configuration

The `secureShare` config block is declared once, by
`@sbordeyne/backstage-plugin-secure-share-backend`, and read here through
`readSecureShareSharedConfig` from `@sbordeyne/secure-share-common`. Both sides use the
same reader so the limits the form enforces match the ones the backend enforces.

## Installation

This is a [new frontend system](https://backstage.io/docs/frontend-system/) plugin: it exposes
no legacy `createPlugin` extensions, and is installed as a feature.

```tsx
// packages/app/src/App.tsx
import secureSharePlugin from '@sbordeyne/backstage-plugin-secure-share/alpha';

const app = createApp({
  features: [secureSharePlugin],
});
```

The page carries its own title and icon, which is what the app builds the sidebar entry from, so
there is no `SidebarItem` to add. The `Shared with me` home page widget comes with the plugin and
is added from the home page's own customization; it honours `secureShare.card.limit` unless the
viewer overrides the count in the widget settings.

Routes inside the plugin:

| Path                      | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `/secure-share`           | Share a secret, see what was shared with you, manage devices.  |
| `/secure-share/paste/:id` | Open a paste shared with you, using this browser's device key. |
| `/secure-share/link/:id`  | Open a paste from a secret link, whose key is in the fragment. |

## Development

```bash
yarn workspace @sbordeyne/backstage-plugin-secure-share start
```

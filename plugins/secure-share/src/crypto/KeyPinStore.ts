const STORAGE_KEY = 'secure-share/pinned-keys/v1';

/** @public */
export type PinStatus = 'first-seen' | 'unchanged' | 'new-keys';

/** @public */
export interface PinVerdict {
  userEntityRef: string;
  status: PinStatus;
  /** Fingerprints presented now that have never been pinned for this recipient. */
  newFingerprints: string[];
  pinnedFingerprints: string[];
}

interface PinnedRecipient {
  fingerprints: string[];
  updatedAt: string;
}

/**
 * Remembers which device key fingerprints have been seen for each recipient, so that a
 * key appearing out of nowhere becomes visible to the sender.
 *
 * Deliberately stored in this browser only, never through the Backstage storage API: the
 * point of pinning is to detect a backend that hands out a key it controls, and pins kept
 * server side would be under that same backend's control.
 *
 * A new fingerprint is not proof of an attack — a recipient who enrolls a new laptop
 * produces one too — which is why the sender is asked to confirm rather than blocked.
 *
 * @public
 */
export class KeyPinStore {
  readonly #storage: Storage;

  static create(storage: Storage = window.localStorage): KeyPinStore {
    return new KeyPinStore(storage);
  }

  private constructor(storage: Storage) {
    this.#storage = storage;
  }

  getPinned(userEntityRef: string): string[] {
    return this.#readAll()[userEntityRef]?.fingerprints ?? [];
  }

  evaluate(recipient: { userEntityRef: string; fingerprints: string[] }): PinVerdict {
    const pinnedFingerprints = this.getPinned(recipient.userEntityRef);
    const newFingerprints = recipient.fingerprints.filter(fingerprint => !pinnedFingerprints.includes(fingerprint));

    return {
      userEntityRef: recipient.userEntityRef,
      status: pinStatus({ pinnedFingerprints, newFingerprints }),
      newFingerprints,
      pinnedFingerprints,
    };
  }

  /** Records the fingerprints as trusted for this recipient, adding to what is already pinned. */
  trust(recipient: { userEntityRef: string; fingerprints: string[] }): void {
    const pinned = new Set([...this.getPinned(recipient.userEntityRef), ...recipient.fingerprints]);
    this.#writeAll({
      ...this.#readAll(),
      [recipient.userEntityRef]: { fingerprints: [...pinned], updatedAt: new Date().toISOString() },
    });
  }

  forget(userEntityRef: string): void {
    const all = this.#readAll();
    delete all[userEntityRef];
    this.#writeAll(all);
  }

  #readAll(): Record<string, PinnedRecipient> {
    const stored = this.#storage.getItem(STORAGE_KEY);
    if (!stored) {
      return {};
    }
    try {
      // Written by this plugin only; unreadable pins are treated as absent rather than fatal.
      return JSON.parse(stored) as Record<string, PinnedRecipient>;
    } catch {
      return {};
    }
  }

  #writeAll(pins: Record<string, PinnedRecipient>): void {
    this.#storage.setItem(STORAGE_KEY, JSON.stringify(pins));
  }
}

function pinStatus(options: { pinnedFingerprints: string[]; newFingerprints: string[] }): PinStatus {
  if (options.pinnedFingerprints.length === 0) {
    return 'first-seen';
  }
  return options.newFingerprints.length === 0 ? 'unchanged' : 'new-keys';
}

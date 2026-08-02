import { ResolvedRecipient } from '@sbordeyne/secure-share-common';
import { useCallback, useMemo, useState } from 'react';
import { KeyPinStore, PinVerdict } from '../crypto/KeyPinStore';

/** @public */
export interface KeyPinsState {
  verdicts: PinVerdict[];
  /** Recipients presenting a key that has never been pinned and not yet confirmed. */
  unconfirmedUserEntityRefs: string[];
  confirm: (userEntityRef: string) => void;
  /** Pins everything currently presented. Called once a paste has actually been sent. */
  pinAll: () => void;
}

/**
 * Compares the recipients' device keys against what this browser has pinned before.
 *
 * A key nobody has seen before is reported so the sender can check the fingerprint out of
 * band. It is confirmed explicitly, because a substituted key and a new laptop look
 * identical from here.
 *
 * @public
 */
export function useKeyPins(recipients: ResolvedRecipient[]): KeyPinsState {
  const store = useMemo(() => KeyPinStore.create(), []);
  const [confirmedRefs, setConfirmedRefs] = useState<string[]>([]);

  const presented = useMemo(
    () =>
      recipients.map(recipient => ({
        userEntityRef: recipient.userEntityRef,
        fingerprints: recipient.keys.map(key => key.fingerprint),
      })),
    [recipients],
  );

  const verdicts = useMemo(() => presented.map(recipient => store.evaluate(recipient)), [presented, store]);

  const unconfirmedUserEntityRefs = verdicts
    .filter(verdict => verdict.status === 'new-keys' && !confirmedRefs.includes(verdict.userEntityRef))
    .map(verdict => verdict.userEntityRef);

  const confirm = useCallback((userEntityRef: string): void => {
    setConfirmedRefs(refs => (refs.includes(userEntityRef) ? refs : [...refs, userEntityRef]));
  }, []);

  const pinAll = useCallback((): void => {
    presented.forEach(recipient => store.trust(recipient));
  }, [presented, store]);

  return { verdicts, unconfirmedUserEntityRefs, confirm, pinAll };
}

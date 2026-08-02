import { useApi } from '@backstage/core-plugin-api';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SecureShareApi, secureShareApiRef } from '../api';
import { computeFingerprint, DeviceKeyStorage, generateDeviceKeyPair, StoredDeviceKey } from '../crypto';
import { describeBrowser } from '../crypto/browserLabel';

/** A device key that has been enrolled and can therefore receive pastes. */
export interface EnrolledDeviceKey extends StoredDeviceKey {
  deviceKeyId: string;
}

/** @public */
export interface DeviceKeyState {
  deviceKey?: EnrolledDeviceKey;
  loading: boolean;
  error?: Error;
  suggestedLabel: string;
  enroll: (label?: string) => Promise<void>;
  forget: () => Promise<void>;
}

/**
 * Gives access to this browser's device key, enrolling it on request.
 *
 * The key pair is generated here and its private half never leaves IndexedDB. Enrollment
 * publishes only the public half, and the fingerprint the backend reports back is checked
 * against the one computed locally: if they differ, the backend altered the key and
 * nothing wrapped for it should be trusted.
 *
 * @public
 */
export function useDeviceKey(): DeviceKeyState {
  const secureShareApi = useApi(secureShareApiRef);
  const storage = useMemo(() => DeviceKeyStorage.create(), []);
  const [deviceKey, setDeviceKey] = useState<EnrolledDeviceKey>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    let cancelled = false;
    storage
      .load()
      .then(stored => {
        if (!cancelled) {
          setDeviceKey(stored?.deviceKeyId ? (stored as EnrolledDeviceKey) : undefined);
          setLoading(false);
        }
      })
      .catch(loadError => {
        if (!cancelled) {
          setError(loadError as Error);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const enroll = useCallback(
    async (label?: string): Promise<void> => {
      setLoading(true);
      setError(undefined);
      try {
        setDeviceKey(await enrollDeviceKey({ storage, secureShareApi, label }));
      } catch (enrollError) {
        setError(enrollError as Error);
      } finally {
        setLoading(false);
      }
    },
    [storage, secureShareApi],
  );

  const forget = useCallback(async (): Promise<void> => {
    await storage.clear();
    setDeviceKey(undefined);
  }, [storage]);

  return {
    deviceKey,
    loading,
    error,
    suggestedLabel: describeBrowser(navigator.userAgent),
    enroll,
    forget,
  };
}

async function enrollDeviceKey(options: {
  storage: DeviceKeyStorage;
  secureShareApi: SecureShareApi;
  label?: string;
}): Promise<EnrolledDeviceKey> {
  const existing = await options.storage.load();
  const keyPair = existing ?? (await generateDeviceKeyPair());
  const fingerprint = await computeFingerprint(keyPair.publicKey);

  const summary = await options.secureShareApi.enrollDeviceKey({
    publicKey: keyPair.publicKey,
    label: options.label ?? describeBrowser(navigator.userAgent),
  });
  if (summary.fingerprint !== fingerprint) {
    throw new Error(
      'The backend reported a different fingerprint than this browser computed. Do not trust this enrollment.',
    );
  }

  const enrolled: EnrolledDeviceKey = {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    fingerprint,
    deviceKeyId: summary.id,
  };
  await options.storage.save(enrolled);
  return enrolled;
}

import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { InputError } from '@backstage/errors';

const RECIPIENT_KINDS = ['user', 'group'];

/**
 * Validates and canonicalizes the entity refs a sender picked as recipients, dropping
 * duplicates. Only users and groups can receive a paste.
 *
 * @public
 */
export function normalizeRecipientRefs(entityRefs: string[]): string[] {
  const normalized = entityRefs.map(ref => {
    const parsed = parseEntityRef(ref);
    if (!RECIPIENT_KINDS.includes(parsed.kind.toLocaleLowerCase('en-US'))) {
      throw new InputError(`Recipient '${ref}' must be a user: or group: ref`);
    }
    return stringifyEntityRef(parsed);
  });
  return [...new Set(normalized)];
}

import { Flex, Text } from '@backstage/ui';
import { Link, useLocation } from 'react-router-dom';

import { useKubespecRoutes, useResourceList } from '../../hooks';
import type { ResourceRef } from '../../lib/paths';

export interface ResourceNotFoundProps {
  /** Not named `ref`: React reserves that prop and it would never arrive. */
  resource: ResourceRef;
}

/**
 * The recovery page for a kind that is not in the version being viewed.
 *
 * Reached by navigating optimistically: checking every version switch before
 * making it would cost a request each time and be wrong in the common case. The
 * alternatives come from the target version's own list, which the reader has
 * usually already loaded.
 */
export function ResourceNotFound(props: ResourceNotFoundProps): JSX.Element {
  const { resource: ref } = props;
  const location = useLocation();
  const previousVersion = (location.state as { previousVersion?: string } | null)?.previousVersion;
  const { value } = useResourceList(ref.sourceId, ref.sourceVersion);
  const { resourceHref, sourceHref } = useKubespecRoutes();

  const sameKind = (value?.items ?? []).filter(
    item => item.kind.toLowerCase() === ref.kind.toLowerCase() && item.apiVersion !== ref.apiVersion,
  );

  return (
    <Flex direction="column" gap="3">
      <Text as="h2" variant="title-medium">
        {ref.kind} is not in {value?.sourceName ?? ref.sourceId} {value?.resolvedVersion ?? ref.sourceVersion}
      </Text>

      <Flex gap="4">
        {previousVersion && previousVersion !== ref.sourceVersion && (
          <Link to={resourceHref({ ...ref, sourceVersion: previousVersion })}>← Back to {previousVersion}</Link>
        )}
        <Link to={sourceHref(ref.sourceId, ref.sourceVersion)}>Browse every kind in this version →</Link>
      </Flex>

      {sameKind.length > 0 && (
        <Flex direction="column" gap="1">
          <Text as="h3" variant="title-small">
            Other API versions of {ref.kind} here
          </Text>
          {sameKind.map(item => (
            <Link
              key={item.apiVersionFull}
              to={resourceHref({
                sourceId: ref.sourceId,
                sourceVersion: ref.sourceVersion,
                group: item.group,
                apiVersion: item.apiVersion,
                kind: item.kind,
              })}
            >
              {item.apiVersionFull} {item.kind}
            </Link>
          ))}
        </Flex>
      )}
    </Flex>
  );
}

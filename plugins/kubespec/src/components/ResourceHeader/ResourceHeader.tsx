import { Button, Flex, Text } from '@backstage/ui';
import type { KubespecResourceEnvelope } from '@sbordeyne/kubespec-common';

import { ScopeBadge } from '../ScopeBadge';

export interface ResourceHeaderProps {
  envelope: KubespecResourceEnvelope;
  /** Present when the URL says `latest`, which is a moving target. */
  onPinVersion?: () => void;
  onCopyLink: () => void;
}

export function ResourceHeader(props: ResourceHeaderProps): JSX.Element {
  const { envelope } = props;

  return (
    <Flex direction="column" gap="2">
      <Flex gap="3" align="center">
        <Text variant="body-medium" color="secondary">
          {envelope.apiVersionFull}
        </Text>
        <ScopeBadge scope={envelope.scope} />
        {props.onPinVersion && (
          <Flex gap="2" align="center">
            <Text variant="body-small" color="secondary">
              viewing latest ({envelope.sourceVersion})
            </Text>
            <Button variant="secondary" size="small" onClick={props.onPinVersion}>
              Pin {envelope.sourceVersion}
            </Button>
          </Flex>
        )}
        <Button variant="secondary" size="small" onClick={props.onCopyLink}>
          Copy link
        </Button>
      </Flex>

      <Text as="h2" variant="title-large">
        {envelope.kind}
      </Text>

      {envelope.description && <Text variant="body-medium">{envelope.description}</Text>}

      {envelope.truncated && (
        <Text variant="body-small" color="warning">
          This schema was too large to expand completely and is shown truncated.
        </Text>
      )}
    </Flex>
  );
}

import { Flex, Link, Text } from '@backstage/ui';
import type { KubespecLink } from '@sbordeyne/kubespec-common';

export interface ResourceLinksProps {
  kind: string;
  links: KubespecLink[];
  /** Absent when nothing is configured, in which case no call to action is shown. */
  contributeUrl?: string;
}

export function ResourceLinks(props: ResourceLinksProps): JSX.Element | null {
  if (props.links.length === 0 && !props.contributeUrl) {
    return null;
  }

  return (
    <Flex direction="column" gap="2">
      <Text as="h3" variant="title-small">
        Documentation
      </Text>
      {props.links.length === 0 ? (
        <Text variant="body-small" color="secondary">
          No links for {props.kind} yet — <Link href={props.contributeUrl}>add one</Link>.
        </Text>
      ) : (
        props.links.map(link => (
          <Link key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
            {link.name}
          </Link>
        ))
      )}
    </Flex>
  );
}

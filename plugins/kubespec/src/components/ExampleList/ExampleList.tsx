import { Accordion, AccordionGroup, AccordionPanel, AccordionTrigger, Flex, Link, Text } from '@backstage/ui';
import { CodeSnippet } from '@backstage/core-components';
import type { KubespecExample } from '@sbordeyne/kubespec-common';

export interface ExampleListProps {
  kind: string;
  examples: KubespecExample[];
  /** Absent when nothing is configured, in which case no call to action is shown. */
  contributeUrl?: string;
}

/**
 * Hand-authored manifests for a kind.
 *
 * The YAML arrives already extracted from the markdown it was written in, so
 * nothing here parses frontmatter or renders markdown — and `CodeSnippet` is the
 * highlighter this repo already ships rather than a fourth one in the bundle.
 */
export function ExampleList(props: ExampleListProps): JSX.Element | null {
  if (props.examples.length === 0 && !props.contributeUrl) {
    return null;
  }

  return (
    <Flex direction="column" gap="2">
      <Text as="h3" variant="title-small">
        Examples
      </Text>

      {props.examples.length === 0 ? (
        <Text variant="body-small" color="secondary">
          No examples for {props.kind} yet — <Link href={props.contributeUrl}>write one</Link>.
        </Text>
      ) : (
        <AccordionGroup allowsMultiple defaultExpandedKeys={[props.examples[0].slug]}>
          {props.examples.map((example, index) => (
            <Accordion key={example.slug} id={example.slug}>
              <AccordionTrigger title={`${index + 1}. ${example.title}`} subtitle={example.description} />
              <AccordionPanel>
                <CodeSnippet text={example.content} language="yaml" showLineNumbers showCopyCodeButton />
              </AccordionPanel>
            </Accordion>
          ))}
        </AccordionGroup>
      )}
    </Flex>
  );
}

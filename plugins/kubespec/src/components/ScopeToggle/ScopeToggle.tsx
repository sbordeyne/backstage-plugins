import { Flex, Text, ToggleButton, ToggleButtonGroup } from '@backstage/ui';

export type ScopeFilter = 'Cluster' | 'all' | 'Namespaced';

export interface ScopeToggleProps {
  value: ScopeFilter;
  onChange: (value: ScopeFilter) => void;
}

/**
 * Cluster / all / namespaced, in that order.
 *
 * A toggle rather than a select: there are only three states and they are
 * mutually exclusive, so showing all of them costs less than a menu that hides
 * two of them behind a click.
 */
export function ScopeToggle(props: ScopeToggleProps): JSX.Element {
  return (
    <Flex gap="2" align="center">
      <Text variant="body-small" color="secondary" id="kubespec-scope-label">
        Scope
      </Text>
      <ToggleButtonGroup
        aria-labelledby="kubespec-scope-label"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[props.value]}
        onSelectionChange={keys => {
          const [first] = [...keys];
          if (first) {
            props.onChange(String(first) as ScopeFilter);
          }
        }}
      >
        <ToggleButton id="Cluster" size="small">
          Cluster
        </ToggleButton>
        <ToggleButton id="all" size="small">
          All
        </ToggleButton>
        <ToggleButton id="Namespaced" size="small">
          Namespaced
        </ToggleButton>
      </ToggleButtonGroup>
    </Flex>
  );
}

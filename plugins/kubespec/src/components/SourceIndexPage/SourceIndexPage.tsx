import { Progress, ResponseErrorPanel } from '@backstage/core-components';
import { Flex, Text } from '@backstage/ui';
import type { KubespecResourceSummary } from '@sbordeyne/kubespec-common';
import { makeStyles } from '@material-ui/core/styles';
import { useMemo } from 'react';

import { useKubespecRoutes, useKubespecSources, useResourceList, useSourceRouteParams } from '../../hooks';
import type { ScopeFilter } from '../ScopeToggle';
import { BackToDefaultSource } from '../BackToDefaultSource';
import { ResourceCard } from '../ResourceCard';
import { SourceGrid } from '../SourceGrid';

const useStyles = makeStyles(theme => ({
  grid: {
    // A real grid rather than a flex row: BUI's Flex cannot wrap, which is what
    // left every category on one clipped line. `auto-fill` + `minmax` also sizes
    // the columns to the container, so a long `karpenter.k8s.aws/v1` widens its
    // own cell instead of being truncated.
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: theme.spacing(1),
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  category: {
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
}));

/**
 * Every kind a source defines at one version.
 *
 * Filtering is client-side over the list that is already here — the largest
 * source in the corpus has 83 kinds — so it is instant, and the escape hatch to a
 * real cross-source search sits underneath it.
 */
export interface SourceIndexPageProps {
  /** Owned by the page shell, because the control that sets it is in the toolbar. */
  scope: ScopeFilter;
}

export function SourceIndexPage(props: SourceIndexPageProps): JSX.Element {
  const classes = useStyles();
  const { sourceId, sourceVersion } = useSourceRouteParams();
  const { sources } = useKubespecSources();
  const { resourceHref } = useKubespecRoutes();
  const { value, loading, error } = useResourceList(sourceId, sourceVersion);

  const { scope } = props;

  const filtered = useMemo(
    () => (value?.items ?? []).filter(resource => scope === 'all' || resource.scope === scope),
    [value, scope],
  );

  if (loading) {
    return <Progress />;
  }
  if (error) {
    return <ResponseErrorPanel error={error} />;
  }
  if (!value) {
    return <Text>No data.</Text>;
  }

  const byCategory = groupByCategory(filtered, value.categoryOrder);

  return (
    <Flex direction="column" gap="5">
      <BackToDefaultSource sourceId={sourceId} />

      <Flex direction="column" gap="1">
        <Text as="h2" variant="title-medium">
          {value.sourceName} {value.resolvedVersion}
        </Text>
        <Text variant="body-small" color="secondary">
          {value.items.length} kind{value.items.length === 1 ? '' : 's'}
          {filtered.length !== value.items.length ? ` · ${filtered.length} shown` : ''}. Pick one to see its properties,
          change history and examples.
        </Text>
      </Flex>

      {byCategory.map(([name, resources]) => (
        <Flex key={name} direction="column" gap="2">
          <Text as="h3" variant="body-small" color="secondary" weight="bold" className={classes.category}>
            {name} ({resources.length})
          </Text>
          <ul className={classes.grid}>
            {resources.map(resource => (
              <li key={`${resource.apiVersionFull}/${resource.kind}`}>
                <ResourceCard
                  resource={resource}
                  href={resourceHref({
                    sourceId,
                    sourceVersion,
                    group: resource.group,
                    apiVersion: resource.apiVersion,
                    kind: resource.kind,
                  })}
                />
              </li>
            ))}
          </ul>
        </Flex>
      ))}

      {filtered.length === 0 && (
        <Text color="secondary">
          No {scope === 'Cluster' ? 'cluster-scoped' : 'namespaced'} kinds in {value.resolvedVersion}.
        </Text>
      )}

      <Flex direction="column" gap="2">
        <Text as="h3" variant="title-small">
          Other sources
        </Text>
        <SourceGrid sources={sources} currentSourceId={sourceId} />
      </Flex>
    </Flex>
  );
}

/** Categories in the order the backend gave, which is curated for Kubernetes. */
function groupByCategory(
  resources: readonly KubespecResourceSummary[],
  order: readonly string[],
): Array<[string, KubespecResourceSummary[]]> {
  const groups = new Map<string, KubespecResourceSummary[]>();
  for (const resource of resources) {
    const existing = groups.get(resource.category);
    if (existing) {
      existing.push(resource);
    } else {
      groups.set(resource.category, [resource]);
    }
  }

  for (const entries of groups.values()) {
    entries.sort((a, b) => a.kind.localeCompare(b.kind));
  }

  const ranked = [...groups.entries()];
  ranked.sort(([a], [b]) => {
    const indexA = order.indexOf(a);
    const indexB = order.indexOf(b);
    if (indexA === indexB) {
      return a.localeCompare(b);
    }
    return (indexA === -1 ? order.length : indexA) - (indexB === -1 ? order.length : indexB);
  });
  return ranked;
}

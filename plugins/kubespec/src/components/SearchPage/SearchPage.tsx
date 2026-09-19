import { Progress, ResponseErrorPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { Flex, SearchField, Select, Text } from '@backstage/ui';
import type { KubespecSearchResponse } from '@sbordeyne/kubespec-common';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import useAsync from 'react-use/lib/useAsync';

import { kubespecApiRef } from '../../api';
import { useKubespecRoutes, useKubespecSources, useQueryParam } from '../../hooks';
import { LATEST_VERSION } from '../../lib/paths';

/**
 * Search across every source.
 *
 * Kinds are searched everywhere; property paths need a source, because the
 * property index is built per version and searching every stored version would
 * return the same property once per release.
 */
export function SearchPage(): JSX.Element {
  const api = useApi(kubespecApiRef);
  const { sources } = useKubespecSources();
  const [query, setQuery] = useQueryParam('q');
  const { resourceHref } = useKubespecRoutes();
  const [sourceId, setSourceId] = useState('all');

  const { value, loading, error } = useAsync(async (): Promise<KubespecSearchResponse | undefined> => {
    if (query.trim().length < 2) {
      return undefined;
    }
    return api.search({
      query: query.trim(),
      sourceId: sourceId === 'all' ? undefined : sourceId,
    });
  }, [api, query, sourceId]);

  return (
    <Flex direction="column" gap="4">
      <Text as="h2" variant="title-medium">
        Search
      </Text>

      <Flex gap="2" align="center">
        <SearchField aria-label="Search" placeholder="Search kinds and properties…" value={query} onChange={setQuery} />
        <Select
          name="kubespec-search-source"
          aria-label="Source"
          selectedKey={sourceId}
          onSelectionChange={key => setSourceId(String(key))}
          options={[
            { value: 'all', label: 'Every source' },
            ...sources.map(source => ({ value: source.slug, label: source.name })),
          ]}
        />
      </Flex>

      {query.trim().length < 2 && <Text color="secondary">Type at least two characters.</Text>}
      {loading && <Progress />}
      {error && <ResponseErrorPanel error={error} />}

      {value && (
        <Flex direction="column" gap="4">
          <Flex direction="column" gap="1">
            <Text as="h3" variant="title-small">
              Kinds ({value.resources.length})
            </Text>
            {value.resources.map(hit => (
              <Link
                key={`${hit.sourceSlug}/${hit.apiVersionFull}/${hit.kind}`}
                to={resourceHref({
                  sourceId: hit.sourceSlug,
                  sourceVersion: LATEST_VERSION,
                  group: hit.group,
                  apiVersion: hit.apiVersion,
                  kind: hit.kind,
                })}
              >
                {hit.kind} — {hit.apiVersionFull} · {hit.sourceName} {hit.sourceVersion}
              </Link>
            ))}
            {value.resources.length === 0 && <Text color="secondary">No kinds match.</Text>}
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="h3" variant="title-small">
              Properties ({value.properties.length})
            </Text>
            {value.propertiesFromVersion && (
              <Text variant="body-small" color="secondary">
                Property results are shown from {value.propertiesFromVersion}, the only version with a property index.
              </Text>
            )}
            {sourceId === 'all' && (
              <Text variant="body-small" color="secondary">
                Pick a source to search property paths.
              </Text>
            )}
            {value.properties.map(hit => (
              <Link
                key={`${hit.sourceSlug}/${hit.apiVersionFull}/${hit.kind}${hit.path}`}
                to={`${resourceHref({
                  sourceId: hit.sourceSlug,
                  sourceVersion: LATEST_VERSION,
                  group: hit.group,
                  apiVersion: hit.apiVersion,
                  kind: hit.kind,
                })}#${hit.path}`}
              >
                {hit.kind}
                {hit.path} — {hit.type}
                {hit.isArray ? '[]' : ''}
              </Link>
            ))}
          </Flex>
        </Flex>
      )}
    </Flex>
  );
}

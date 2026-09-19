import { Progress, ResponseErrorPanel } from '@backstage/core-components';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { Flex, Text } from '@backstage/ui';
import { NotFoundError } from '@backstage/errors';
import { useCallback } from 'react';
import { Link } from 'react-router-dom';

import { readKubespecConfig } from '../../config';
import {
  useChangeSummaries,
  useGvkNavigation,
  useKubespecSources,
  useQueryParam,
  useResourceDetail,
  useResourceMetadata,
  useKubespecRoutes,
  useResourceRouteParams,
  useSchemaTree,
} from '../../hooks';
import { LATEST_VERSION } from '../../lib/paths';
import { BackToDefaultSource } from '../BackToDefaultSource';
import { ChangeHistory } from '../ChangeHistory';
import { ExampleList } from '../ExampleList';
import { PropertyTree } from '../PropertyTree';
import { ResourceHeader } from '../ResourceHeader';
import { ResourceLinks } from '../ResourceLinks';
import { ResourceNotFound } from '../ResourceNotFound';

export function ResourcePage(): JSX.Element {
  const params = useResourceRouteParams();
  const configApi = useApi(configApiRef);
  const { contributeUrl } = readKubespecConfig(configApi);
  const { sources } = useKubespecSources();
  const { sourceHref } = useKubespecRoutes();

  const [query, setQuery] = useQueryParam('q');
  const { envelope, definition, loading, error } = useResourceDetail(params);
  const summaries = useChangeSummaries(params, Boolean(envelope));
  const metadata = useResourceMetadata(params, Boolean(envelope));

  const tree = useSchemaTree(definition, params.focusedPath);
  const navigation = useGvkNavigation({
    sourceId: params.sourceId,
    sourceVersion: params.sourceVersion,
    resource: params,
  });

  const copyLink = useCallback((path?: string) => {
    const url = new URL(window.location.href);
    url.hash = path ?? '';
    // Replace rather than push: copying a link is not a navigation, and it should
    // not fill the back button.
    window.history.replaceState(null, '', url.toString());
    void navigator.clipboard?.writeText(url.toString());
  }, []);

  if (loading) {
    return <Progress />;
  }

  if (error) {
    // A kind that is simply absent from this version is an ordinary outcome of
    // switching versions, not a failure — it gets a way forward instead of a
    // stack trace.
    if (error instanceof NotFoundError || error.name === 'NotFoundError') {
      return <ResourceNotFound resource={params} />;
    }
    return <ResponseErrorPanel error={error} />;
  }

  if (!envelope) {
    return <Text>No data.</Text>;
  }

  const source = sources.find(candidate => candidate.slug === params.sourceId);

  return (
    <Flex direction="column" gap="4">
      <Flex gap="4" align="center">
        <Link to={sourceHref(params.sourceId, params.sourceVersion)}>
          ← All kinds in {envelope.sourceName} {envelope.sourceVersion}
        </Link>
        <BackToDefaultSource sourceId={params.sourceId} />
      </Flex>

      <ResourceHeader
        envelope={envelope}
        onCopyLink={() => copyLink()}
        onPinVersion={
          params.sourceVersion === LATEST_VERSION ? () => navigation.pinVersion(envelope.sourceVersion) : undefined
        }
      />

      <PropertyTree tree={tree} scope={envelope.scope} query={query} onQueryChange={setQuery} onCopyLink={copyLink} />

      {summaries.value && summaries.value.length > 0 && (
        <ChangeHistory
          resource={params}
          sourceName={source?.name ?? envelope.sourceName}
          summaries={summaries.value}
          onNavigateToPath={tree.focusPath}
        />
      )}

      <ExampleList kind={envelope.kind} examples={metadata.value?.examples ?? []} contributeUrl={contributeUrl} />
      <ResourceLinks kind={envelope.kind} links={metadata.value?.links ?? []} contributeUrl={contributeUrl} />
    </Flex>
  );
}

import { useApi } from '@backstage/core-plugin-api';
import { ButtonIcon, Flex, Skeleton, Text } from '@backstage/ui';
import SyncIcon from '@material-ui/icons/Sync';
import { useState } from 'react';

import { kubespecApiRef } from '../../api';
import { useGvkNavigation, useKubespecLocation, useKubespecSources, useSourceVersions } from '../../hooks';
import { ScopeFilter, ScopeToggle } from '../ScopeToggle';
import { VersionPicker } from '../VersionPicker';

export interface KubespecToolbarProps {
  defaultSourceId: string;
  /** Absent on routes where a scope filter means nothing, such as search. */
  scope?: ScopeFilter;
  onScopeChange?: (scope: ScopeFilter) => void;
}

interface SyncState {
  pending: boolean;
  message?: string;
  failed?: boolean;
}

/**
 * The version picker, the scope filter and the sync action, on one line.
 *
 * Inside `<Content>` rather than in the Backstage `<Header>`: the header is
 * branded and MUI-themed, and dropping BUI controls into it produces a visible
 * seam against the page gradient.
 *
 * There is no source picker. Sources are chosen from the grid at the foot of the
 * index page, which shows each one's logo and version rather than a bare name in
 * a menu.
 */
export function KubespecToolbar(props: KubespecToolbarProps): JSX.Element | null {
  const api = useApi(kubespecApiRef);
  const { sources, loading, error } = useKubespecSources();
  // Read from the path, not from route params: this component renders beside the
  // router, so `useParams` here sees the plugin's own `/kubespec/*` match and no
  // source or version at all.
  const location = useKubespecLocation();

  const sourceId = location.sourceId ?? props.defaultSourceId;
  const sourceVersion = location.sourceVersion ?? 'latest';
  const source = sources.find(candidate => candidate.slug === sourceId);
  // Scoped to whichever source is open, so the list never offers a version that
  // belongs to a different project.
  const versions = useSourceVersions(sourceId);
  const [sync, setSync] = useState<SyncState>({ pending: false });

  const navigation = useGvkNavigation({
    sourceId,
    sourceVersion,
    // Only a resource route has a kind to carry across a version switch.
    resource: location.resource,
  });

  const triggerSync = async () => {
    setSync({ pending: true });
    try {
      // Forced: re-reads every source rather than skipping the ones whose
      // content has not changed, and the worker starts with whatever has never
      // been ingested at all.
      const result = await api.triggerSync({ force: true });
      setSync({
        pending: false,
        message: result.alreadyRunning
          ? 'A sync is already running. New versions appear once it finishes.'
          : 'Full resync queued, starting with sources that have never been ingested.',
      });
    } catch (syncError) {
      setSync({ pending: false, failed: true, message: (syncError as Error).message });
    }
  };

  if (loading) {
    return <Skeleton />;
  }
  if (error) {
    return (
      <Text variant="body-small" color="danger">
        Could not load the source list: {error.message}
      </Text>
    );
  }
  if (sources.length === 0) {
    return (
      <Text color="secondary">
        Nothing has been ingested yet. Configure sources under `kubespec` in app-config, then trigger a sync.
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="1">
      <Flex gap="4" align="center">
        <Flex gap="2" align="center">
          <Text variant="body-small" color="secondary" id="kubespec-version-label">
            Version
          </Text>
          <VersionPicker
            versions={(versions.value ?? []).map(version => version.version)}
            value={sourceVersion}
            resolvedVersion={source?.latestVersion}
            onChange={navigation.switchVersion}
          />
        </Flex>

        {props.scope && props.onScopeChange && <ScopeToggle value={props.scope} onChange={props.onScopeChange} />}

        <ButtonIcon
          variant="secondary"
          size="small"
          icon={<SyncIcon />}
          isPending={sync.pending}
          aria-label="Force a full resync"
          onPress={triggerSync}
        />
      </Flex>

      {sync.message && (
        // Announced rather than silently appearing: the button's own state says
        // nothing once the request has returned.
        <Text variant="body-small" color={sync.failed ? 'danger' : 'secondary'} role="status">
          {sync.message}
        </Text>
      )}
    </Flex>
  );
}

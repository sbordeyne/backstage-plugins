import { useEffect, useMemo, useRef, useState } from 'react';
import { Content, Header, Page, ResponseErrorPanel, WarningPanel } from '@backstage/core-components';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { Flex } from '@backstage/ui';
import { useRepositoryCoverage } from '../../hooks/useRepositoryCoverage';
import { summarizeCoverage } from '../../lib/coverage';
import { resolveDefaultLanguages } from '../../lib/languages';
import { RepositoryRow } from '../../types';
import { CoveragePanel } from '../CoveragePanel';
import { RepositoriesTable } from '../RepositoriesTable';
import { UncoveredRepositoriesCard } from '../UncoveredRepositoriesCard';

const GENERIC_SUBTITLE = 'Coverage of integrated repositories in the catalog';

/**
 * Names the organizations actually present in the rows, so the page states its own scope without
 * the org having to be configured a second time — it is already implied by the catalog locations.
 */
function describeScope(rows: readonly RepositoryRow[]): string {
  const orgs = Array.from(new Set(rows.map(row => row.org))).sort();
  if (orgs.length === 0) {
    return GENERIC_SUBTITLE;
  }
  const noun = orgs.length > 1 ? 'organizations' : 'organization';
  return `Coverage of integrated repositories of the ${orgs.join(', ')} GitHub ${noun}`;
}

export function IntegratedRepositoriesPage(): JSX.Element {
  const configApi = useApi(configApiRef);
  const {
    rows,
    languageOptions,
    untrackedRepositoryCount,
    inventoryPending,
    ingestionPending,
    enrichmentPending,
    githubEnrichmentAvailable,
    enrichmentError,
    error,
    refreshEnrichment,
  } = useRepositoryCoverage();

  const configuredLanguages = useMemo(
    () => configApi.getOptionalStringArray('integratedRepositories.defaultLanguages') ?? [],
    [configApi],
  );

  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  // Seeded once, so a user clearing the selection is not immediately overridden again.
  const defaultsApplied = useRef(false);

  useEffect(() => {
    if (defaultsApplied.current || enrichmentPending || languageOptions.length === 0) {
      return;
    }
    defaultsApplied.current = true;
    setSelectedLanguages(resolveDefaultLanguages(languageOptions, configuredLanguages));
  }, [enrichmentPending, languageOptions, configuredLanguages]);

  const stats = useMemo(() => summarizeCoverage(rows, selectedLanguages), [rows, selectedLanguages]);
  const pageSubtitle = useMemo(() => describeScope(rows), [rows]);

  if (error) {
    return (
      <Page themeId="tool">
        <Header title="Integrated Repositories" subtitle={pageSubtitle} />
        <Content>
          <ResponseErrorPanel error={error} />
        </Content>
      </Page>
    );
  }

  return (
    <Page themeId="tool">
      <Header title="Integrated Repositories" subtitle={pageSubtitle} />
      <Content>
        <Flex direction="column" gap="4">
          {enrichmentError && (
            <WarningPanel title="GitHub metadata unavailable" message={enrichmentError.message}>
              Repository languages, push dates and root-file detection could not be read from GitHub. The list and the
              coverage figure below still come from the catalog, but languages cannot be selected and uningested
              repositories are reported as unknown.
            </WarningPanel>
          )}

          <CoveragePanel
            stats={stats}
            languageOptions={languageOptions}
            selectedLanguages={selectedLanguages}
            onLanguagesChange={setSelectedLanguages}
            untrackedRepositoryCount={untrackedRepositoryCount}
            ingestionPending={ingestionPending}
            enrichmentPending={enrichmentPending}
            githubEnrichmentAvailable={githubEnrichmentAvailable}
            onRefresh={refreshEnrichment}
          />

          {(enrichmentPending || githubEnrichmentAvailable) && (
            <UncoveredRepositoriesCard rows={rows} selectedLanguages={selectedLanguages} pending={enrichmentPending} />
          )}

          <RepositoriesTable
            rows={rows}
            selectedLanguages={selectedLanguages}
            inventoryPending={inventoryPending}
            ingestionPending={ingestionPending}
            enrichmentPending={enrichmentPending}
          />
        </Flex>
      </Content>
    </Page>
  );
}

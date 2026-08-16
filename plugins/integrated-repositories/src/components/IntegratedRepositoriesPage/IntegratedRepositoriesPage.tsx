import { useEffect, useMemo, useRef, useState } from 'react';
import { Content, Header, Page, ResponseErrorPanel, WarningPanel } from '@backstage/core-components';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { Flex } from '@backstage/ui';
import { readDefaultLanguages, readOrganization } from '../../config';
import { useRepositoryCoverage } from '../../hooks/useRepositoryCoverage';
import { summarizeCoverage } from '../../lib/coverage';
import { resolveDefaultLanguages } from '../../lib/languages';
import { collectKindOptions, collectLanguageOptions, DEFAULT_PERIMETER } from '../../lib/perimeter';
import { Perimeter } from '../../types';
import { CoveragePanel } from '../CoveragePanel';
import { RepositoriesTable } from '../RepositoriesTable';
import { UncoveredRepositoriesCard } from '../UncoveredRepositoriesCard';

function pageSubtitle(organization: string | undefined): string {
  const scope = organization ? `the ${organization} GitHub organization` : 'the GitHub organization';
  return `Coverage of integrated repositories of ${scope}`;
}

export function IntegratedRepositoriesPage(): JSX.Element {
  const configApi = useApi(configApiRef);
  const subtitle = pageSubtitle(readOrganization(configApi));

  const {
    rows,
    inventoryPending,
    ingestionPending,
    enrichmentPending,
    githubEnrichmentAvailable,
    enrichmentError,
    error,
    refreshEnrichment,
  } = useRepositoryCoverage();

  // Active repositories, in every language, until the viewer widens or narrows it.
  const [perimeter, setPerimeter] = useState<Perimeter>(DEFAULT_PERIMETER);
  // Seeded once, so a user clearing the selection is not immediately overridden again.
  const defaultsApplied = useRef(false);

  const languageOptions = useMemo(() => collectLanguageOptions(rows, perimeter), [rows, perimeter]);
  const kindOptions = useMemo(() => collectKindOptions(rows, perimeter), [rows, perimeter]);

  useEffect(() => {
    if (defaultsApplied.current || enrichmentPending || languageOptions.length === 0) {
      return;
    }
    defaultsApplied.current = true;
    const languages = resolveDefaultLanguages(languageOptions, readDefaultLanguages(configApi));
    setPerimeter(current => ({ ...current, languages }));
  }, [configApi, enrichmentPending, languageOptions]);

  const stats = useMemo(() => summarizeCoverage(rows, perimeter), [rows, perimeter]);

  if (error) {
    return (
      <Page themeId="tool">
        <Header title="Integrated Repositories" subtitle={subtitle} />
        <Content>
          <ResponseErrorPanel error={error} />
        </Content>
      </Page>
    );
  }

  return (
    <Page themeId="tool">
      <Header title="Integrated Repositories" subtitle={subtitle} />
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
            kindOptions={kindOptions}
            perimeter={perimeter}
            onPerimeterChange={setPerimeter}
            ingestionPending={ingestionPending}
            enrichmentPending={enrichmentPending}
            githubEnrichmentAvailable={githubEnrichmentAvailable}
            onRefresh={refreshEnrichment}
          />

          {(enrichmentPending || githubEnrichmentAvailable) && (
            <UncoveredRepositoriesCard rows={rows} perimeter={perimeter} pending={enrichmentPending} />
          )}

          <RepositoriesTable
            rows={rows}
            perimeter={perimeter}
            inventoryPending={inventoryPending}
            ingestionPending={ingestionPending}
            enrichmentPending={enrichmentPending}
          />
        </Flex>
      </Content>
    </Page>
  );
}

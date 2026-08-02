import { alertApiRef, useApi } from '@backstage/core-plugin-api';
import { Box, Button, Card, CardBody, CardHeader, Flex, Grid, Select, Skeleton, Text } from '@backstage/ui';
import { formatBaseline } from '../../lib/baseline';
import { describeLanguageSelection } from '../../lib/languages';
import { STATUS_DESCRIPTIONS, STATUS_LABELS } from '../../lib/labels';
import { CoverageStats, IntegrationStatus, LanguageOption } from '../../types';

const LEGEND_STATUSES: IntegrationStatus[] = ['integrated', 'integrated-nested', 'drift', 'not-integrated', 'unknown'];

export interface CoveragePanelProps {
  stats: CoverageStats;
  languageOptions: LanguageOption[];
  selectedLanguages: readonly string[];
  onLanguagesChange: (languages: string[]) => void;
  /** Archived repositories and forks, which the catalog provider does not track at all. */
  untrackedRepositoryCount: number;
  /** The KPI is not meaningful until ingestion is known. */
  ingestionPending: boolean;
  /** Languages are unknown until GitHub enrichment lands. */
  enrichmentPending: boolean;
  githubEnrichmentAvailable: boolean;
  onRefresh: () => void;
}

interface FigureProps {
  label: string;
  value: string;
  pending: boolean;
}

function Figure({ label, value, pending }: FigureProps): JSX.Element {
  return (
    <Flex direction="column" gap="0.5">
      {pending ? (
        <Skeleton width={48} height={28} />
      ) : (
        <Text variant="title-small" weight="bold">
          {value}
        </Text>
      )}
      <Text variant="body-small" color="secondary">
        {label}
      </Text>
    </Flex>
  );
}

/**
 * `@backstage/ui` ships no meter or progress component, so the bar is composed from two boxes.
 * `Box` has no border-radius prop either, hence the inline style; the width is the only genuinely
 * dynamic value, and the height comes from a spacing token. ARIA attributes are added by hand
 * because `Box` forwards unknown props to the DOM, which avoids pulling in a new dependency.
 *
 * The empty `span` is not decoration: `BoxProps.children` is required, so the filled bar needs some
 * child to typecheck.
 */
function CoverageBar({ coveredPercentage }: { coveredPercentage: number }): JSX.Element {
  return (
    <Box
      bg="neutral"
      width="100%"
      height="var(--bui-space-2)"
      style={{ borderRadius: 'var(--bui-radius-full)', overflow: 'hidden' }}
      role="meter"
      aria-label="Repositories integrated into the catalog"
      aria-valuenow={coveredPercentage}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${coveredPercentage} % integrated`}
    >
      <Box bg="success" height="var(--bui-space-2)" style={{ width: `${coveredPercentage}%` }}>
        <span />
      </Box>
    </Box>
  );
}

function StatusLegend(): JSX.Element {
  return (
    <Flex direction="column" gap="1">
      {LEGEND_STATUSES.map(status => (
        <Text key={status} variant="body-small" color="secondary">
          <Text variant="body-small" weight="bold" as="span">
            {STATUS_LABELS[status]}
          </Text>
          {` — ${STATUS_DESCRIPTIONS[status]}`}
        </Text>
      ))}
    </Flex>
  );
}

export function CoveragePanel(props: CoveragePanelProps): JSX.Element {
  const {
    stats,
    languageOptions,
    selectedLanguages,
    onLanguagesChange,
    untrackedRepositoryCount,
    ingestionPending,
    enrichmentPending,
    githubEnrichmentAvailable,
    onRefresh,
  } = props;
  const alertApi = useApi(alertApiRef);

  const copyBaseline = async (): Promise<void> => {
    const baseline = formatBaseline(stats, selectedLanguages, new Date().toISOString().slice(0, 10));

    try {
      // The Clipboard API is absent on insecure origins and rejects when the permission is denied.
      // Either way the baseline still goes in the alert, so the figure is never simply lost.
      await navigator.clipboard.writeText(baseline);
    } catch {
      alertApi.post({ message: `Could not copy to the clipboard. Baseline: ${baseline}`, severity: 'error' });
      return;
    }

    alertApi.post({ message: `Baseline copied: ${baseline}`, severity: 'success', display: 'transient' });
  };

  return (
    <Card>
      <CardHeader>
        <Flex align="center" justify="between" gap="4" style={{ flexWrap: 'wrap' }}>
          <Text variant="title-medium" weight="bold">
            Catalog coverage
          </Text>
          <Flex align="center" gap="2" style={{ flexWrap: 'wrap' }}>
            {enrichmentPending ? (
              <Skeleton width={180} height={32} />
            ) : (
              <Select
                selectionMode="multiple"
                aria-label="Primary languages"
                placeholder="All languages"
                options={languageOptions.map(option => ({
                  id: option.id,
                  label: `${option.label} (${option.repositoryCount})`,
                }))}
                value={selectedLanguages}
                isDisabled={!githubEnrichmentAvailable}
                onChange={value => onLanguagesChange(value.map(String))}
              />
            )}
            <Button variant="tertiary" onPress={onRefresh} isDisabled={enrichmentPending}>
              Refresh
            </Button>
            <Button variant="secondary" onPress={copyBaseline} isDisabled={ingestionPending}>
              Copy baseline
            </Button>
          </Flex>
        </Flex>
      </CardHeader>
      <CardBody>
        <Flex direction="column" gap="4">
          <Flex direction="column" gap="1">
            {ingestionPending ? (
              <Skeleton width={260} height={44} />
            ) : (
              <Text variant="title-large" weight="bold" color={stats.uncoveredPercentage > 0 ? 'danger' : 'success'}>
                {`${stats.uncoveredPercentage} % not integrated`}
              </Text>
            )}
            <Text variant="body-medium" color="secondary">
              {ingestionPending
                ? `Reading the catalog — languages: ${describeLanguageSelection(selectedLanguages)}`
                : `${stats.integrated} of ${stats.total} repositories integrated (${
                    stats.coveredPercentage
                  } % integrated) — languages: ${describeLanguageSelection(selectedLanguages)}`}
            </Text>
          </Flex>

          <CoverageBar coveredPercentage={ingestionPending ? 0 : stats.coveredPercentage} />

          {/* `Flex` cannot wrap, so a responsive grid keeps the figures readable on narrow screens. */}
          <Grid.Root columns={{ initial: '2', md: '5' }} gap="4">
            <Figure label="Not integrated" value={String(stats.notIntegrated)} pending={ingestionPending} />
            <Figure label="Drift" value={String(stats.drift)} pending={ingestionPending || enrichmentPending} />
            <Figure label="Nested only" value={String(stats.nestedOnly)} pending={ingestionPending} />
            {/* Every uningested repository counts as unknown until GitHub says otherwise. */}
            <Figure label="Unknown" value={String(stats.unknown)} pending={ingestionPending || enrichmentPending} />
            <Figure label="Entities registered" value={String(stats.entityCount)} pending={ingestionPending} />
          </Grid.Root>

          <Text variant="body-small" color="secondary">
            {`Archived repositories and forks are excluded by the catalog provider${
              githubEnrichmentAvailable ? ` (${untrackedRepositoryCount} on GitHub)` : ''
            }.`}
          </Text>

          <StatusLegend />
        </Flex>
      </CardBody>
    </Card>
  );
}

import { useMemo } from 'react';
import { Card, CardBody, CardHeader, Flex, Link, Skeleton, Text } from '@backstage/ui';
import { selectUncoveredRepositories } from '../../lib/coverage';
import { formatDate } from '../../lib/labels';
import { IntegrationStatusLabel } from '../IntegrationStatusLabel';
import { RepositoryRow } from '../../types';

const MAX_SUGGESTIONS = 10;
const SKELETON_ROWS = 5;

export interface UncoveredRepositoriesCardProps {
  rows: RepositoryRow[];
  selectedLanguages: readonly string[];
  /** Ranking needs `pushedAt`, which only arrives with GitHub enrichment. */
  pending: boolean;
}

function SuggestionSkeletons(): JSX.Element {
  return (
    <Flex direction="column" gap="2">
      {Array.from({ length: SKELETON_ROWS }, (_unused, index) => (
        <Flex key={index} align="center" justify="between" gap="4">
          <Skeleton width="40%" />
          <Skeleton width={120} />
        </Flex>
      ))}
    </Flex>
  );
}

/** A worklist of what to onboard next, ordered by recent activity with drift first. */
export function UncoveredRepositoriesCard(props: UncoveredRepositoriesCardProps): JSX.Element | null {
  const { rows, selectedLanguages, pending } = props;
  const suggestions = useMemo(
    () => selectUncoveredRepositories(rows, selectedLanguages, MAX_SUGGESTIONS),
    [rows, selectedLanguages],
  );

  if (!pending && suggestions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <Flex direction="column" gap="1">
          <Text variant="title-medium" weight="bold">
            Next repositories to onboard
          </Text>
          <Text variant="body-small" color="secondary">
            Uncovered repositories, most recently pushed first. Drift comes first because the file is already committed.
          </Text>
        </Flex>
      </CardHeader>
      <CardBody>
        {pending ? (
          <SuggestionSkeletons />
        ) : (
          <Flex direction="column" gap="2">
            {suggestions.map(row => (
              <Flex key={row.repo} align="center" justify="between" gap="4">
                <Link href={row.url} variant="body-medium">
                  {row.repo}
                </Link>
                <Flex align="center" gap="4">
                  <IntegrationStatusLabel status={row.status} />
                  <Text variant="body-small" color="secondary">
                    {formatDate(row.pushedAt)}
                  </Text>
                </Flex>
              </Flex>
            ))}
          </Flex>
        )}
      </CardBody>
    </Card>
  );
}

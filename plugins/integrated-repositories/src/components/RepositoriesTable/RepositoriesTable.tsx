import { useMemo, useState } from 'react';
import {
  Button,
  Cell,
  CellText,
  ColumnConfig,
  Flex,
  SearchField,
  Select,
  Skeleton,
  SortDescriptor,
  Switch,
  Table,
  Text,
  useTable,
} from '@backstage/ui';
import { isCovered, isLanguageSelected } from '../../lib/coverage';
import { COVERAGE_FILTER_LABELS, formatDate, STATUS_LABELS } from '../../lib/labels';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { IntegrationStatusLabel } from '../IntegrationStatusLabel';
import { CoverageFilter, IntegrationStatus, RepositoryRow } from '../../types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 150;

/** `useTable` identifies rows by `id`; repository names are unique within an organization. */
interface RepositoryTableItem extends RepositoryRow {
  id: string;
  /** False when the row falls outside the selected languages and is only shown for context. */
  inSelectedLanguages: boolean;
}

interface RepositoryTableFilter {
  coverage: CoverageFilter;
  status: IntegrationStatus | 'all';
}

const DEFAULT_FILTER: RepositoryTableFilter = { coverage: 'all', status: 'all' };

const NO_ROWS: RepositoryTableItem[] = [];

const COVERAGE_OPTIONS: { id: CoverageFilter; label: string }[] = [
  { id: 'all', label: COVERAGE_FILTER_LABELS.all },
  { id: 'integrated', label: COVERAGE_FILTER_LABELS.integrated },
  { id: 'not-integrated', label: COVERAGE_FILTER_LABELS['not-integrated'] },
];

const STATUS_OPTIONS: { id: IntegrationStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Any status' },
  { id: 'integrated', label: STATUS_LABELS.integrated },
  { id: 'integrated-nested', label: STATUS_LABELS['integrated-nested'] },
  { id: 'drift', label: STATUS_LABELS.drift },
  { id: 'not-integrated', label: STATUS_LABELS['not-integrated'] },
  { id: 'unknown', label: STATUS_LABELS.unknown },
];

function describeVisibility(isPrivate: boolean | undefined): string {
  if (isPrivate === undefined) {
    return '—';
  }
  return isPrivate ? 'Private' : 'Public';
}

function compareByColumn(column: string, a: RepositoryTableItem, b: RepositoryTableItem): number {
  switch (column) {
    case 'status':
      return STATUS_LABELS[a.status].localeCompare(STATUS_LABELS[b.status]);
    case 'catalogInfoPath':
      return (a.catalogInfoPaths[0] ?? '').localeCompare(b.catalogInfoPaths[0] ?? '');
    case 'entities':
      return a.entityCount - b.entityCount;
    case 'language':
      return (a.primaryLanguage ?? '').localeCompare(b.primaryLanguage ?? '');
    case 'pushedAt':
      return (a.pushedAt ?? '').localeCompare(b.pushedAt ?? '');
    case 'visibility':
      return describeVisibility(a.isPrivate).localeCompare(describeVisibility(b.isPrivate));
    default:
      return a.repo.localeCompare(b.repo);
  }
}

function sortItems(items: RepositoryTableItem[], sort: SortDescriptor): RepositoryTableItem[] {
  const direction = sort.direction === 'descending' ? -1 : 1;
  return [...items].sort((a, b) => direction * compareByColumn(String(sort.column), a, b));
}

function matchesFilter(item: RepositoryTableItem, filter: RepositoryTableFilter): boolean {
  if (filter.coverage === 'integrated' && !isCovered(item.status)) {
    return false;
  }
  if (filter.coverage === 'not-integrated' && isCovered(item.status)) {
    return false;
  }
  return filter.status === 'all' || item.status === filter.status;
}

/** Column set is built per render so cells can show skeletons while their stage is still loading. */
function buildColumns(
  ingestionPending: boolean,
  enrichmentPending: boolean,
): readonly ColumnConfig<RepositoryTableItem>[] {
  const pendingCell = (
    <Cell>
      <Skeleton width="70%" />
    </Cell>
  );

  return [
    {
      id: 'repo',
      label: 'Repository',
      isRowHeader: true,
      isSortable: true,
      cell: item => (
        <CellText
          title={item.repo}
          href={item.url}
          color={item.inSelectedLanguages ? 'primary' : 'secondary'}
          description={item.inSelectedLanguages ? undefined : 'Outside the selected languages'}
        />
      ),
    },
    {
      id: 'status',
      label: 'Catalog',
      isSortable: true,
      cell: item =>
        ingestionPending ? (
          pendingCell
        ) : (
          <Cell>
            <IntegrationStatusLabel status={item.status} />
          </Cell>
        ),
    },
    {
      id: 'catalogInfoPath',
      label: 'catalog-info.yaml',
      isSortable: true,
      cell: item =>
        ingestionPending ? (
          pendingCell
        ) : (
          <CellText
            title={item.catalogInfoPaths[0] ?? '—'}
            description={item.catalogInfoPaths.length > 1 ? `+${item.catalogInfoPaths.length - 1} more` : undefined}
          />
        ),
    },
    {
      id: 'entities',
      label: 'Entities',
      isSortable: true,
      cell: item =>
        ingestionPending ? (
          pendingCell
        ) : (
          <CellText title={String(item.entityCount)} description={item.entityKinds.join(', ') || undefined} />
        ),
    },
    {
      id: 'language',
      label: 'Language',
      isSortable: true,
      cell: item => (enrichmentPending ? pendingCell : <CellText title={item.primaryLanguage ?? '—'} />),
    },
    {
      id: 'pushedAt',
      label: 'Last push',
      isSortable: true,
      cell: item => (enrichmentPending ? pendingCell : <CellText title={formatDate(item.pushedAt)} />),
    },
    {
      id: 'visibility',
      label: 'Visibility',
      isSortable: true,
      cell: item => (enrichmentPending ? pendingCell : <CellText title={describeVisibility(item.isPrivate)} />),
    },
  ];
}

export interface RepositoriesTableProps {
  rows: RepositoryRow[];
  selectedLanguages: readonly string[];
  inventoryPending: boolean;
  ingestionPending: boolean;
  enrichmentPending: boolean;
}

export function RepositoriesTable(props: RepositoriesTableProps): JSX.Element {
  const { rows, selectedLanguages, inventoryPending, ingestionPending, enrichmentPending } = props;
  const [showOtherLanguages, setShowOtherLanguages] = useState(false);

  // Language scoping is applied to `data` rather than through `filterFn` so that changing the
  // selection always recomputes the table, and `useTable` keeps owning search, sort and pagination.
  const items = useMemo<RepositoryTableItem[]>(
    () =>
      rows
        .map(row => ({ ...row, id: row.repo, inSelectedLanguages: isLanguageSelected(row, selectedLanguages) }))
        .filter(item => showOtherLanguages || item.inSelectedLanguages),
    [rows, selectedLanguages, showOtherLanguages],
  );

  const { tableProps, filter, search } = useTable<RepositoryTableItem, RepositoryTableFilter>({
    mode: 'complete',
    data: items,
    initialSort: { column: 'repo', direction: 'ascending' },
    initialFilter: DEFAULT_FILTER,
    // Every processed row is returned; this component reveals them incrementally on scroll.
    paginationOptions: { type: 'none' },
    searchDebounceMs: SEARCH_DEBOUNCE_MS,
    searchFn: (data, term) => {
      const needle = term.trim().toLowerCase();
      return needle ? data.filter(item => item.repo.toLowerCase().includes(needle)) : data;
    },
    filterFn: (data, value) => data.filter(item => matchesFilter(item, value ?? DEFAULT_FILTER)),
    sortFn: sortItems,
  });

  const activeFilter = filter.value ?? DEFAULT_FILTER;
  // A stable fallback, so the memoised slice below does not invalidate on every render.
  const processed = tableProps.data ?? NO_ROWS;
  const sortDescriptor = tableProps.sort?.descriptor;

  const { visibleCount, sentinelRef, hasMore, showMore } = useInfiniteScroll({
    pageSize: PAGE_SIZE,
    totalCount: processed.length,
    resetKey: [
      search.value,
      activeFilter.coverage,
      activeFilter.status,
      String(sortDescriptor?.column),
      String(sortDescriptor?.direction),
      String(showOtherLanguages),
      selectedLanguages.join(','),
    ].join('|'),
  });

  const columns = useMemo(
    () => buildColumns(ingestionPending, enrichmentPending),
    [ingestionPending, enrichmentPending],
  );
  const visibleRows = useMemo(() => processed.slice(0, visibleCount), [processed, visibleCount]);

  return (
    <Flex direction="column" gap="3">
      <Flex align="end" gap="3" style={{ flexWrap: 'wrap' }}>
        <SearchField
          aria-label="Filter by repository name"
          placeholder="Filter by repository name"
          value={search.value}
          onChange={search.onChange}
        />
        <Select
          aria-label="Catalog integration"
          options={COVERAGE_OPTIONS}
          value={activeFilter.coverage}
          onChange={value => filter.onChange({ ...activeFilter, coverage: value as CoverageFilter })}
        />
        <Select
          aria-label="Detailed status"
          options={STATUS_OPTIONS}
          value={activeFilter.status}
          onChange={value => filter.onChange({ ...activeFilter, status: value as IntegrationStatus | 'all' })}
        />
        {selectedLanguages.length > 0 && (
          <Switch label="Show other languages" isSelected={showOtherLanguages} onChange={setShowOtherLanguages} />
        )}
      </Flex>

      <Table
        {...tableProps}
        aria-label="Repositories and their catalog integration status"
        // Undefined data plus isPending makes Table render its own row skeletons on first load.
        data={inventoryPending ? undefined : visibleRows}
        isPending={inventoryPending}
        isStale={!inventoryPending && (ingestionPending || enrichmentPending)}
        columnConfig={columns}
        emptyState={
          <Text variant="body-medium" color="secondary">
            No repositories match the current filters.
          </Text>
        }
      />

      {!inventoryPending && processed.length > 0 && (
        <Flex direction="column" align="center" gap="2">
          <Text variant="body-small" color="secondary">
            {`Showing ${visibleRows.length} of ${processed.length} repositories`}
          </Text>
          {/*
            The sentinel reveals the next page on scroll. The button is the accessible equivalent and
            the fallback for when no IntersectionObserver fires — for instance if the table's own
            scroll container, which `@backstage/ui` does not expose, scrolls instead of the page.
          */}
          {hasMore && (
            <div ref={sentinelRef}>
              <Button variant="tertiary" onPress={showMore}>
                Show more repositories
              </Button>
            </div>
          )}
        </Flex>
      )}
    </Flex>
  );
}

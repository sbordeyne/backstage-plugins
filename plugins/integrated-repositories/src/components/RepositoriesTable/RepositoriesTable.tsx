import { useMemo, useState } from 'react';
import {
  Button,
  ButtonLink,
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
import { isCovered } from '../../lib/coverage';
import {
  ALL_STATUS_FILTERS,
  AWAITING_SYNC_LABEL,
  formatDate,
  REPOSITORY_KIND_LABELS,
  STATUS_FILTER_LABELS,
  STATUS_LABELS,
} from '../../lib/labels';
import { isInPerimeter } from '../../lib/perimeter';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { IntegrateTemplateLink, useIntegrateTemplateLink } from '../../hooks/useIntegrateTemplateLink';
import { IntegrationStatusLabel } from '../IntegrationStatusLabel';
import { Perimeter, RepositoryKind, RepositoryRow, StatusFilter } from '../../types';
import AddCircleOutline from '@material-ui/icons/AddCircleOutline';
import ArchiveOutlined from '@material-ui/icons/ArchiveOutlined';
import CallSplit from '@material-ui/icons/CallSplit';
import RemoveCircleOutline from '@material-ui/icons/RemoveCircleOutline';
import ScheduleOutlined from '@material-ui/icons/ScheduleOutlined';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 150;

/** `useTable` identifies rows by `id`; repository names are unique within an organization. */
interface RepositoryTableItem extends RepositoryRow {
  id: string;
  /** False when the row falls outside the perimeter and is only shown for context. */
  inPerimeter: boolean;
}

interface RepositoryTableFilter {
  status: StatusFilter;
}

const DEFAULT_FILTER: RepositoryTableFilter = { status: 'all' };

const NO_ROWS: RepositoryTableItem[] = [];

const STATUS_OPTIONS = ALL_STATUS_FILTERS.map(id => ({ id, label: STATUS_FILTER_LABELS[id] }));

function describeVisibility(isPrivate: boolean | undefined): string {
  if (isPrivate === undefined) {
    return '—';
  }
  return isPrivate ? 'Private' : 'Public';
}

type KindIcon = typeof ArchiveOutlined;

/**
 * Active carries no icon on purpose: it is the overwhelming majority, and a mark on almost every row
 * is noise rather than signal. An empty cell reads as "nothing to say about this one".
 */
const KIND_ICONS: Partial<Record<RepositoryKind, KindIcon>> = {
  archived: ArchiveOutlined,
  fork: CallSplit,
  'no-default-branch': RemoveCircleOutline,
};

/**
 * What this repository is, as words. Also the accessible name of the icon that stands for it.
 *
 * A repository with no skip reason and no `Location` is not skipped at all — it was created since the
 * last provider run. That is a genuine gap rather than an exclusion, which is why it is named here
 * but never offered as a perimeter control.
 */
function describeKind(item: RepositoryTableItem): string {
  if (item.providerSkips.length > 0) {
    return item.providerSkips.map(skip => REPOSITORY_KIND_LABELS[skip]).join(', ');
  }
  return item.isTracked ? REPOSITORY_KIND_LABELS.active : AWAITING_SYNC_LABEL;
}

/**
 * The kind as icons, in a column narrow enough to cost nothing on the rows that carry no icon —
 * which is most of them. The label is on the `title`, so hovering and screen readers both get it.
 */
function KindCell({ item }: { item: RepositoryTableItem }): JSX.Element {
  const label = describeKind(item);
  const icons = item.providerSkips.map(skip => KIND_ICONS[skip]).filter((icon): icon is KindIcon => icon !== undefined);

  // Awaiting sync is not a skip, so it has no entry in the map, but it is worth a mark of its own.
  if (!item.isTracked && icons.length === 0) {
    icons.push(ScheduleOutlined);
  }

  return (
    <Cell>
      <span title={label} aria-label={label} style={{ display: 'inline-flex', gap: 'var(--bui-space-1)' }}>
        {icons.map((Icon, index) => (
          <Icon key={index} fontSize="small" />
        ))}
      </span>
    </Cell>
  );
}

/** The onboarding column is not sortable, so it never reaches this function and needs no case. */
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
    case 'kind':
      return describeKind(a).localeCompare(describeKind(b));
    default:
      return a.repo.localeCompare(b.repo);
  }
}

function sortItems(items: RepositoryTableItem[], sort: SortDescriptor): RepositoryTableItem[] {
  const direction = sort.direction === 'descending' ? -1 : 1;
  return [...items].sort((a, b) => direction * compareByColumn(String(sort.column), a, b));
}

/** One control, both granularities: the binary grouping IDP-47 asks for, and each single status. */
function matchesFilter(item: RepositoryTableItem, filter: RepositoryTableFilter): boolean {
  switch (filter.status) {
    case 'all':
      return true;
    case 'covered':
      return isCovered(item.status);
    case 'uncovered':
      return !isCovered(item.status);
    default:
      return item.status === filter.status;
  }
}

/** Column set is built per render so cells can show skeletons while their stage is still loading. */
function buildColumns(
  ingestionPending: boolean,
  enrichmentPending: boolean,
  integrateLink: IntegrateTemplateLink | undefined,
): readonly ColumnConfig<RepositoryTableItem>[] {
  const pendingCell = (
    <Cell>
      <Skeleton width="70%" />
    </Cell>
  );

  const columns: ColumnConfig<RepositoryTableItem>[] = [
    {
      id: 'repo',
      label: 'Repository',
      isRowHeader: true,
      isSortable: true,
      cell: item => (
        <CellText
          title={item.repo}
          href={item.url}
          color={item.inPerimeter ? 'primary' : 'secondary'}
          description={item.inPerimeter ? undefined : 'Outside the perimeter'}
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
      cell: item => {
        if (ingestionPending) {
          return pendingCell;
        }
        // No action for a repository the provider will not walk: a pull request against an archived
        // repository is refused outright, and one merged into a fork or an empty repository still
        // leaves it out of the catalog.
        if (integrateLink && item.status === 'not-integrated' && item.providerSkips.length === 0) {
          return (
            <Cell>
              <Flex justify="center">
                <ButtonLink
                  href={integrateLink(item)}
                  aria-label="Integrate"
                  variant="tertiary"
                  size="small"
                  iconStart={<AddCircleOutline />}
                />
              </Flex>
            </Cell>
          );
        }
        return (
          <CellText
            title={item.catalogInfoPaths[0] ?? '—'}
            description={item.catalogInfoPaths.length > 1 ? `+${item.catalogInfoPaths.length - 1} more` : undefined}
          />
        );
      },
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
    {
      id: 'kind',
      label: '',
      isSortable: true,
      // Icons only, so the column costs a fraction of the width the words did.
      width: 72,
      cell: item => (enrichmentPending ? pendingCell : <KindCell item={item} />),
    },
  ];
  return columns;
}

export interface RepositoriesTableProps {
  rows: RepositoryRow[];
  perimeter: Perimeter;
  inventoryPending: boolean;
  ingestionPending: boolean;
  enrichmentPending: boolean;
}

export function RepositoriesTable(props: RepositoriesTableProps): JSX.Element {
  const { rows, perimeter, inventoryPending, ingestionPending, enrichmentPending } = props;
  const integrateLink = useIntegrateTemplateLink();
  const [showOutsidePerimeter, setShowOutsidePerimeter] = useState(false);

  // The perimeter is applied to `data` rather than through `filterFn` so that changing it always
  // recomputes the table, and `useTable` keeps owning search, sort and pagination.
  const items = useMemo<RepositoryTableItem[]>(
    () =>
      rows
        .map(row => ({ ...row, id: row.repo, inPerimeter: isInPerimeter(row, perimeter) }))
        .filter(item => showOutsidePerimeter || item.inPerimeter),
    [rows, perimeter, showOutsidePerimeter],
  );

  const hasRowsOutsidePerimeter = items.length < rows.length || showOutsidePerimeter;

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
      activeFilter.status,
      String(sortDescriptor?.column),
      String(sortDescriptor?.direction),
      String(showOutsidePerimeter),
      perimeter.languages.join(','),
      perimeter.kinds.join(','),
    ].join('|'),
  });

  const columns = useMemo(
    () => buildColumns(ingestionPending, enrichmentPending, integrateLink),
    [ingestionPending, enrichmentPending, integrateLink],
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
          aria-label="Catalog status"
          options={STATUS_OPTIONS}
          value={activeFilter.status}
          onChange={value => filter.onChange({ status: value as StatusFilter })}
        />
        {hasRowsOutsidePerimeter && (
          <Switch
            label="Show repositories outside the perimeter"
            isSelected={showOutsidePerimeter}
            onChange={setShowOutsidePerimeter}
          />
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

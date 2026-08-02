import { DEFAULT_NAMESPACE, Entity, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { CircularProgress, TextField } from '@material-ui/core';
import Autocomplete from '@material-ui/lab/Autocomplete';
import useAsync from 'react-use/lib/useAsync';

/** Only what the labels and the search need, so the payload stays small. */
const CANDIDATE_FIELDS = ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'spec.profile.displayName'];

interface RecipientCandidates {
  /** Every user and group, sorted by label. */
  entityRefs: string[];
  labels: Map<string, string>;
  /** Lower-cased haystack per ref: the label plus any display name or title. */
  searchText: Map<string, string>;
}

interface RecipientPickerProps {
  value: string[];
  onChange: (entityRefs: string[]) => void;
  disabled?: boolean;
}

/**
 * Picks the users and groups a paste is for.
 *
 * Every user and group is fetched once and filtered in the browser, rather than asking the
 * catalog per keystroke: that is what makes `back` match `group:back-end` in the middle of a
 * name, and what allows the full list to be offered instead of a truncated page of results.
 *
 * Sharing with a group expands to its members when the paste is created, which means the
 * membership at that moment: somebody who joins later cannot be given access afterwards.
 */
export function RecipientPicker({ value, onChange, disabled }: RecipientPickerProps): JSX.Element {
  const catalogApi = useApi(catalogApiRef);
  const { value: candidates, loading, error } = useAsync(() => loadCandidates(catalogApi), [catalogApi]);

  return (
    <Autocomplete
      multiple
      disabled={disabled}
      options={candidates?.entityRefs ?? []}
      value={value}
      loading={loading}
      filterSelectedOptions
      getOptionLabel={entityRef => candidates?.labels.get(entityRef) ?? toLabel(entityRef)}
      filterOptions={(entityRefs, state) =>
        filterRecipients({ entityRefs, term: state.inputValue, searchText: candidates?.searchText })
      }
      onChange={(_event, entityRefs) => onChange(entityRefs as string[])}
      renderInput={params => (
        <TextField
          {...params}
          label="Recipients"
          placeholder="user:alice or group:back-end"
          error={Boolean(error)}
          helperText={
            error
              ? 'Could not load users and groups from the catalog'
              : 'Type user: or group: to narrow the list. Group members are resolved when the paste is created'
          }
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}

async function loadCandidates(catalogApi: typeof catalogApiRef.T): Promise<RecipientCandidates> {
  const { items } = await catalogApi.getEntities({
    filter: [{ kind: 'user' }, { kind: 'group' }],
    fields: CANDIDATE_FIELDS,
  });

  const labels = new Map<string, string>();
  const searchText = new Map<string, string>();
  for (const entity of items) {
    const entityRef = stringifyEntityRef(entity);
    const label = toLabel(entityRef);
    labels.set(entityRef, label);
    searchText.set(entityRef, [label, describe(entity)].join(' ').toLocaleLowerCase('en-US'));
  }

  return {
    entityRefs: [...labels.keys()].sort((left, right) =>
      (labels.get(left) as string).localeCompare(labels.get(right) as string),
    ),
    labels,
    searchText,
  };
}

/**
 * Renders a ref as `user:alice` or `group:back-end`. The kind is always shown, so that both
 * kinds read the same way and so that typing `user:` or `group:` narrows the list.
 */
function toLabel(entityRef: string): string {
  const { kind, namespace, name } = parseEntityRef(entityRef);
  const prefix = kind.toLocaleLowerCase('en-US');
  return namespace.toLocaleLowerCase('en-US') === DEFAULT_NAMESPACE
    ? `${prefix}:${name}`
    : `${prefix}:${namespace}/${name}`;
}

/**
 * Extra text worth searching: a title, or a user's display name.
 *
 * Read defensively rather than through the entity kind: asking the catalog for a subset of
 * fields returns entities with `spec` missing entirely when none of the requested spec
 * fields are set, which the entity types do not express.
 */
function describe(entity: Entity): string {
  const spec = entity.spec as { profile?: { displayName?: string } } | undefined;
  return [entity.metadata.title, spec?.profile?.displayName].filter(Boolean).join(' ');
}

function filterRecipients(options: { entityRefs: string[]; term: string; searchText?: Map<string, string> }): string[] {
  const term = options.term.trim().toLocaleLowerCase('en-US');
  if (!term) {
    return options.entityRefs;
  }
  return options.entityRefs.filter(entityRef => options.searchText?.get(entityRef)?.includes(term));
}

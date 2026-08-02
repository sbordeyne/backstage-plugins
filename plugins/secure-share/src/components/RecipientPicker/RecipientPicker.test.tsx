import { Entity } from '@backstage/catalog-model';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipientPicker } from './RecipientPicker';

function userEntity(name: string, displayName?: string): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'User',
    metadata: { name, namespace: 'default' },
    spec: displayName ? { profile: { displayName } } : {},
  };
}

function groupEntity(name: string, namespace = 'default'): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Group',
    metadata: { name, namespace },
    spec: { type: 'team', children: [] },
  };
}

describe('RecipientPicker', () => {
  const onChange = jest.fn();
  const catalogApi = { getEntities: jest.fn() };

  async function renderPicker(entities: Entity[], value: string[] = []): Promise<void> {
    catalogApi.getEntities.mockResolvedValue({ items: entities });
    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, catalogApi]]}>
        <RecipientPicker value={value} onChange={onChange} />
      </TestApiProvider>,
    );
  }

  async function openList(): Promise<void> {
    await userEvent.click(screen.getByLabelText('Recipients'));
  }

  async function search(term: string): Promise<void> {
    await userEvent.type(screen.getByLabelText('Recipients'), term);
  }

  function shownOptions(): string[] {
    return screen.queryAllByRole('option').map(option => option.textContent ?? '');
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('asks the catalog only for users and groups, once', async () => {
    await renderPicker([userEntity('alice')]);

    await openList();

    expect(catalogApi.getEntities).toHaveBeenCalledTimes(1);
    expect(catalogApi.getEntities).toHaveBeenCalledWith({
      filter: [{ kind: 'user' }, { kind: 'group' }],
      fields: expect.arrayContaining(['kind', 'metadata.name', 'metadata.namespace']),
    });
  });

  it('shows users with a user: prefix, like groups', async () => {
    await renderPicker([userEntity('alice'), groupEntity('back-end')]);

    await openList();

    expect(shownOptions()).toEqual(['group:back-end', 'user:alice']);
  });

  it('sorts the list alphabetically', async () => {
    await renderPicker([userEntity('zoe'), groupEntity('platform'), userEntity('alice'), groupEntity('back-end')]);

    await openList();

    expect(shownOptions()).toEqual(['group:back-end', 'group:platform', 'user:alice', 'user:zoe']);
  });

  it('narrows to groups when the kind is typed', async () => {
    await renderPicker([userEntity('alice'), groupEntity('back-end'), groupEntity('platform')]);

    await search('group:');

    expect(shownOptions()).toEqual(['group:back-end', 'group:platform']);
  });

  it('narrows to users when the kind is typed', async () => {
    await renderPicker([userEntity('alice'), userEntity('zoe'), groupEntity('back-end')]);

    await search('user:');

    expect(shownOptions()).toEqual(['user:alice', 'user:zoe']);
  });

  it('narrows further when a term follows the kind', async () => {
    await renderPicker([groupEntity('back-end'), groupEntity('back-end-admin'), groupEntity('front-end')]);

    await search('group:back');

    expect(shownOptions()).toEqual(['group:back-end', 'group:back-end-admin']);
  });

  it('matches a term anywhere in the name, not just at the start', async () => {
    await renderPicker([
      groupEntity('back-end'),
      groupEntity('back-end-admin'),
      groupEntity('platform'),
      userEntity('backup-owner'),
    ]);

    await search('back');

    expect(shownOptions()).toEqual(['group:back-end', 'group:back-end-admin', 'user:backup-owner']);
  });

  it('matches the middle of a name', async () => {
    await renderPicker([groupEntity('engineering'), groupEntity('platform')]);

    await search('gine');

    expect(shownOptions()).toEqual(['group:engineering']);
  });

  it('matches a display name too', async () => {
    await renderPicker([userEntity('abc123', 'Alice Example'), userEntity('def456', 'Bob Example')]);

    await search('alice');

    expect(shownOptions()).toEqual(['user:abc123']);
  });

  it('ignores case and surrounding whitespace', async () => {
    await renderPicker([groupEntity('back-end'), groupEntity('platform')]);

    await search('  BACK  ');

    expect(shownOptions()).toEqual(['group:back-end']);
  });

  it('offers every match rather than a capped page of them', async () => {
    const groups = Array.from({ length: 25 }, (_, index) => groupEntity(`team-${String(index).padStart(2, '0')}`));
    await renderPicker(groups);

    await openList();

    expect(shownOptions()).toHaveLength(25);
  });

  it('keeps a non default namespace visible, since it is part of the ref', async () => {
    await renderPicker([groupEntity('back-end', 'partners')]);

    await openList();

    expect(shownOptions()).toEqual(['group:partners/back-end']);
  });

  it('reports the canonical entity ref when an option is picked', async () => {
    await renderPicker([userEntity('alice')]);

    await openList();
    await userEvent.click(await screen.findByText('user:alice'));

    expect(onChange).toHaveBeenCalledWith(['user:default/alice']);
  });

  it('hides what has already been picked', async () => {
    await renderPicker([userEntity('alice'), groupEntity('back-end')], ['user:default/alice']);

    await openList();

    expect(shownOptions()).toEqual(['group:back-end']);
  });

  it('handles an entity the catalog returned without a spec, which a field subset can do', async () => {
    await renderPicker([
      { apiVersion: 'backstage.io/v1alpha1', kind: 'User', metadata: { name: 'alice', namespace: 'default' } },
    ]);

    await openList();

    expect(shownOptions()).toEqual(['user:alice']);
  });

  it('says so when the catalog cannot be reached', async () => {
    catalogApi.getEntities.mockRejectedValue(new Error('catalog down'));
    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, catalogApi]]}>
        <RecipientPicker value={[]} onChange={onChange} />
      </TestApiProvider>,
    );

    expect(await screen.findByText('Could not load users and groups from the catalog')).toBeInTheDocument();
  });
});

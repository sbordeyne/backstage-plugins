import { mockCredentials, mockServices } from '@backstage/backend-test-utils';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { RecipientResolver } from './RecipientResolver';

const credentials = mockCredentials.user('user:default/sender');

function userEntity(name: string, displayName?: string): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'User',
    metadata: { name, namespace: 'default' },
    spec: displayName ? { profile: { displayName } } : {},
  };
}

function groupEntity(name: string, options: { members?: string[]; childGroups?: string[] } = {}): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Group',
    metadata: { name, namespace: 'default' },
    spec: { type: 'team', children: [] },
    relations: [
      ...(options.members ?? []).map(targetRef => ({ type: 'hasMember', targetRef })),
      ...(options.childGroups ?? []).map(targetRef => ({ type: 'parentOf', targetRef })),
    ],
  };
}

function catalogOf(entities: Entity[]): typeof catalogServiceRef.T {
  const byRef = new Map(entities.map(entity => [stringifyEntityRef(entity), entity]));
  return {
    getEntitiesByRefs: jest.fn(async (request: { entityRefs: string[] }) => ({
      items: request.entityRefs.map(ref => byRef.get(ref)),
    })),
    // Only getEntitiesByRefs is exercised; the rest of CatalogService is irrelevant here.
  } as unknown as typeof catalogServiceRef.T;
}

describe('RecipientResolver', () => {
  function createResolver(entities: Entity[]): RecipientResolver {
    return RecipientResolver.create({ catalog: catalogOf(entities), logger: mockServices.logger.mock() });
  }

  it('resolves a direct user ref and its display name', async () => {
    const resolver = createResolver([userEntity('alice', 'Alice Example')]);

    const resolved = await resolver.resolve({ entityRefs: ['user:default/alice'] }, { credentials });

    expect(resolved).toEqual({
      users: [
        {
          entityRef: 'user:default/alice',
          displayName: 'Alice Example',
          viaEntityRefs: ['user:default/alice'],
        },
      ],
      unresolvedEntityRefs: [],
    });
  });

  it('expands the members of a group', async () => {
    const resolver = createResolver([
      groupEntity('platform', { members: ['user:default/alice', 'user:default/bob'] }),
      userEntity('alice'),
      userEntity('bob'),
    ]);

    const resolved = await resolver.resolve({ entityRefs: ['group:default/platform'] }, { credentials });

    expect(resolved.users.map(user => user.entityRef)).toEqual(['user:default/alice', 'user:default/bob']);
    expect(resolved.users[0].viaEntityRefs).toEqual(['group:default/platform']);
  });

  it('follows nested groups', async () => {
    const resolver = createResolver([
      groupEntity('engineering', { childGroups: ['group:default/platform'] }),
      groupEntity('platform', { members: ['user:default/alice'] }),
      userEntity('alice'),
    ]);

    const resolved = await resolver.resolve({ entityRefs: ['group:default/engineering'] }, { credentials });

    expect(resolved.users).toEqual([
      { entityRef: 'user:default/alice', displayName: undefined, viaEntityRefs: ['group:default/engineering'] },
    ]);
  });

  it('survives a cycle between groups', async () => {
    const resolver = createResolver([
      groupEntity('a', { members: ['user:default/alice'], childGroups: ['group:default/b'] }),
      groupEntity('b', { childGroups: ['group:default/a'] }),
      userEntity('alice'),
    ]);

    const resolved = await resolver.resolve({ entityRefs: ['group:default/a'] }, { credentials });

    expect(resolved.users).toHaveLength(1);
  });

  it('records every requested ref that led to the same user', async () => {
    const resolver = createResolver([
      groupEntity('platform', { members: ['user:default/alice'] }),
      userEntity('alice'),
    ]);

    const resolved = await resolver.resolve(
      { entityRefs: ['user:default/alice', 'group:default/platform'] },
      { credentials },
    );

    expect(resolved.users[0].viaEntityRefs).toEqual(['user:default/alice', 'group:default/platform']);
  });

  it('reports refs that the catalog does not know', async () => {
    const resolver = createResolver([userEntity('alice')]);

    const resolved = await resolver.resolve(
      { entityRefs: ['user:default/alice', 'user:default/ghost'] },
      { credentials },
    );

    expect(resolved.unresolvedEntityRefs).toEqual(['user:default/ghost']);
    expect(resolved.users).toHaveLength(1);
  });

  it('drops group members that are not User entities', async () => {
    const resolver = createResolver([groupEntity('platform', { members: ['component:default/service'] })]);

    const resolved = await resolver.resolve({ entityRefs: ['group:default/platform'] }, { credentials });

    expect(resolved.users).toEqual([]);
  });

  it('deduplicates and canonicalizes the requested refs', async () => {
    const resolver = createResolver([userEntity('alice')]);

    const resolved = await resolver.resolve(
      { entityRefs: ['user:default/alice', 'User:default/alice'] },
      { credentials },
    );

    expect(resolved.users).toHaveLength(1);
  });

  it('rejects a ref that is neither a user nor a group', async () => {
    const resolver = createResolver([]);

    await expect(resolver.resolve({ entityRefs: ['component:default/service'] }, { credentials })).rejects.toThrow(
      /must be a user: or group: ref/,
    );
  });

  it('rejects an empty recipient list', async () => {
    const resolver = createResolver([]);

    await expect(resolver.resolve({ entityRefs: [] }, { credentials })).rejects.toThrow(/At least one recipient/);
  });

  it('rejects a requested ref whose entity turns out to be another kind', async () => {
    const catalog = {
      getEntitiesByRefs: jest.fn(async () => ({
        items: [
          {
            apiVersion: 'backstage.io/v1alpha1',
            kind: 'Component',
            metadata: { name: 'service', namespace: 'default' },
            spec: {},
          },
        ],
      })),
    } as unknown as typeof catalogServiceRef.T;
    const resolver = RecipientResolver.create({ catalog, logger: mockServices.logger.mock() });

    await expect(resolver.resolve({ entityRefs: ['user:default/service'] }, { credentials })).rejects.toThrow(
      /expected a User or Group/,
    );
  });
});

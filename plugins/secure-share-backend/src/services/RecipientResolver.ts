import { BackstageCredentials, BackstageUserPrincipal, LoggerService } from '@backstage/backend-plugin-api';
import {
  Entity,
  isGroupEntity,
  isUserEntity,
  RELATION_HAS_MEMBER,
  RELATION_PARENT_OF,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { InputError } from '@backstage/errors';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { normalizeRecipientRefs } from '../recipientRefs';

const MAX_GROUP_DEPTH = 10;

/** @public */
export interface ResolvedRecipientUser {
  entityRef: string;
  displayName?: string;
  /** The refs the sender asked for that led to this user, e.g. their groups. */
  viaEntityRefs: string[];
}

/** @public */
export interface ResolvedRecipientUsers {
  users: ResolvedRecipientUser[];
  unresolvedEntityRefs: string[];
}

interface RequestOptions {
  credentials: BackstageCredentials<BackstageUserPrincipal>;
}

/**
 * Turns the user and group refs a sender picked into the concrete list of users
 * that must be able to read a paste.
 *
 * Group membership is expanded at send time, and nested groups are followed. A user
 * who joins a group later is not retroactively given access, because the data key can
 * only be wrapped by the sender, who alone holds it.
 *
 * @public
 */
export class RecipientResolver {
  readonly #catalog: typeof catalogServiceRef.T;
  readonly #logger: LoggerService;

  static create(options: { catalog: typeof catalogServiceRef.T; logger: LoggerService }): RecipientResolver {
    return new RecipientResolver(options.catalog, options.logger);
  }

  private constructor(catalog: typeof catalogServiceRef.T, logger: LoggerService) {
    this.#catalog = catalog;
    this.#logger = logger;
  }

  async resolve(input: { entityRefs: string[] }, options: RequestOptions): Promise<ResolvedRecipientUsers> {
    const requestedRefs = assertNonEmpty(normalizeRecipientRefs(input.entityRefs));
    const viaRefsByUser = new Map<string, Set<string>>();
    const unresolvedEntityRefs: string[] = [];

    const requested = await this.#fetchEntities(requestedRefs, options);
    for (const [ref, entity] of requested) {
      if (!entity) {
        unresolvedEntityRefs.push(ref);
      } else if (isUserEntity(entity)) {
        addVia(viaRefsByUser, stringifyEntityRef(entity), ref);
      } else if (isGroupEntity(entity)) {
        await this.#expandGroup({ group: entity, requestedRef: ref, viaRefsByUser }, options);
      } else {
        throw new InputError(`Recipient '${ref}' is a ${entity.kind}, expected a User or Group`);
      }
    }

    return {
      users: await this.#describeUsers(viaRefsByUser, options),
      unresolvedEntityRefs,
    };
  }

  async #expandGroup(
    input: { group: Entity; requestedRef: string; viaRefsByUser: Map<string, Set<string>> },
    options: RequestOptions,
  ): Promise<void> {
    const visitedGroupRefs = new Set<string>([stringifyEntityRef(input.group)]);
    let currentGroups = [input.group];

    for (let depth = 0; depth < MAX_GROUP_DEPTH && currentGroups.length > 0; depth += 1) {
      const childGroupRefs: string[] = [];
      for (const group of currentGroups) {
        for (const memberRef of relatedRefs(group, RELATION_HAS_MEMBER)) {
          addVia(input.viaRefsByUser, memberRef, input.requestedRef);
        }
        childGroupRefs.push(...relatedRefs(group, RELATION_PARENT_OF).filter(ref => !visitedGroupRefs.has(ref)));
      }
      childGroupRefs.forEach(ref => visitedGroupRefs.add(ref));
      const children = await this.#fetchEntities(childGroupRefs, options);
      currentGroups = [...children.values()].filter((entity): entity is Entity => Boolean(entity));
    }

    if (currentGroups.length > 0) {
      this.#logger.warn(
        `Stopped expanding '${input.requestedRef}' at ${MAX_GROUP_DEPTH} levels of nested groups; ` +
          'deeper members were not given access',
      );
    }
  }

  async #describeUsers(
    viaRefsByUser: Map<string, Set<string>>,
    options: RequestOptions,
  ): Promise<ResolvedRecipientUser[]> {
    const userEntities = await this.#fetchEntities([...viaRefsByUser.keys()], options);
    const users: ResolvedRecipientUser[] = [];
    for (const [entityRef, viaRefs] of viaRefsByUser) {
      const entity = userEntities.get(entityRef);
      if (!entity || !isUserEntity(entity)) {
        this.#logger.warn(`Skipping group member '${entityRef}' which is not a User entity in the catalog`);
        continue;
      }
      users.push({ entityRef, displayName: entity.spec.profile?.displayName, viaEntityRefs: [...viaRefs] });
    }
    return users;
  }

  async #fetchEntities(entityRefs: string[], options: RequestOptions): Promise<Map<string, Entity | undefined>> {
    if (entityRefs.length === 0) {
      return new Map();
    }
    const { items } = await this.#catalog.getEntitiesByRefs({ entityRefs }, options);
    return new Map(entityRefs.map((ref, index) => [ref, items[index]]));
  }
}

function assertNonEmpty(entityRefs: string[]): string[] {
  if (entityRefs.length === 0) {
    throw new InputError('At least one recipient entity ref is required');
  }
  return entityRefs;
}

function relatedRefs(entity: Entity, relationType: string): string[] {
  return (entity.relations ?? [])
    .filter(relation => relation.type === relationType)
    .map(relation => relation.targetRef);
}

function addVia(viaRefsByUser: Map<string, Set<string>>, userEntityRef: string, requestedRef: string): void {
  const viaRefs = viaRefsByUser.get(userEntityRef) ?? new Set<string>();
  viaRefs.add(requestedRef);
  viaRefsByUser.set(userEntityRef, viaRefs);
}

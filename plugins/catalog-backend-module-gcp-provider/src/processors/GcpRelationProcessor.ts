import { Config } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { Entity, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { CatalogProcessor, CatalogProcessorEmit, processingResult } from '@backstage/plugin-catalog-node';
import { google } from 'googleapis';
import { GcpAssetIndex } from '../iam';
import type { GcpAssetIndexFactory } from '../providers/GcpEntityProviderBase';
import { createGoogleAuth } from '../googleAuth';
import { GcpRefBuilder } from './GcpRefBuilder';
import {
  classifyRole,
  IamRelationKind,
  RelationMode,
  relationForRole,
  relationForStructure,
  STRUCTURAL_RELATIONS,
} from '../relations';
import { ANNOTATION_GCP_PROJECT_ID, ANNOTATION_GCP_SERVICE_ACCOUNT } from '../constants';
import { CONFIG_KEY_BY_TYPE } from '../resourceTypes';

/**
 * Emits the relation types the catalog has no spec field for.
 *
 * A provider can only express `dependsOn`; anything else — `accessorOf`, `publishedToBy`,
 * `attachedTo` — has to be emitted as a relation directly, which only a processor can do. The
 * processor's own documentation notes that an emitted relation need not touch the entity being
 * processed, so both directions of each pair are written here in one place.
 *
 * Two sources feed it:
 *
 * - **IAM**, read off a service account entity. Its grants are already in the shared asset index,
 *   so the roles it holds become typed relations to the resources it holds them on.
 * - **Structural edges**, carried on `spec.gcpRelations` by the providers that know a resource is
 *   contained in or attached to another.
 *
 * With `relations: builtin` the providers emit plain `dependsOn` and this processor has nothing to
 * do, which is the default.
 */
export class GcpRelationProcessor implements CatalogProcessor {
  private readonly refs: GcpRefBuilder;
  /** Logger, also handed to the ref builder so its warnings carry the same context. */
  /**
   * Everything below is resolved once in the constructor rather than per call.
   *
   * `postProcessEntity` runs for every entity in the catalog, not only this module's, so anything
   * a getter did there was done tens of thousands of times per processing pass — including, in the
   * case of the asset index, building a fresh `GoogleAuth` and Cloud Asset client.
   */
  private readonly gcpConfig: Config;
  private readonly assetIndex: GcpAssetIndexFactory;

  constructor(config: Config, private readonly logger: LoggerService, assetIndex?: GcpAssetIndexFactory) {
    this.gcpConfig = config.getConfig('catalog.providers.gcp');
    this.refs = new GcpRefBuilder(this.gcpConfig, logger);
    // Resolved on first use, not here: the processor is registered unconditionally, and in
    // `builtin` mode — the default — it never reads a policy at all.
    let own: GcpAssetIndex | undefined;
    this.assetIndex =
      assetIndex ??
      (() =>
        (own ??= new GcpAssetIndex(google.cloudasset({ version: 'v1', auth: createGoogleAuth(logger) }), logger, {
          cacheTtlMs: (this.gcpConfig.getOptionalNumber('iam.cacheTtlSeconds') ?? 600) * 1000,
          maxBindings: this.gcpConfig.getOptionalNumber('iam.maxBindingsPerProject') ?? 20000,
        })));
  }

  getProcessorName(): string {
    return 'GcpRelationProcessor';
  }

  /** Emits both halves of one relation, since a custom type has no automatic reverse. */
  private emitPair(
    emit: CatalogProcessorEmit,
    sourceRef: string,
    targetRef: string,
    pair: { forward: string; reverse: string },
  ): void {
    const source = parseEntityRef(sourceRef);
    const target = parseEntityRef(targetRef);
    emit(processingResult.relation({ source, type: pair.forward, target }));
    emit(processingResult.relation({ source: target, type: pair.reverse, target: source }));
  }

  /**
   * The vocabulary the provider that ingested this entity emits.
   *
   * Read from that provider's own config block rather than from the shared key alone, so a provider
   * set to `relations: gcp` under a `builtin` default has its structural edges converted here
   * instead of silently discarded. An entity this module did not ingest matches no provider and
   * falls back to the shared setting, which leaves both emitters below no-ops for it.
   */
  private modeFor(entity: Entity): RelationMode {
    const type = typeof entity.spec?.type === 'string' ? entity.spec.type : undefined;
    return this.refs.relationModeFor(type ? CONFIG_KEY_BY_TYPE.get(type) : undefined);
  }

  async postProcessEntity(entity: Entity, _location: unknown, emit: CatalogProcessorEmit): Promise<Entity> {
    if (this.modeFor(entity) === 'gcp') {
      const selfRef = stringifyEntityRef(entity);
      this.emitStructural(entity, selfRef, emit);
      await this.emitIamRelations(entity, selfRef, emit);
    }
    // Stripped whichever mode applies: the field is transport for this processor, and an entity
    // still carrying it has either been read here or was never going to be.
    return stripGcpRelations(entity);
  }

  /** Containment and attachment, as the provider recorded them on the entity. */
  private emitStructural(entity: Entity, selfRef: string, emit: CatalogProcessorEmit): void {
    const declared = (entity.spec as { gcpRelations?: { type?: string; targetRef?: string }[] } | undefined)
      ?.gcpRelations;
    for (const relation of declared ?? []) {
      const kind = relation.type as keyof typeof STRUCTURAL_RELATIONS;
      if (!relation.targetRef || !STRUCTURAL_RELATIONS[kind]) {
        continue;
      }
      try {
        this.emitPair(emit, selfRef, relation.targetRef, relationForStructure(kind, 'gcp'));
      } catch (error) {
        this.logger.warn(`Ignoring ${kind} relation to '${relation.targetRef}' on ${selfRef}`, error as Error);
      }
    }
  }

  /**
   * The access edges for a service account entity, one relation per resource it holds a role on.
   *
   * A resource reached under several roles gets the strongest verb the account holds on it rather
   * than one relation per role: `adminOf` and `readerOf` on the same bucket says nothing more than
   * `adminOf` does.
   */
  private async emitIamRelations(entity: Entity, selfRef: string, emit: CatalogProcessorEmit): Promise<void> {
    const email = entity.metadata.annotations?.[ANNOTATION_GCP_SERVICE_ACCOUNT];
    const projectId = entity.metadata.annotations?.[ANNOTATION_GCP_PROJECT_ID];
    if (!email || !projectId || entity.spec?.type !== 'google-service-account') {
      return;
    }

    const member = `serviceAccount:${email}`;
    const projects = this.refs.allConfiguredProjects();
    const byTarget = new Map<string, string>();

    for (const project of projects) {
      const policies = await this.assetIndex().policiesOf(project);
      for (const grant of policies.grantsByMember.get(member) ?? []) {
        if (!this.refs.roleWanted(grant.role)) {
          continue;
        }
        // The grant's own project, not the account's: an account routinely holds roles on resources
        // in other projects, and each of those entities is named after the project it lives in.
        const targetRef = this.refs.refForAsset(grant.assetName, grant.assetType, grant.project ?? project);
        if (!targetRef) {
          continue;
        }
        // Roles are ordered by how much they permit, so the first one wins on ties.
        const existing = byTarget.get(targetRef);
        if (!existing || rank(grant.role) < rank(existing)) {
          byTarget.set(targetRef, grant.role);
        }
      }
    }

    for (const [targetRef, role] of byTarget) {
      try {
        this.emitPair(emit, selfRef, targetRef, relationForRole(role, 'gcp'));
      } catch (error) {
        this.logger.warn(`Ignoring ${role} relation to '${targetRef}' on ${selfRef}`, error as Error);
      }
    }
  }
}

/**
 * The entity without the `gcpRelations` field the provider used to carry structural edges here.
 *
 * It is transport, not data: once the relations are emitted it has done its job, and leaving it on
 * the entity shows a non-standard spec field to anyone reading the raw YAML.
 */
function stripGcpRelations(entity: Entity): Entity {
  if (!entity.spec || !('gcpRelations' in entity.spec)) {
    return entity;
  }
  const { gcpRelations, ...spec } = entity.spec as { gcpRelations?: unknown };
  void gcpRelations;
  return { ...entity, spec };
}

/** Roles ordered by how much they permit, so one verb can be chosen per resource. */
const ROLE_STRENGTH: IamRelationKind[] = [
  'admin',
  'writer',
  'encrypter',
  'publisher',
  'subscriber',
  'invoker',
  'client',
  'accessor',
  'reader',
  'user',
];

function rank(role: string): number {
  const index = ROLE_STRENGTH.indexOf(classifyRole(role));
  return index < 0 ? ROLE_STRENGTH.length : index;
}

import { Config } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { Entity, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { CatalogProcessor, CatalogProcessorEmit, processingResult } from '@backstage/plugin-catalog-node';
import { google } from 'googleapis';
import { GcpAssetIndex, getAssetIndex } from '../iam';
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

  constructor(
    private readonly config: Config,
    private readonly logger: LoggerService,
    private readonly assetIndex?: GcpAssetIndex,
  ) {
    this.refs = new GcpRefBuilder(this.gcpConfig);
  }

  getProcessorName(): string {
    return 'GcpRelationProcessor';
  }

  private get gcpConfig(): Config {
    return this.config.getConfig('catalog.providers.gcp');
  }

  private get mode(): RelationMode {
    return this.gcpConfig.getOptionalString('iam.relations') === 'gcp' ? 'gcp' : 'builtin';
  }

  private get index(): GcpAssetIndex {
    return (
      this.assetIndex ??
      getAssetIndex(google.cloudasset({ version: 'v1', auth: createGoogleAuth(this.logger) }), this.logger, {
        cacheTtlMs: (this.gcpConfig.getOptionalNumber('iam.cacheTtlSeconds') ?? 600) * 1000,
        maxBindings: this.gcpConfig.getOptionalNumber('iam.maxBindingsPerProject') ?? 20000,
      })
    );
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

  async postProcessEntity(entity: Entity, _location: unknown, emit: CatalogProcessorEmit): Promise<Entity> {
    if (this.mode !== 'gcp') {
      return entity;
    }

    const selfRef = stringifyEntityRef(entity);
    this.emitStructural(entity, selfRef, emit);
    await this.emitIamRelations(entity, selfRef, emit);
    return entity;
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
      const policies = await this.index.policiesOf(project);
      for (const grant of policies.grantsByMember.get(member) ?? []) {
        if (!this.refs.roleWanted(grant.role)) {
          continue;
        }
        const targetRef = this.refs.refForAsset(grant.assetName, grant.assetType, projectId);
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

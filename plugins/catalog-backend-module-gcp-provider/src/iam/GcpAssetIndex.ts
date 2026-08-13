import { LoggerService } from '@backstage/backend-plugin-api';
import { cloudasset_v1 } from 'googleapis';
import { isPermanentlyEmpty } from '../utils';
import { parseMember } from './members';

/** One grant: a role held by somebody on one asset. */
export interface GcpIamGrant {
  /** Asset the role is held on, e.g. `//storage.googleapis.com/projects/_/buckets/reports`. */
  assetName: string;
  /** Cloud Asset Inventory type, e.g. `storage.googleapis.com/Bucket`. */
  assetType: string;
  role: string;
  /** Title of the IAM condition attached to the binding, when there is one. */
  condition?: string;
}

/** A Kubernetes service account allowed to impersonate a Google one through Workload Identity. */
export interface GcpWorkloadIdentityBinding {
  /** Identity pool, e.g. `prod.svc.id.goog`. */
  pool: string;
  /** Project owning the pool, which is the project the cluster runs in. */
  poolProject: string;
  /** Kubernetes namespace of the service account. */
  namespace: string;
  /** Kubernetes service account name. */
  ksa: string;
  /** Google service account it may impersonate. */
  gsaEmail: string;
  /** Project of that Google service account. */
  gsaProject: string;
}

/** Everything one project's policies say, indexed for the questions the providers ask. */
export interface GcpProjectPolicies {
  /** Grants held by each member, keyed by the raw member string. */
  grantsByMember: Map<string, GcpIamGrant[]>;
  /** Members holding each role on each asset, keyed by asset name. */
  membersByAsset: Map<string, { role: string; members: string[] }[]>;
  /** Roles held at the project level, which grant access without naming a resource. */
  projectRolesByMember: Map<string, string[]>;
  /** Workload Identity bindings found on service accounts in this project. */
  workloadIdentity: GcpWorkloadIdentityBinding[];
  /** True when the sweep stopped at the configured cap, so the maps are incomplete. */
  truncated: boolean;
}

export interface GcpAssetIndexOptions {
  /** How long a project's sweep is reused before it is fetched again. */
  cacheTtlMs: number;
  /** Most policy results to read from one project. */
  maxBindings: number;
}

const EMPTY_POLICIES: GcpProjectPolicies = {
  grantsByMember: new Map(),
  membersByAsset: new Map(),
  projectRolesByMember: new Map(),
  workloadIdentity: [],
  truncated: false,
};

/** Project-level policies name the project itself as the asset. */
const PROJECT_ASSET_TYPE = 'cloudresourcemanager.googleapis.com/Project';
/** The role whose members are Kubernetes service accounts rather than people or machines. */
const WORKLOAD_IDENTITY_ROLE = 'roles/iam.workloadIdentityUser';
/** Page size for the sweep; the API caps it at 500. */
const PAGE_SIZE = 500;

/**
 * IAM policies for every resource in a project, read once and shared.
 *
 * Cloud Asset Inventory answers with every policy in a project in one paginated call, which is what
 * makes IAM affordable here: the alternative is one `getIamPolicy` per resource, which is what the
 * Pub/Sub and Secret Manager providers used to do.
 *
 * Providers refresh on independent schedules, so the sweep is cached by project and in-flight
 * requests are shared — thirty providers waking within the TTL of each other cost one call, not
 * thirty.
 */
export class GcpAssetIndex {
  private readonly cache = new Map<string, { expiresAt: number; policies: Promise<GcpProjectPolicies> }>();

  constructor(
    private readonly client: cloudasset_v1.Cloudasset,
    private readonly logger: LoggerService,
    private readonly options: GcpAssetIndexOptions,
  ) {}

  /**
   * The policies of one project.
   *
   * A project whose Cloud Asset API is disabled, or that the credentials cannot read, yields empty
   * policies rather than an error: IAM enrichment is worth degrading, not worth failing a refresh
   * that would otherwise ingest every resource in the estate.
   */
  async policiesOf(projectId: string): Promise<GcpProjectPolicies> {
    const cached = this.cache.get(projectId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.policies;
    }

    const policies = this.sweep(projectId).catch(error => {
      // A project with the Cloud Asset API switched off is the normal state of an installation that
      // has not opted into IAM, so it is reported as information rather than as a problem. Anything
      // else is worth a warning, though never worth failing the refresh over.
      const message = `No IAM policies for project ${projectId}, continuing without them`;
      if (isPermanentlyEmpty(error)) {
        this.logger.info(`${message} (enable cloudasset.googleapis.com and grant roles/cloudasset.viewer)`);
      } else {
        this.logger.warn(message, error as Error);
      }
      // Cache the empty result too, so the project is not retried by every provider that wakes up.
      return EMPTY_POLICIES;
    });

    this.cache.set(projectId, { expiresAt: Date.now() + this.options.cacheTtlMs, policies });
    return policies;
  }

  /** Drops cached sweeps, for tests and for a forced refresh. */
  clear(): void {
    this.cache.clear();
  }

  private async sweep(projectId: string): Promise<GcpProjectPolicies> {
    const policies: GcpProjectPolicies = {
      grantsByMember: new Map(),
      membersByAsset: new Map(),
      projectRolesByMember: new Map(),
      workloadIdentity: [],
      truncated: false,
    };

    let pageToken: string | undefined;
    let read = 0;

    do {
      const { data } = await this.client.v1.searchAllIamPolicies({
        scope: `projects/${projectId}`,
        pageSize: PAGE_SIZE,
        pageToken,
      });

      for (const result of data.results ?? []) {
        if (read >= this.options.maxBindings) {
          policies.truncated = true;
          this.logger.warn(
            `Stopped reading IAM policies for project ${projectId} at ${this.options.maxBindings} results; ` +
              `raise iam.maxBindings to see the rest`,
          );
          return policies;
        }
        read += 1;
        this.absorb(result, policies);
      }

      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);

    this.logger.info(`Read ${read} IAM policies for project ${projectId}`);
    return policies;
  }

  /** Files one policy result into each of the indexes that will be asked about it. */
  private absorb(result: cloudasset_v1.Schema$IamPolicySearchResult, policies: GcpProjectPolicies): void {
    const assetName = result.resource;
    const assetType = result.assetType ?? '';
    if (!assetName) {
      return;
    }

    for (const binding of result.policy?.bindings ?? []) {
      const role = binding.role;
      const members = (binding.members ?? []).filter((member): member is string => Boolean(member));
      if (!role || members.length === 0) {
        continue;
      }

      const isProjectLevel = assetType === PROJECT_ASSET_TYPE;
      const byAsset = policies.membersByAsset.get(assetName) ?? [];
      byAsset.push({ role, members });
      policies.membersByAsset.set(assetName, byAsset);

      for (const member of members) {
        if (role === WORKLOAD_IDENTITY_ROLE) {
          this.absorbWorkloadIdentity(member, assetName, policies);
        }

        if (isProjectLevel) {
          const roles = policies.projectRolesByMember.get(member) ?? [];
          roles.push(role);
          policies.projectRolesByMember.set(member, roles);
          continue;
        }

        const grants = policies.grantsByMember.get(member) ?? [];
        grants.push({
          assetName,
          assetType,
          role,
          ...(binding.condition?.title ? { condition: binding.condition.title } : {}),
        });
        policies.grantsByMember.set(member, grants);
      }
    }
  }

  /**
   * A `workloadIdentityUser` binding read as the Kubernetes-to-GCP bridge it is.
   *
   * The asset carrying the binding is the Google service account, and the member names the
   * Kubernetes one, so a single binding gives both halves of the link.
   */
  private absorbWorkloadIdentity(member: string, assetName: string, policies: GcpProjectPolicies): void {
    const parsed = parseMember(member);
    if (parsed.kind !== 'workloadIdentity') {
      return;
    }
    const gsaEmail = assetName.split('/').pop() ?? '';
    if (!gsaEmail.includes('@')) {
      return;
    }
    policies.workloadIdentity.push({
      pool: parsed.pool,
      poolProject: parsed.poolProject,
      namespace: parsed.namespace,
      ksa: parsed.ksa,
      gsaEmail,
      gsaProject: gsaEmail.split('@')[1]?.split('.')[0] ?? '',
    });
  }
}

let sharedIndex: GcpAssetIndex | undefined;

/**
 * The index shared by every provider in this backend.
 *
 * Providers construct themselves independently and all authenticate the same way, so the first one
 * to ask supplies the client; the rest reuse it and, with it, its cache. Options come from the
 * first caller as well — they are read from `catalog.providers.gcp.iam`, which is shared
 * configuration, so per-provider divergence is not a case worth complicating this for.
 */
export function getAssetIndex(
  client: cloudasset_v1.Cloudasset,
  logger: LoggerService,
  options: GcpAssetIndexOptions,
): GcpAssetIndex {
  if (!sharedIndex) {
    sharedIndex = new GcpAssetIndex(client, logger, options);
  }
  return sharedIndex;
}

/** Drops the shared index, so tests start from a clean cache. */
export function resetAssetIndex(): void {
  sharedIndex = undefined;
}

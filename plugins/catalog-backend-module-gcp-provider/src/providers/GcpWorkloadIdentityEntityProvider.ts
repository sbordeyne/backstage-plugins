import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { container_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_KSA_NAMESPACE, ANNOTATION_GCP_WORKLOAD_IDENTITY_POOL } from '../constants';
import { GcpWorkloadIdentityBinding } from '../iam';

/**
 * Kubernetes service accounts, discovered through Workload Identity.
 *
 * This is the bridge the whole graph hangs off. A `roles/iam.workloadIdentityUser` binding on a
 * Google service account names the Kubernetes account allowed to impersonate it, so the link
 * between a workload running in GKE and the GCP resources it can reach is readable from IAM alone —
 * no cluster credentials, no Kubernetes API call.
 *
 * A Component attaches to the graph by depending on one of these:
 *
 * ```yaml
 * spec:
 *   dependsOn: [resource:default/prod-auth-authsa]   # <poolProject>-<namespace>-<ksa>
 * ```
 */
export class GcpWorkloadIdentityEntityProvider extends GcpRestEntityProvider<container_v1.Container> {
  getProviderName(): string {
    return 'gcp-workload-identity';
  }

  getProviderConfigKey(): string {
    return 'workload-identity';
  }

  getClient(): container_v1.Container {
    return google.container({ version: 'v1', auth: this.googleAuth });
  }

  /**
   * Refs of the clusters whose workloads can use a given identity pool.
   *
   * A pool belongs to a project, not to a cluster, so every Workload-Identity-enabled cluster in
   * that project is a place the Kubernetes account could be running. Naming one of them would be a
   * guess; naming all of them is what the API actually tells us.
   */
  private async clusterRefsByPool(project: string): Promise<Map<string, string[]>> {
    const { data } = await this.client.projects.locations.clusters.list({
      parent: `projects/${project}/locations/-`,
    });
    const byPool = new Map<string, string[]>();
    for (const cluster of data.clusters ?? []) {
      const pool = cluster.workloadIdentityConfig?.workloadPool;
      if (!pool || !cluster.name || !this.includesLocation(cluster.location)) {
        continue;
      }
      const ref = this.resourceRef('clusters', {
        projectId: project,
        type: 'kubernetes-cluster',
        provider: 'gcp-clusters',
        region: cluster.location ?? undefined,
        name: cluster.name,
      });
      if (ref) {
        byPool.set(pool, [...(byPool.get(pool) ?? []), ref]);
      }
    }
    return byPool;
  }

  private toKsaEntity(
    key: string,
    bindings: GcpWorkloadIdentityBinding[],
    clusterRefs: Map<string, string[]>,
  ): DeferredEntity | undefined {
    const [first] = bindings;
    const accounts = [...new Set(bindings.map(binding => binding.gsaEmail))];
    // The binding names the project of the Google account, which is the answer for the agent
    // accounts whose email does not carry one.
    const gsaRefs = [
      ...new Set(bindings.map(binding => this.serviceAccountRef(binding.gsaEmail, binding.gsaProject))),
    ];

    return this.toEntity(
      {
        name: key,
        projectId: first.poolProject,
        type: 'kubernetes-service-account',
        title: `${first.namespace}/${first.ksa}`,
        summary: `Kubernetes service account ${first.namespace}/${first.ksa}, impersonating ${accounts.join(', ')}`,
        // Workload Identity has no resource of its own; the pool membership is the identity.
        consolePath: `iam-admin/serviceaccounts?supportedpurview=project`,
        docsUrl: 'https://cloud.google.com/kubernetes-engine/docs/concepts/workload-identity',
        tagValues: [first.namespace],
        annotations: {
          [ANNOTATION_GCP_WORKLOAD_IDENTITY_POOL]: first.pool,
          [ANNOTATION_GCP_KSA_NAMESPACE]: first.namespace,
        },
      },
      { dependsOn: [...gsaRefs, ...(clusterRefs.get(first.pool) ?? [])] },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    if (!this.iamOptions.enabled) {
      this.logger.info('IAM is disabled, so no Workload Identity bindings can be read');
      return [];
    }
    const index = this.assetIndex;

    return this.forEachProject(async project => {
      const [policies, clusterRefs] = await Promise.all([index.policiesOf(project), this.clusterRefsByPool(project)]);

      // One Kubernetes account may impersonate several Google ones, so bindings are grouped rather
      // than turned into an entity each.
      const byAccount = new Map<string, GcpWorkloadIdentityBinding[]>();
      for (const binding of policies.workloadIdentity) {
        const key = `${binding.poolProject}-${binding.namespace}-${binding.ksa}`;
        byAccount.set(key, [...(byAccount.get(key) ?? []), binding]);
      }

      return [...byAccount.entries()]
        .map(([key, bindings]) => this.toKsaEntity(key, bindings, clusterRefs))
        .filter(entity => entity !== undefined);
    });
  }
}

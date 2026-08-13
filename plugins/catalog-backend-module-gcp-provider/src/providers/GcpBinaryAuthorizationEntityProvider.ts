import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { binaryauthorization_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, lastSegment } from '../utils';

/**
 * Binary Authorization: the project's deploy policy, and the attestors it trusts.
 *
 * There is exactly one policy per project, so the entity is named after the project rather than
 * after the resource, which has no name of its own.
 */
export class GcpBinaryAuthorizationEntityProvider extends GcpRestEntityProvider<binaryauthorization_v1.Binaryauthorization> {
  getProviderName(): string {
    return 'gcp-binaryauthorization';
  }

  getProviderConfigKey(): string {
    return 'binaryauthorization';
  }

  getClient(): binaryauthorization_v1.Binaryauthorization {
    return google.binaryauthorization({ version: 'v1', auth: this.googleAuth });
  }

  private policyToResource(policy: binaryauthorization_v1.Schema$Policy, project: string): DeferredEntity {
    const rule = policy.defaultAdmissionRule?.evaluationMode ?? 'ALWAYS_ALLOW';
    const clusterRules = Object.keys(policy.clusterAdmissionRules ?? {});

    return this.toEntity({
      name: `${project}-binauthz-policy`,
      projectId: project,
      type: 'binauthz-policy',
      title: 'Binary Authorization policy',
      description: policy.description,
      summary: `Default admission rule ${rule.toLocaleLowerCase().replace(/_/g, ' ')}, with ${
        clusterRules.length
      } cluster-specific rule(s)`,
      selfLink: apiSelfLink('binaryauthorization.googleapis.com', 'v1', `projects/${project}/policy`),
      consolePath: 'security/binary-authorization/policy',
      tagValues: [rule, policy.globalPolicyEvaluationMode],
    });
  }

  private attestorToResource(
    attestor: binaryauthorization_v1.Schema$Attestor,
    project: string,
  ): DeferredEntity | undefined {
    const attestorId = lastSegment(attestor.name);
    if (!attestorId) {
      return undefined;
    }
    const keys = attestor.userOwnedGrafeasNote?.publicKeys?.length ?? 0;

    return this.toEntity({
      name: attestorId,
      projectId: project,
      type: 'binauthz-attestor',
      description: attestor.description,
      summary: `Attestor with ${keys} public key(s)`,
      selfLink: apiSelfLink('binaryauthorization.googleapis.com', 'v1', attestor.name),
      consolePath: 'security/binary-authorization/attestors',
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const [policy, attestors] = await Promise.all([
        this.client.projects.getPolicy({ name: `projects/${project}/policy` }),
        this.listAll<binaryauthorization_v1.Schema$Attestor>(async pageToken => {
          const { data } = await this.client.projects.attestors.list({ parent: `projects/${project}`, pageToken });
          return { items: data.attestors, nextPageToken: data.nextPageToken };
        }),
      ]);

      return [
        this.policyToResource(policy.data, project),
        ...attestors.map(attestor => this.attestorToResource(attestor, project)),
      ].filter(entity => entity !== undefined);
    });
  }
}

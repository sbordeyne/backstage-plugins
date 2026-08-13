import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';

/** Cloud Armor security policies, which sit in front of backend services. */
export class GcpArmorEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-armor';
  }

  getProviderConfigKey(): string {
    return 'armor';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  private policyToResource(policy: compute_v1.Schema$SecurityPolicy, project: string): DeferredEntity | undefined {
    if (!policy.name) {
      return undefined;
    }
    // The default rule is always present and always last; the rest are what somebody configured.
    const configuredRules = (policy.rules ?? []).filter(rule => rule.priority !== 2147483647);
    const adaptive = policy.adaptiveProtectionConfig?.layer7DdosDefenseConfig?.enable;

    return this.toEntity({
      name: policy.name,
      projectId: project,
      type: 'security-policy',
      selfLink: policy.selfLink,
      labels: policy.labels,
      description: policy.description,
      summary: `Cloud Armor policy with ${configuredRules.length} rule(s)${
        adaptive ? ', adaptive protection enabled' : ''
      }`,
      consolePath: `net-security/securitypolicies/details/${policy.name}`,
      tagValues: [policy.type, adaptive ? 'adaptive-protection' : undefined],
      annotations: {
        'cloud.google.com/armor-rules': String(configuredRules.length),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const policies = await this.listAll<compute_v1.Schema$SecurityPolicy>(
        async pageToken => (await this.client.securityPolicies.list({ project, pageToken })).data,
      );
      return policies.map(policy => this.policyToResource(policy, project)).filter(entity => entity !== undefined);
    });
  }
}

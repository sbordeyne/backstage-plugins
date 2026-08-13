import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';

/**
 * VPC firewall rules.
 *
 * A project with a long-lived network can hold hundreds of these, so this provider is worth
 * enabling deliberately rather than by default.
 */
export class GcpFirewallEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-firewall';
  }

  getProviderConfigKey(): string {
    return 'firewall';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  /** `tcp:443, udp:53` — what the rule actually opens or closes, for the description. */
  private static ports(rules: compute_v1.Schema$Firewall['allowed']): string {
    return (rules ?? [])
      .map(rule => (rule.ports?.length ? `${rule.IPProtocol}:${rule.ports.join(',')}` : rule.IPProtocol ?? ''))
      .filter(Boolean)
      .join(', ');
  }

  private firewallToResource(firewall: compute_v1.Schema$Firewall, project: string): DeferredEntity | undefined {
    if (!firewall.name) {
      return undefined;
    }
    const action = firewall.denied?.length ? 'denies' : 'allows';
    const ports = GcpFirewallEntityProvider.ports(firewall.denied?.length ? firewall.denied : firewall.allowed);
    const direction = (firewall.direction ?? 'INGRESS').toLocaleLowerCase();

    return this.toEntity(
      {
        name: firewall.name,
        projectId: project,
        type: 'firewall-rule',
        selfLink: firewall.selfLink,
        description: firewall.description,
        summary: `${firewall.disabled ? 'Disabled rule that' : 'Rule that'} ${action} ${direction} ${
          ports || 'traffic'
        } at priority ${firewall.priority ?? 1000}`,
        consolePath: `networking/firewalls/details/${firewall.name}`,
        tagValues: [direction, firewall.disabled ? 'disabled' : 'enabled', action],
        annotations: {
          'cloud.google.com/firewall-priority': String(firewall.priority ?? 1000),
        },
      },
      { dependsOn: [this.vpcRef(firewall.network, project)] },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const firewalls = await this.listAll<compute_v1.Schema$Firewall>(
        async pageToken => (await this.client.firewalls.list({ project, pageToken })).data,
      );
      return firewalls
        .map(firewall => this.firewallToResource(firewall, project))
        .filter(entity => entity !== undefined);
    });
  }
}

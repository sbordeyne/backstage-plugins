import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { dns_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';

/** Cloud DNS managed zones. */
export class GcpDnsEntityProvider extends GcpRestEntityProvider<dns_v1.Dns> {
  getProviderName(): string {
    return 'gcp-dns';
  }

  getProviderConfigKey(): string {
    return 'dns';
  }

  getClient(): dns_v1.Dns {
    return google.dns({ version: 'v1', auth: this.googleAuth });
  }

  private zoneToResource(zone: dns_v1.Schema$ManagedZone, project: string): DeferredEntity | undefined {
    if (!zone.name) {
      return undefined;
    }
    const visibility = zone.visibility ?? 'public';
    // A private zone is resolvable only from the networks it is bound to, which is a real
    // dependency rather than a detail.
    const networks = (zone.privateVisibilityConfig?.networks ?? [])
      .map(network => network.networkUrl)
      .filter((url): url is string => Boolean(url));

    return this.toEntity(
      {
        name: zone.name,
        projectId: project,
        type: 'dns-zone',
        selfLink: `https://dns.googleapis.com/dns/v1/projects/${project}/managedZones/${zone.name}`,
        labels: zone.labels,
        description: zone.description,
        summary: `${visibility === 'private' ? 'Private' : 'Public'} DNS zone for ${
          zone.dnsName ?? 'an unnamed domain'
        }`,
        consolePath: `net-services/dns/zones/${zone.name}`,
        tagValues: [visibility, zone.dnssecConfig?.state === 'on' ? 'dnssec' : undefined],
        annotations: {
          'cloud.google.com/dns-name': zone.dnsName ?? '',
        },
      },
      { dependsOn: networks.map(network => this.vpcRef(network, project)) },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const zones = await this.listAll<dns_v1.Schema$ManagedZone>(async pageToken => {
        const { data } = await this.client.managedZones.list({ project, pageToken });
        return { items: data.managedZones, nextPageToken: data.nextPageToken };
      });
      return zones.map(zone => this.zoneToResource(zone, project)).filter(entity => entity !== undefined);
    });
  }
}

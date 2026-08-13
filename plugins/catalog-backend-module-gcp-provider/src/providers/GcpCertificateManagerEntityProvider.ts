import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { certificatemanager_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/**
 * Certificate Manager certificates and maps.
 *
 * The expiry date is the reason these are worth cataloguing: it is the one attribute of a
 * certificate that will eventually cause an incident, and it belongs where the on-call can see it.
 */
export class GcpCertificateManagerEntityProvider extends GcpRestEntityProvider<certificatemanager_v1.Certificatemanager> {
  getProviderName(): string {
    return 'gcp-certificatemanager';
  }

  getProviderConfigKey(): string {
    return 'certificatemanager';
  }

  getClient(): certificatemanager_v1.Certificatemanager {
    return google.certificatemanager({ version: 'v1', auth: this.googleAuth });
  }

  private certificateToResource(
    certificate: certificatemanager_v1.Schema$Certificate,
    project: string,
  ): DeferredEntity | undefined {
    const certificateId = lastSegment(certificate.name);
    if (!certificateId) {
      return undefined;
    }
    const region = segmentAfter(certificate.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const domains = certificate.sanDnsnames ?? certificate.managed?.domains ?? [];
    const expires = certificate.expireTime ? new Date(certificate.expireTime).toISOString().slice(0, 10) : undefined;
    const managed = Boolean(certificate.managed);

    return this.toEntity({
      name: certificateId,
      projectId: project,
      type: 'certificate',
      region,
      selfLink: apiSelfLink('certificatemanager.googleapis.com', 'v1', certificate.name),
      labels: certificate.labels,
      description: certificate.description,
      summary: `${managed ? 'Google-managed' : 'Self-managed'} certificate for ${
        domains.length ? domains.join(', ') : 'an unreported domain'
      }${expires ? `, expiring ${expires}` : ''}`,
      consolePath: `security/ccm/list/certificates`,
      tagValues: [managed ? 'managed' : 'self-managed', certificate.managed?.state],
      annotations: {
        ...(expires ? { 'cloud.google.com/certificate-expiry': expires } : {}),
        ...(domains.length ? { 'cloud.google.com/certificate-domains': domains.join(',') } : {}),
      },
    });
  }

  private mapToResource(
    certificateMap: certificatemanager_v1.Schema$CertificateMap,
    project: string,
  ): DeferredEntity | undefined {
    const mapId = lastSegment(certificateMap.name);
    if (!mapId) {
      return undefined;
    }
    const region = segmentAfter(certificateMap.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    // The map records which load balancers reference it, which is the relation worth having, but
    // as opaque target descriptions rather than resource names — so it stays an annotation.
    const targets = (certificateMap.gclbTargets ?? [])
      .map(target => target.ipConfigs?.map(config => config.ipAddress).join(',') ?? '')
      .filter(Boolean);

    return this.toEntity({
      name: mapId,
      projectId: project,
      type: 'certificate-map',
      region,
      selfLink: apiSelfLink('certificatemanager.googleapis.com', 'v1', certificateMap.name),
      labels: certificateMap.labels,
      description: certificateMap.description,
      summary: `Certificate map serving ${targets.length} load balancer target(s)`,
      consolePath: `security/ccm/list/certificateMaps`,
      annotations: {
        ...(targets.length ? { 'cloud.google.com/lb-targets': targets.join(';') } : {}),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const parent = `projects/${project}/locations/-`;
      const [certificates, maps] = await Promise.all([
        this.listAll<certificatemanager_v1.Schema$Certificate>(async pageToken => {
          const { data } = await this.client.projects.locations.certificates.list({ parent, pageToken });
          return { items: data.certificates, nextPageToken: data.nextPageToken };
        }),
        this.listAll<certificatemanager_v1.Schema$CertificateMap>(async pageToken => {
          const { data } = await this.client.projects.locations.certificateMaps.list({ parent, pageToken });
          return { items: data.certificateMaps, nextPageToken: data.nextPageToken };
        }),
      ]);

      return [
        ...certificates.map(certificate => this.certificateToResource(certificate, project)),
        ...maps.map(certificateMap => this.mapToResource(certificateMap, project)),
      ].filter(entity => entity !== undefined);
    });
  }
}

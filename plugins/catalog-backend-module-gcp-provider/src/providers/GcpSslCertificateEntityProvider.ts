import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';

/**
 * Classic SSL certificates attached to load balancers.
 *
 * Certificate Manager certificates are a separate resource type, ingested by its own provider; this
 * one covers the `compute` certificates a load balancer references directly.
 */
export class GcpSslCertificateEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-sslcertificates';
  }

  getProviderConfigKey(): string {
    return 'sslcertificates';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  private certificateToResource(
    certificate: compute_v1.Schema$SslCertificate,
    scope: string,
    project: string,
  ): DeferredEntity | undefined {
    if (!certificate.name) {
      return undefined;
    }
    const global = scope === 'global';
    const managed = certificate.type === 'MANAGED';
    const domains = certificate.managed?.domains ?? [];
    // Expiry is the fact worth surfacing: a certificate is the thing in a load balancer most likely
    // to break on a date nobody remembers.
    const expires = certificate.expireTime ? new Date(certificate.expireTime).toISOString().slice(0, 10) : undefined;

    return this.toEntity({
      name: global ? certificate.name : `${certificate.name}-${scope}`,
      projectId: project,
      type: 'ssl-certificate',
      region: global ? undefined : scope,
      selfLink: certificate.selfLink,
      title: certificate.name,
      description: certificate.description,
      summary: `${managed ? 'Google-managed' : 'Self-managed'} certificate for ${
        domains.length ? domains.join(', ') : 'an unreported domain'
      }${expires ? `, expiring ${expires}` : ''}`,
      consolePath: `security/ccm/list/lbCertificates`,
      tagValues: [managed ? 'managed' : 'self-managed', ...domains],
      annotations: {
        ...(expires ? { 'cloud.google.com/certificate-expiry': expires } : {}),
        ...(domains.length ? { 'cloud.google.com/certificate-domains': domains.join(',') } : {}),
        ...(certificate.managed?.status ? { [ANNOTATION_GCP_STATUS]: certificate.managed.status } : {}),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const certificates = await this.listAggregated<
        compute_v1.Schema$SslCertificate,
        compute_v1.Schema$SslCertificatesScopedList
      >(
        async pageToken => (await this.client.sslCertificates.aggregatedList({ project, pageToken })).data,
        scoped => scoped.sslCertificates,
      );
      return certificates
        .map(({ item, scope }) => this.certificateToResource(item, scope, project))
        .filter(entity => entity !== undefined);
    });
  }
}

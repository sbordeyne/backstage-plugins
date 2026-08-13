import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { cloudkms_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/**
 * KMS key rings and the crypto keys on them.
 *
 * Keys are among the most useful things in the access graph: a service account holding
 * `roles/cloudkms.cryptoKeyEncrypterDecrypter` on a key is a dependency in the strongest sense —
 * without it the workload cannot read its own data.
 */
export class GcpKmsEntityProvider extends GcpRestEntityProvider<cloudkms_v1.Cloudkms> {
  getProviderName(): string {
    return 'gcp-kms';
  }

  getProviderConfigKey(): string {
    return 'kms';
  }

  getClient(): cloudkms_v1.Cloudkms {
    return google.cloudkms({ version: 'v1', auth: this.googleAuth });
  }

  private keyToResource(
    key: cloudkms_v1.Schema$CryptoKey,
    ringId: string,
    region: string | undefined,
    project: string,
    ringRef: string,
  ): DeferredEntity | undefined {
    const keyId = lastSegment(key.name);
    if (!keyId) {
      return undefined;
    }
    const purpose = (key.purpose ?? 'ENCRYPT_DECRYPT').toLocaleLowerCase().replace(/_/g, ' ');
    const rotation = key.rotationPeriod ? `, rotating every ${key.rotationPeriod}` : ', no rotation schedule';

    return this.toEntity(
      {
        // Key names are unique per ring, not per project.
        name: `${ringId}-${keyId}`,
        projectId: project,
        type: 'kms-key',
        region,
        selfLink: apiSelfLink('cloudkms.googleapis.com', 'v1', key.name),
        labels: key.labels,
        title: keyId,
        summary: `KMS key for ${purpose} on ring ${ringId}${rotation}`,
        consolePath: `security/kms/key/manage/${region}/${ringId}/${keyId}`,
        assetName: `//cloudkms.googleapis.com/${key.name}`,
        tagValues: [key.purpose, key.primary?.algorithm, key.primary?.protectionLevel],
        annotations: {
          ...(key.nextRotationTime ? { 'cloud.google.com/next-rotation': key.nextRotationTime } : {}),
        },
      },
      { dependsOn: [ringRef] },
    );
  }

  private async ringToResources(ring: cloudkms_v1.Schema$KeyRing, project: string): Promise<DeferredEntity[]> {
    const ringId = lastSegment(ring.name);
    if (!ringId) {
      return [];
    }
    const region = segmentAfter(ring.name, 'locations');
    if (!this.includesLocation(region)) {
      return [];
    }

    const ringRef = this.ownRef({
      projectId: project,
      type: 'kms-key-ring',
      provider: this.getProviderName(),
      region,
      name: ringId,
    });

    const keys = await this.listAll<cloudkms_v1.Schema$CryptoKey>(async pageToken => {
      const { data } = await this.client.projects.locations.keyRings.cryptoKeys.list({
        parent: ring.name!,
        pageToken,
      });
      return { items: data.cryptoKeys, nextPageToken: data.nextPageToken };
    });

    const ringEntity = this.toEntity({
      name: ringId,
      projectId: project,
      type: 'kms-key-ring',
      region,
      selfLink: apiSelfLink('cloudkms.googleapis.com', 'v1', ring.name),
      summary: `KMS key ring in ${region ?? 'an unreported location'} holding ${keys.length} key(s)`,
      consolePath: `security/kms/keyring/manage/${region}/${ringId}`,
      assetName: `//cloudkms.googleapis.com/${ring.name}`,
    });

    return [
      ringEntity,
      ...keys
        .map(key => this.keyToResource(key, ringId, region, project, ringRef))
        .filter(entity => entity !== undefined),
    ];
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const rings = await this.listAll<cloudkms_v1.Schema$KeyRing>(async pageToken => {
        const { data } = await this.client.projects.locations.keyRings.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.keyRings, nextPageToken: data.nextPageToken };
      });
      const entities = await Promise.all(
        rings.filter(ring => ring.name).map(ring => this.ringToResources(ring, project)),
      );
      return entities.flat();
    });
  }
}

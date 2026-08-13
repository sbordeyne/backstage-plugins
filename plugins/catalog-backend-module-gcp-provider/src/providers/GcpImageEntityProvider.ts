import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';

/**
 * Custom Compute Engine images.
 *
 * Only images owned by the configured projects are listed. The public image projects
 * (`debian-cloud`, `ubuntu-os-cloud` and the rest) hold thousands of images that belong to Google
 * rather than to anyone's catalog, so they are never enumerated even if configured.
 */
export class GcpImageEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-images';
  }

  getProviderConfigKey(): string {
    return 'images';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  /** Whether deprecated and obsolete images are ingested. Defaults to false — they pile up. */
  private get includeDeprecated(): boolean {
    return this.config.getOptionalBoolean('includeDeprecated') ?? false;
  }

  private imageToResource(image: compute_v1.Schema$Image, project: string): DeferredEntity | undefined {
    if (!image.name) {
      return undefined;
    }
    const deprecation = image.deprecated?.state;
    if (deprecation && !this.includeDeprecated) {
      return undefined;
    }

    return this.toEntity({
      name: image.name,
      projectId: project,
      type: 'compute-image',
      selfLink: image.selfLink,
      labels: image.labels,
      description: image.description,
      summary: `${image.diskSizeGb ? `${image.diskSizeGb}GB ` : ''}custom image${
        image.family ? ` in family ${image.family}` : ''
      }${deprecation ? `, ${deprecation.toLocaleLowerCase()}` : ''}`,
      consolePath: `compute/imagesDetail/projects/${project}/global/images/${image.name}`,
      tagValues: [image.family, image.architecture, deprecation],
      annotations: {
        ...(image.family ? { 'cloud.google.com/image-family': image.family } : {}),
        ...(image.status ? { [ANNOTATION_GCP_STATUS]: image.status } : {}),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const images = await this.listAll<compute_v1.Schema$Image>(
        async pageToken => (await this.client.images.list({ project, pageToken })).data,
      );
      return images.map(image => this.imageToResource(image, project)).filter(entity => entity !== undefined);
    });
  }
}

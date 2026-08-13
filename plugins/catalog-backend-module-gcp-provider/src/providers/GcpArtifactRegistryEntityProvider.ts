import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { artifactregistry_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/** Artifact Registry repositories. */
export class GcpArtifactRegistryEntityProvider extends GcpRestEntityProvider<artifactregistry_v1.Artifactregistry> {
  getProviderName(): string {
    return 'gcp-artifactregistry';
  }

  getProviderConfigKey(): string {
    return 'artifactregistry';
  }

  getClient(): artifactregistry_v1.Artifactregistry {
    return google.artifactregistry({ version: 'v1', auth: this.googleAuth });
  }

  private repositoryToResource(
    repository: artifactregistry_v1.Schema$Repository,
    project: string,
  ): DeferredEntity | undefined {
    const repositoryId = lastSegment(repository.name);
    if (!repositoryId) {
      return undefined;
    }
    const region = segmentAfter(repository.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const format = (repository.format ?? 'DOCKER').toLocaleLowerCase();
    const mode = (repository.mode ?? 'STANDARD_REPOSITORY').toLocaleLowerCase().replace(/_repository$/, '');

    return this.toEntity({
      name: repositoryId,
      projectId: project,
      type: 'artifact-repository',
      region,
      selfLink: apiSelfLink('artifactregistry.googleapis.com', 'v1', repository.name),
      labels: repository.labels,
      description: repository.description,
      summary: `${mode} ${format} repository in ${region ?? 'an unreported region'}`,
      // The console groups repositories by format, e.g. `artifacts/docker/my-project/...`.
      consolePath: `artifacts/${format}/${project}/${region}/${repositoryId}`,
      tagValues: [format, mode],
      annotations: {
        ...(repository.registryUri ? { 'cloud.google.com/registry-uri': repository.registryUri } : {}),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const repositories = await this.listAll<artifactregistry_v1.Schema$Repository>(async pageToken => {
        const { data } = await this.client.projects.locations.repositories.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.repositories, nextPageToken: data.nextPageToken };
      });
      return repositories
        .map(repository => this.repositoryToResource(repository, project))
        .filter(entity => entity !== undefined);
    });
  }
}

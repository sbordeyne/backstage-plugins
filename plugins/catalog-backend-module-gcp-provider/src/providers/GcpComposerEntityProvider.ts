import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { composer_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { LINK_TYPE_WEBSITE } from '../links';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/** Cloud Composer environments, with a link straight into their Airflow UI. */
export class GcpComposerEntityProvider extends GcpRestEntityProvider<composer_v1.Composer> {
  getProviderName(): string {
    return 'gcp-composer';
  }

  getProviderConfigKey(): string {
    return 'composer';
  }

  getClient(): composer_v1.Composer {
    return google.composer({ version: 'v1', auth: this.googleAuth });
  }

  private environmentToResource(
    environment: composer_v1.Schema$Environment,
    project: string,
  ): DeferredEntity | undefined {
    const environmentId = lastSegment(environment.name);
    if (!environmentId) {
      return undefined;
    }
    const region = segmentAfter(environment.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const config = environment.config;
    const airflow = config?.airflowUri;
    // The DAG bucket is a real dependency: it is where the workflows themselves live.
    const dagBucket = config?.dagGcsPrefix?.replace(/^gs:\/\//, '').split('/')[0];

    return this.toEntity(
      {
        name: environmentId,
        projectId: project,
        type: 'composer-environment',
        region,
        selfLink: apiSelfLink('composer.googleapis.com', 'v1', environment.name),
        labels: environment.labels,
        summary: `Composer environment running Airflow ${
          config?.softwareConfig?.imageVersion ?? 'at an unreported version'
        } in ${region ?? 'an unreported region'}`,
        consolePath: `composer/environments/detail/${region}/${environmentId}/monitoring`,
        logFilter: `resource.type="cloud_composer_environment" resource.labels.environment_name="${environmentId}"`,
        tagValues: [environment.state, config?.softwareConfig?.imageVersion],
        links: airflow ? [{ url: airflow, title: 'Airflow UI', icon: 'web', type: LINK_TYPE_WEBSITE }] : [],
        annotations: {
          ...(environment.state ? { [ANNOTATION_GCP_STATUS]: environment.state } : {}),
          ...(dagBucket ? { 'cloud.google.com/dag-bucket': dagBucket } : {}),
        },
      },
      {
        dependsOn: [
          ...(config?.nodeConfig?.network ? [this.vpcRef(config.nodeConfig.network, project)] : []),
          ...(config?.nodeConfig?.subnetwork ? [this.subnetRef(config.nodeConfig.subnetwork, project)] : []),
          ...(dagBucket
            ? [
                this.resourceRef('storage', {
                  projectId: project,
                  type: 'bucket',
                  provider: 'gcp-bucket',
                  name: dagBucket,
                }),
              ]
            : []),
        ],
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const environments = await this.listAll<composer_v1.Schema$Environment>(async pageToken => {
        const { data } = await this.client.projects.locations.environments.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.environments, nextPageToken: data.nextPageToken };
      });
      return environments
        .map(environment => this.environmentToResource(environment, project))
        .filter(entity => entity !== undefined);
    });
  }
}

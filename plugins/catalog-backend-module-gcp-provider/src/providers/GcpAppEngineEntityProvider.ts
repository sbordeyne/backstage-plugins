import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { appengine_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { LINK_TYPE_WEBSITE } from '../links';
import { lastSegment } from '../utils';

/**
 * App Engine services.
 *
 * Versions are deliberately left out: a long-lived App Engine app accumulates them indefinitely,
 * and the service is the thing that is deployed, owned and depended on.
 */
export class GcpAppEngineEntityProvider extends GcpRestEntityProvider<appengine_v1.Appengine> {
  getProviderName(): string {
    return 'gcp-appengine';
  }

  getProviderConfigKey(): string {
    return 'appengine';
  }

  getClient(): appengine_v1.Appengine {
    return google.appengine({ version: 'v1', auth: this.googleAuth });
  }

  private serviceToResource(service: appengine_v1.Schema$Service, project: string): DeferredEntity | undefined {
    const serviceId = service.id ?? lastSegment(service.name);
    if (!serviceId) {
      return undefined;
    }
    // Traffic splits name the versions currently serving, which is the useful state of a service.
    const versions = Object.keys(service.split?.allocations ?? {});

    return this.toEntity({
      name: serviceId,
      projectId: project,
      type: 'appengine-service',
      selfLink: `https://appengine.googleapis.com/v1/apps/${project}/services/${serviceId}`,
      labels: service.labels,
      summary: `App Engine service serving ${versions.length} version(s)`,
      consolePath: `appengine/versions?serviceId=${serviceId}`,
      logFilter: `resource.type="gae_app" resource.labels.module_id="${serviceId}"`,
      links: [
        {
          url:
            serviceId === 'default'
              ? `https://${project}.appspot.com`
              : `https://${serviceId}-dot-${project}.appspot.com`,
          title: 'Service URL',
          icon: 'web',
          type: LINK_TYPE_WEBSITE,
        },
      ],
      annotations: {
        ...(versions.length ? { 'cloud.google.com/serving-versions': versions.join(',') } : {}),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const services = await this.listAll<appengine_v1.Schema$Service>(async pageToken => {
        const { data } = await this.client.apps.services.list({ appsId: project, pageToken });
        return { items: data.services, nextPageToken: data.nextPageToken };
      });
      return services.map(service => this.serviceToResource(service, project)).filter(entity => entity !== undefined);
    });
  }
}

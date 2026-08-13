import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_MACHINE_TYPE, ANNOTATION_GCP_STATUS } from '../constants';
import { lastSegment } from '../utils';

/**
 * Compute Engine instances.
 *
 * Instances come and go far faster than the rest of the estate, and every refresh applies a full
 * mutation, so an autoscaled fleet churns the catalog. `states` narrows the listing to the
 * instances worth cataloguing, and a longer `schedule` is the usual companion to it.
 */
export class GcpComputeInstanceEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-instances';
  }

  getProviderConfigKey(): string {
    return 'instances';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  /** Instance states to ingest, defaulting to all of them. */
  private get states(): string[] | undefined {
    const states = this.config.getOptionalStringArray('states');
    return states && states.length > 0 ? states.map(state => state.toLocaleUpperCase()) : undefined;
  }

  private instanceToResource(
    instance: compute_v1.Schema$Instance,
    zone: string,
    project: string,
  ): DeferredEntity | undefined {
    if (!instance.name) {
      return undefined;
    }
    const states = this.states;
    if (states && !states.includes((instance.status ?? '').toLocaleUpperCase())) {
      return undefined;
    }
    const machineType = lastSegment(instance.machineType);
    const nic = instance.networkInterfaces?.[0];
    const serviceAccounts = (instance.serviceAccounts ?? [])
      .map(account => account.email)
      .filter((email): email is string => Boolean(email));

    return this.toEntity(
      {
        name: instance.name,
        projectId: project,
        // The zone is the honest location of an instance; the region is its prefix.
        region: zone,
        type: 'compute-instance',
        selfLink: instance.selfLink,
        labels: instance.labels,
        description: instance.description,
        summary: `${machineType || 'Compute Engine'} instance in ${zone}, ${(
          instance.status ?? 'unknown state'
        ).toLocaleLowerCase()}`,
        consolePath: `compute/instancesDetail/zones/${zone}/instances/${instance.name}`,
        logFilter: `resource.type="gce_instance" resource.labels.instance_id="${instance.id ?? instance.name}"`,
        tagValues: [
          machineType,
          instance.status,
          instance.scheduling?.provisioningModel === 'SPOT' ? 'spot' : undefined,
        ],
        annotations: {
          ...(machineType ? { [ANNOTATION_GCP_MACHINE_TYPE]: machineType } : {}),
          ...(instance.status ? { [ANNOTATION_GCP_STATUS]: instance.status } : {}),
        },
      },
      {
        dependsOn: [
          ...(nic?.subnetwork ? [this.subnetRef(nic.subnetwork, project)] : []),
          ...serviceAccounts.map(email => this.serviceAccountRef(email)),
        ],
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const instances = await this.listAggregated<compute_v1.Schema$Instance, compute_v1.Schema$InstancesScopedList>(
        async pageToken => (await this.client.instances.aggregatedList({ project, pageToken })).data,
        scoped => scoped.instances,
      );
      return instances
        .map(({ item, scope }) => this.instanceToResource(item, scope, project))
        .filter(entity => entity !== undefined);
    });
  }
}

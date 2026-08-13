import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { lastSegment, parseResourceUrl } from '../utils';

/**
 * Persistent disks and snapshots.
 *
 * Both churn the way instances do — a disk per instance, a snapshot per backup run — so this
 * provider is worth enabling deliberately, on a slow schedule, rather than by default.
 */
export class GcpDiskEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-disks';
  }

  getProviderConfigKey(): string {
    return 'disks';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  /** Whether snapshots are ingested alongside the disks. Defaults to false — they accumulate. */
  private get includeSnapshots(): boolean {
    return this.config.getOptionalBoolean('includeSnapshots') ?? false;
  }

  private diskToResource(disk: compute_v1.Schema$Disk, scope: string, project: string): DeferredEntity | undefined {
    if (!disk.name) {
      return undefined;
    }
    // A disk is attached to at most one instance in practice; the relation is what makes it useful.
    const users = (disk.users ?? []).map(user => parseResourceUrl(user));

    return this.toEntity(
      {
        name: `${disk.name}-${scope}`,
        projectId: project,
        type: 'disk',
        region: scope,
        selfLink: disk.selfLink,
        labels: disk.labels,
        title: disk.name,
        description: disk.description,
        summary: `${disk.sizeGb ?? '?'}GB ${lastSegment(disk.type) || 'disk'} in ${scope}, ${(
          disk.status ?? 'unknown'
        ).toLocaleLowerCase()}`,
        consolePath: `compute/disksDetail/zones/${scope}/disks/${disk.name}`,
        tagValues: [lastSegment(disk.type), disk.status],
        annotations: {
          ...(disk.status ? { [ANNOTATION_GCP_STATUS]: disk.status } : {}),
          ...(disk.sourceImage ? { 'cloud.google.com/source-image': lastSegment(disk.sourceImage) } : {}),
        },
      },
      {
        dependsOn: users
          .filter(user => user.name)
          .map(user =>
            this.resourceRef('instances', {
              projectId: user.projectId ?? project,
              type: 'compute-instance',
              provider: 'gcp-instances',
              region: user.zone,
              name: user.name,
            }),
          ),
      },
    );
  }

  private snapshotToResource(snapshot: compute_v1.Schema$Snapshot, project: string): DeferredEntity | undefined {
    if (!snapshot.name) {
      return undefined;
    }
    const source = parseResourceUrl(snapshot.sourceDisk);

    return this.toEntity(
      {
        name: snapshot.name,
        projectId: project,
        type: 'snapshot',
        selfLink: snapshot.selfLink,
        labels: snapshot.labels,
        description: snapshot.description,
        summary: `Snapshot of ${source.name || 'an unreported disk'}, ${snapshot.diskSizeGb ?? '?'}GB`,
        consolePath: `compute/snapshotsDetail/projects/${project}/global/snapshots/${snapshot.name}`,
        tagValues: [snapshot.status, snapshot.snapshotType],
        annotations: {
          ...(snapshot.status ? { [ANNOTATION_GCP_STATUS]: snapshot.status } : {}),
        },
      },
      {
        dependsOn:
          source.name && source.zone
            ? [
                this.ownRef({
                  projectId: source.projectId ?? project,
                  type: 'disk',
                  provider: this.getProviderName(),
                  region: source.zone,
                  name: `${source.name}-${source.zone}`,
                }),
              ]
            : [],
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const disks = await this.listAggregated<compute_v1.Schema$Disk, compute_v1.Schema$DisksScopedList>(
        async pageToken => (await this.client.disks.aggregatedList({ project, pageToken })).data,
        scoped => scoped.disks,
      );
      const snapshots = this.includeSnapshots
        ? await this.listAll<compute_v1.Schema$Snapshot>(
            async pageToken => (await this.client.snapshots.list({ project, pageToken })).data,
          )
        : [];

      return [
        ...disks.map(({ item, scope }) => this.diskToResource(item, scope, project)),
        ...snapshots.map(snapshot => this.snapshotToResource(snapshot, project)),
      ].filter(entity => entity !== undefined);
    });
  }
}

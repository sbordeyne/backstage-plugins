import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { firestore_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, lastSegment } from '../utils';

/**
 * Firestore databases.
 *
 * A project's first database is named `(default)`, which normalizes to the entity name `default`.
 */
export class GcpFirestoreEntityProvider extends GcpRestEntityProvider<firestore_v1.Firestore> {
  getProviderName(): string {
    return 'gcp-firestore';
  }

  getProviderConfigKey(): string {
    return 'firestore';
  }

  getClient(): firestore_v1.Firestore {
    return google.firestore({ version: 'v1', auth: this.googleAuth });
  }

  private databaseToResource(
    database: firestore_v1.Schema$GoogleFirestoreAdminV1Database,
    project: string,
  ): DeferredEntity | undefined {
    const databaseId = lastSegment(database.name);
    if (!databaseId) {
      return undefined;
    }
    const region = database.locationId ?? undefined;
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const mode = database.type === 'DATASTORE_MODE' ? 'Datastore mode' : 'Native mode';

    return this.toEntity({
      name: databaseId,
      projectId: project,
      type: 'firestore-database',
      region,
      selfLink: apiSelfLink('firestore.googleapis.com', 'v1', database.name),
      title: databaseId,
      summary: `Firestore database in ${mode}, ${region ?? 'an unreported location'}`,
      consolePath: `firestore/databases/${databaseId}/data`,
      logFilter: `resource.type="firestore_database" resource.labels.database_id="${databaseId}"`,
      tagValues: [database.type, database.concurrencyMode],
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      // The listing is not paginated: Firestore returns every database in one response.
      const { data } = await this.client.projects.databases.list({ parent: `projects/${project}` });
      return (data.databases ?? [])
        .map(database => this.databaseToResource(database, project))
        .filter(entity => entity !== undefined);
    });
  }
}

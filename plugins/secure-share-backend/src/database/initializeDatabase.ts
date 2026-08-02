import { DatabaseService, resolvePackagePath } from '@backstage/backend-plugin-api';
import { Knex } from 'knex';

const MIGRATIONS_DIRECTORY = resolvePackagePath('@sbordeyne/backstage-plugin-secure-share-backend', 'migrations');

/**
 * Returns the plugin's database client, with migrations applied.
 *
 * @public
 */
export async function initializeDatabase(database: DatabaseService): Promise<Knex> {
  const client = await database.getClient();
  if (!database.migrations?.skip) {
    await client.migrate.latest({ directory: MIGRATIONS_DIRECTORY });
  }
  return client;
}

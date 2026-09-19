/*
 * Local development backend. It runs on SQLite and guest auth so it starts with
 * no external credentials; the plugins that do need credentials are listed at
 * the bottom, commented out.
 */

import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));

backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'));
backend.add(import('@backstage/plugin-catalog-backend-module-logs'));

backend.add(import('@backstage/plugin-permission-backend'));
backend.add(import('@backstage/plugin-permission-backend-module-allow-all-policy'));

backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-techdocs-backend'));

backend.add(import('@backstage/plugin-search-backend'));
backend.add(import('@backstage/plugin-search-backend-module-catalog'));
backend.add(import('@backstage/plugin-search-backend-module-techdocs'));

// Runs on the SQLite database above, so it needs no extra configuration.
backend.add(import('@sbordeyne/backstage-plugin-secure-share-backend'));

// Serves whatever has been ingested. `kubespec.sync.enabled` is false in
// app-config.yaml, so this starts without GitHub credentials and the page
// explains that nothing has been ingested yet; see below to turn the sync on.
backend.add(import('@sbordeyne/backstage-plugin-kubespec-backend'));
// Indexes the ingested kinds into search. Harmless while the database is empty.
backend.add(import('@sbordeyne/backstage-plugin-kubespec-backend/alpha'));

/*
 * The plugins below reach out to third-party systems and abort startup when
 * their configuration is missing. Add the matching credentials to
 * app-config.local.yaml, then uncomment the one you want to exercise.
 *
 * Kubespec is registered above with its sync switched off. To fetch specs, put a
 * GitHub token in `integrations.github` and set `kubespec.sync.enabled: true`,
 * then press the sync button on the page.
 *
 * Needs `bruno.source` plus GCS/S3/GitHub credentials:
 *   backend.add(import('@sbordeyne/backstage-plugin-bruno-backend'));
 *
 * Needs Google Application Default Credentials and a `gcp` catalog config:
 *   backend.add(
 *     import('@sbordeyne/backstage-plugin-catalog-backend-module-gcp-provider'),
 *   );
 *
 * Both need @backstage/plugin-tech-insights-backend registered first, and then
 * Jira / GitHub credentials respectively:
 *   backend.add(import('@sbordeyne/backstage-plugin-tech-insights-backend-module-jira'));
 *   backend.add(import('@sbordeyne/backstage-plugin-tech-insights-backend-module-stack'));
 */

backend.start();

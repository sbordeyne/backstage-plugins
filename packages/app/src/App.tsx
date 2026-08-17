import { createApp } from '@backstage/frontend-defaults';
import { PageBlueprint } from '@backstage/frontend-plugin-api';
import { compatWrapper, convertLegacyPlugin, convertLegacyRouteRef } from '@backstage/core-compat-api';
import { convertLegacyEntityContentExtension } from '@backstage/plugin-catalog-react/alpha';

import catalogPlugin from '@backstage/plugin-catalog/alpha';
import catalogImportPlugin from '@backstage/plugin-catalog-import/alpha';
import catalogGraphPlugin from '@backstage/plugin-catalog-graph/alpha';
import apiDocsPlugin from '@backstage/plugin-api-docs/alpha';
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import techdocsPlugin from '@backstage/plugin-techdocs/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import orgPlugin from '@backstage/plugin-org/alpha';
import homePlugin from '@backstage/plugin-home/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import appVisualizerPlugin from '@backstage/plugin-app-visualizer';
import shouldIDeployTodayPlugin from '@sbordeyne/backstage-plugin-should-i-deploy-today';

// The toolbox exposes its frontend plugin from the package root rather than an
// /alpha subpath, because v2 is new-frontend-system only.
import toolboxPlugin from '@drodil/backstage-plugin-toolbox';
import gotemplateModule from '@sbordeyne/backstage-plugin-toolbox-module-gotemplate';

// The three plugins below still use the legacy frontend system, so each one is
// converted before it can be handed to createApp.
import {
  secureSharePlugin,
  SecureSharePage,
  rootRouteRef as secureShareRouteRef,
} from '@sbordeyne/backstage-plugin-secure-share';
import {
  integratedRepositoriesPlugin,
  IntegratedRepositoriesPage,
} from '@sbordeyne/backstage-plugin-integrated-repositories';
import { brunoPlugin, EntityBrunoContent } from '@sbordeyne/backstage-plugin-bruno';

import ShareIcon from '@material-ui/icons/Share';
import StorageIcon from '@material-ui/icons/Storage';

/*
 * `convertLegacyPageExtension` would be the shorter route, but it cannot carry a
 * title or icon, and the sidebar builds its entries from exactly those two page
 * params. Declaring real PageBlueprint extensions — with the legacy component
 * inside `compatWrapper` — keeps the plugin's APIs registered *and* gets each
 * page into the nav.
 */
const convertedSecureShare = convertLegacyPlugin(secureSharePlugin, {
  extensions: [
    PageBlueprint.make({
      name: 'root',
      params: {
        path: '/secure-share',
        title: 'Secure Share',
        icon: <ShareIcon />,
        routeRef: convertLegacyRouteRef(secureShareRouteRef),
        loader: async () => compatWrapper(<SecureSharePage />),
      },
    }),
  ],
});

const convertedIntegratedRepositories = convertLegacyPlugin(integratedRepositoriesPlugin, {
  extensions: [
    PageBlueprint.make({
      name: 'root',
      params: {
        path: '/integrated-repositories',
        title: 'Repositories',
        icon: <StorageIcon />,
        routeRef: convertLegacyRouteRef(integratedRepositoriesPlugin.routes.root),
        loader: async () => compatWrapper(<IntegratedRepositoriesPage />),
      },
    }),
  ],
});

// Bruno contributes an entity tab rather than a standalone page, so it needs the
// catalog's content conversion instead of the page one.
const convertedBruno = convertLegacyPlugin(brunoPlugin, {
  extensions: [convertLegacyEntityContentExtension(EntityBrunoContent)],
});

const app = createApp({
  features: [
    catalogPlugin,
    catalogImportPlugin,
    catalogGraphPlugin,
    apiDocsPlugin,
    scaffolderPlugin,
    techdocsPlugin,
    searchPlugin,
    orgPlugin,
    homePlugin,
    userSettingsPlugin,
    appVisualizerPlugin,
    shouldIDeployTodayPlugin,

    // The plugin under development, plus the toolbox it plugs into.
    toolboxPlugin,
    gotemplateModule,

    convertedSecureShare,
    convertedIntegratedRepositories,
    convertedBruno,
  ],
});

export default app.createRoot();

import {
  ApiBlueprint,
  createFrontendPlugin,
  discoveryApiRef,
  fetchApiRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { HomePageWidgetBlueprint } from '@backstage/plugin-home-react/alpha';
import ShareIcon from '@material-ui/icons/Share';
import { secureShareApiRef, SecureShareClient } from './api';
import { linkedPasteRouteRef, pasteRouteRef, rootRouteRef } from './routes';

/**
 * The plugin as the new frontend system sees it.
 *
 * `title` and `icon` on the page are what put the entry in the sidebar: nav items are not a
 * blueprint of their own, the app infers one from every page that names itself. Dropping either
 * param removes the plugin from the nav without breaking the route.
 *
 * `noHeader` is set because each of the three pages behind the router brings its own `Header`, with
 * its own title — the paste views say what they are looking at rather than repeating the plugin
 * name. Without it the app would stack a second header above theirs.
 */
export default createFrontendPlugin({
  pluginId: 'secure-share',
  // The two sub routes hang off the page's mount point, so they follow the page wherever the app
  // puts it — including when it overrides `path` through config.
  routes: {
    root: rootRouteRef,
    paste: pasteRouteRef,
    link: linkedPasteRouteRef,
  },
  extensions: [
    ApiBlueprint.make({
      params: defineParams =>
        defineParams({
          api: secureShareApiRef,
          deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
          factory: ({ discoveryApi, fetchApi }) => new SecureShareClient({ discoveryApi, fetchApi }),
        }),
    }),
    PageBlueprint.make({
      params: {
        path: '/secure-share',
        routeRef: rootRouteRef,
        title: 'Secure Share',
        icon: <ShareIcon />,
        noHeader: true,
        loader: () => import('./components/Router').then(m => <m.Router />),
      },
    }),
    /**
     * Home page widget listing the secrets most recently shared with the signed in user.
     *
     * The widget is off by default like every other home page widget: the home page only renders
     * what its layout was configured with. `limit` falls back to `secureShare.card.limit`; the
     * settings schema is what lets a viewer override it for their own copy of the widget, which is
     * the job the card's `limit` prop used to do.
     */
    HomePageWidgetBlueprint.make({
      name: 'shared-with-me',
      params: {
        title: 'Shared with me',
        description: 'Secrets recently shared with you, decrypted in your browser',
        components: () => import('./components/SharedWithMeCard').then(m => ({ Content: m.SharedWithMeCard })),
        settings: {
          schema: {
            type: 'object',
            properties: {
              limit: { type: 'number', title: 'Secrets to show' },
            },
          },
        },
      },
    }),
  ],
});

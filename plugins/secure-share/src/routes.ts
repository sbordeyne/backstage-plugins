import { createRouteRef, createSubRouteRef } from '@backstage/frontend-plugin-api';

export const rootRouteRef = createRouteRef();

export const pasteRouteRef = createSubRouteRef({
  parent: rootRouteRef,
  path: '/paste/:pasteId',
});

/** A secret link. Both the link token and the data key live in the URL fragment. */
export const linkedPasteRouteRef = createSubRouteRef({
  parent: rootRouteRef,
  path: '/link/:pasteId',
});

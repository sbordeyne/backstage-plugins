import { createRouteRef, createSubRouteRef } from '@backstage/core-plugin-api';

export const rootRouteRef = createRouteRef({
  id: 'secure-share',
});

export const pasteRouteRef = createSubRouteRef({
  id: 'secure-share.paste',
  parent: rootRouteRef,
  path: '/paste/:pasteId',
});

/** A secret link. Both the link token and the data key live in the URL fragment. */
export const linkedPasteRouteRef = createSubRouteRef({
  id: 'secure-share.link',
  parent: rootRouteRef,
  path: '/link/:pasteId',
});

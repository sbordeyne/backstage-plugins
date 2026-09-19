import { createRouteRef, createSubRouteRef } from '@backstage/core-plugin-api';

export const rootRouteRef = createRouteRef({
  id: 'kubespec',
});

/** A source at one version: the index of every kind it defines. */
export const sourceRouteRef = createSubRouteRef({
  id: 'kubespec/source',
  parent: rootRouteRef,
  path: '/:sourceId/:sourceVersion',
});

/**
 * One kind's schema.
 *
 * Five fixed segments, with `latest` and `core` as literal stand-ins for the two
 * that would otherwise be optional. kubespec.dev leaves both out and decides at
 * build time whether the first segment is a version or an API group — a parse
 * that needs the data, which a router in a browser does not have.
 */
export const resourceRouteRef = createSubRouteRef({
  id: 'kubespec/resource',
  parent: rootRouteRef,
  path: '/:sourceId/:sourceVersion/:groupSegment/:apiVersion/:kind',
});

export const searchRouteRef = createSubRouteRef({
  id: 'kubespec/search',
  parent: rootRouteRef,
  path: '/search',
});

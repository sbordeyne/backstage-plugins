import { createDevApp } from '@backstage/dev-utils';
import { TestApiProvider } from '@backstage/test-utils';
import type {
  KubespecChange,
  KubespecChangeSummary,
  KubespecMetadata,
  KubespecPaginated,
  KubespecResourceDefinition,
  KubespecResourceEnvelope,
  KubespecResourceListResponse,
  KubespecSearchResponse,
  KubespecSourceSummary,
  KubespecVersionSummary,
} from '@sbordeyne/kubespec-common';

import { KubespecPageExtension, kubespecApiRef, kubespecPlugin } from '../src';
import type { KubespecApi } from '../src/api';

const SOURCES: KubespecSourceSummary[] = [
  {
    slug: 'kubernetes',
    name: 'Kubernetes',
    kind: 'kubernetes',
    repo: 'kubernetes/kubernetes',
    repoUrl: 'https://github.com/kubernetes/kubernetes',
    versionCount: 2,
    latestVersion: 'v1.34',
    lastSyncStatus: 'ok',
  },
  {
    slug: 'cert-manager',
    name: 'cert-manager',
    kind: 'crd',
    repo: 'cert-manager/cert-manager',
    repoUrl: 'https://github.com/cert-manager/cert-manager',
    versionCount: 1,
    latestVersion: 'v1.21.2',
    lastSyncStatus: 'ok',
  },
];

const DEPLOYMENT: KubespecResourceDefinition = {
  description: 'Deployment enables declarative updates for Pods and ReplicaSets.',
  properties: [
    { name: 'apiVersion', type: 'string', isArray: false, required: false, description: 'The versioned schema.' },
    {
      name: 'metadata',
      type: 'ObjectMeta',
      isArray: false,
      required: false,
      description: 'Standard object metadata.',
      children: [
        { name: 'name', type: 'string', isArray: false, required: false, description: 'The object name.' },
        { name: 'namespace', type: 'string', isArray: false, required: false, description: 'The namespace.' },
      ],
    },
    {
      name: 'spec',
      type: 'DeploymentSpec',
      isArray: false,
      required: true,
      description: 'The desired behaviour of the Deployment.',
      children: [
        {
          name: 'replicas',
          type: 'integer',
          isArray: false,
          required: false,
          description: 'Number of desired pods.',
          format: 'int32',
          defaultValue: '1',
        },
        {
          name: 'strategy',
          type: 'DeploymentStrategy',
          isArray: false,
          required: false,
          description: 'How to replace existing pods.',
          children: [
            {
              name: 'type',
              type: 'string',
              isArray: false,
              required: false,
              description: 'Type of deployment.',
              enumValues: ['Recreate', 'RollingUpdate'],
            },
          ],
        },
        {
          name: 'template',
          type: 'PodTemplateSpec',
          isArray: false,
          required: true,
          description: 'The pods that will be created.',
          children: [
            {
              name: 'spec',
              type: 'PodSpec',
              isArray: false,
              required: false,
              description: 'Behaviour of the pod.',
              children: [
                {
                  name: 'containers',
                  type: 'Container',
                  isArray: true,
                  required: true,
                  description: 'List of containers belonging to the pod. There must be at least one.',
                  children: [
                    { name: 'image', type: 'string', isArray: false, required: false, description: 'Image name.' },
                    { name: 'name', type: 'string', isArray: false, required: true, description: 'Container name.' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'schema',
      type: 'JSONSchemaProps',
      isArray: false,
      required: false,
      description: 'A schema that contains itself, to exercise the recursion marker.',
      recursiveOf: '.spec',
    },
  ],
};

const RESOURCES: KubespecResourceListResponse = {
  sourceSlug: 'kubernetes',
  sourceName: 'Kubernetes',
  requestedVersion: 'latest',
  resolvedVersion: 'v1.34',
  isLatest: true,
  categoryOrder: ['Workloads', 'Cluster'],
  items: [
    {
      group: 'apps',
      apiVersion: 'v1',
      apiVersionFull: 'apps/v1',
      kind: 'Deployment',
      category: 'Workloads',
      scope: 'Namespaced',
      description: 'Deployment enables declarative updates for Pods.',
      propertyCount: 12,
      hasMetadata: true,
    },
    {
      group: '',
      apiVersion: 'v1',
      apiVersionFull: 'v1',
      kind: 'Node',
      category: 'Cluster',
      scope: 'Cluster',
      description: 'Node is a worker node in Kubernetes.',
      propertyCount: 40,
      hasMetadata: false,
    },
  ],
};

/**
 * A stub backend, so the page can be built and exercised before the real one is
 * reachable — including the cases that are awkward to reproduce on purpose: a
 * recursive schema, a kind missing from a version, and a failing request.
 */
const api: KubespecApi = {
  async listSources(): Promise<KubespecSourceSummary[]> {
    return SOURCES;
  },
  async listVersions(): Promise<KubespecPaginated<KubespecVersionSummary>> {
    return {
      items: [
        { version: 'v1.34', upstreamRef: 'v1.34.0', ingestedAt: '', resourceCount: 73, isLatest: true },
        { version: 'v1.33', upstreamRef: 'v1.33.0', ingestedAt: '', resourceCount: 72, isLatest: false },
      ],
    };
  },
  async listResources(): Promise<KubespecResourceListResponse> {
    return RESOURCES;
  },
  async getResource({ ref }): Promise<KubespecResourceEnvelope> {
    if (ref.kind === 'Missing') {
      throw Object.assign(new Error('No such kind in that version'), { name: 'NotFoundError' });
    }
    return {
      ...RESOURCES.items[0],
      sourceSlug: 'kubernetes',
      sourceName: 'Kubernetes',
      sourceVersion: 'v1.34',
      isLatest: true,
      definitionBytes: 4096,
      definitionHash: 'abc',
      truncated: false,
    };
  },
  async getSchema(): Promise<KubespecResourceDefinition> {
    return DEPLOYMENT;
  },
  async listChangeSummaries(): Promise<KubespecChangeSummary[]> {
    return [
      {
        version: 'v1.34',
        previousVersion: 'v1.33',
        isNewGvk: false,
        isRemovedGvk: false,
        addedCount: 2,
        removedCount: 1,
        descriptionChangedCount: 1,
        descriptionChangedPaths: 14,
        typeChangedCount: 0,
        typeChangedPaths: 0,
      },
      {
        version: 'v1.33',
        isNewGvk: true,
        isRemovedGvk: false,
        addedCount: 0,
        removedCount: 0,
        descriptionChangedCount: 0,
        descriptionChangedPaths: 0,
        typeChangedCount: 0,
        typeChangedPaths: 0,
      },
    ];
  },
  async listChanges(): Promise<KubespecPaginated<KubespecChange>> {
    return {
      items: [
        { changeType: 'new', path: '.spec.template.spec.resources', pathCount: 1, depth: 3, description: 'New.' },
        { changeType: 'removed', path: '.spec.deprecated', pathCount: 1, depth: 1, description: 'Gone.' },
        {
          changeType: 'description',
          path: '.spec.replicas',
          pathCount: 14,
          paths: ['.spec.replicas', '.spec.template.spec.replicas'],
          depth: 1,
          previousValue: 'Number of desired pods.',
          nextValue: 'Number of requested pods.',
          diff: [
            { value: 'Number of ', kind: 'equal' },
            { value: 'desired', kind: 'removed' },
            { value: 'requested', kind: 'added' },
            { value: ' pods.', kind: 'equal' },
          ],
        },
      ],
    };
  },
  async search(): Promise<KubespecSearchResponse> {
    return { resources: [], properties: [] };
  },
  async triggerSync(): Promise<{ triggered: boolean }> {
    return { triggered: true };
  },
  async getMetadata(): Promise<KubespecMetadata> {
    return {
      examples: [
        {
          slug: 'basic',
          ordinal: 1,
          title: 'An NGINX deployment with 3 replicas',
          description: 'The label app:nginx matches the pods to the Deployment.',
          content: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: nginx\nspec:\n  replicas: 3\n',
        },
      ],
      links: [{ name: 'Kubernetes docs: Deployments', href: 'https://kubernetes.io' }],
    };
  },
};

createDevApp()
  .registerPlugin(kubespecPlugin)
  .addPage({
    element: (
      <TestApiProvider apis={[[kubespecApiRef, api]]}>
        {/* The routable extension rather than the bare page, so the plugin's own
            route refs resolve and its links point at the mounted path. */}
        <KubespecPageExtension />
      </TestApiProvider>
    ),
    title: 'Kubespec',
    path: '/kubespec',
  })
  .render();

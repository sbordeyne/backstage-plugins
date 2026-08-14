import { lastSegment, segmentAfter } from '../utils';
import { GcpNameStyle, RESOURCE_TYPES } from '../resourceTypes';

/**
 * How an asset type reported by Cloud Asset Inventory maps onto an entity this module ingests.
 *
 * The registry is what makes an IAM binding addressable: a policy names its resource as
 * `//storage.googleapis.com/projects/_/buckets/reports`, and a relation needs
 * `resource:<namespace>/reports` — which takes knowing the provider that ingests buckets, so its
 * namespace template can be applied.
 */
export interface AssetTypeMapping {
  /** Config key of the provider ingesting this asset type, for its namespace template. */
  configKey: string;
  /** Provider name, available to that template as `${provider}`. */
  provider: string;
  /** `spec.type` of the resulting entity, available as `${type}`. */
  type: string;
  /**
   * How the entity name is derived, when the leaf of the asset name is not it. Subnets carry their
   * region, Pub/Sub topics have prefixes stripped, and both are handled by the caller rather than
   * here, since they need provider configuration.
   */
  nameStyle?: GcpNameStyle;
}

/**
 * One entry per ingested resource type that has an IAM policy of its own, derived from
 * {@link RESOURCE_TYPES}.
 *
 * An asset type absent from here yields no relation, which is the right outcome: pointing at an
 * entity that is not ingested would dangle. Because the table is derived, a resource type added
 * without deciding whether it carries a policy cannot silently go missing from it.
 */
export const ASSET_TYPES: Record<string, AssetTypeMapping> = Object.fromEntries(
  RESOURCE_TYPES.filter(resource => resource.assetType).map(resource => [
    resource.assetType as string,
    {
      configKey: resource.configKey,
      provider: resource.provider,
      type: resource.type,
      ...(resource.nameStyle ? { nameStyle: resource.nameStyle } : {}),
    },
  ]),
);

/** What an asset name says about the resource behind it, before entity naming is applied. */
export interface ParsedAsset {
  mapping: AssetTypeMapping;
  /** Project the resource lives in, from the asset name. */
  projectId?: string;
  /** Region, zone or location, when the asset name carries one. */
  region?: string;
  /** The leaf of the asset name, e.g. `reports` for a bucket. */
  leaf: string;
}

/**
 * An asset name and type read as the resource they describe, or undefined when nothing ingests that
 * type.
 *
 * Names look like `//service.googleapis.com/projects/p/locations/l/kind/name`, with a few older
 * services using `projects/_/…` for resources whose names are globally unique.
 */
export function parseAsset(assetName: string, assetType: string): ParsedAsset | undefined {
  const mapping = ASSET_TYPES[assetType];
  if (!mapping) {
    return undefined;
  }
  const path = assetName.replace(/^\/\//, '');
  const projectId = segmentAfter(path, 'projects');
  return {
    mapping,
    // `projects/_` means the service does not scope the name by project, and several services write
    // the project *number* here — `projects/47603036561/secrets/…`. Entities are named after the
    // project id, so a number is as unusable as no project at all and the caller's own id is used.
    projectId: projectId && projectId !== '_' && !/^\d+$/.test(projectId) ? projectId : undefined,
    region: segmentAfter(path, 'locations') ?? segmentAfter(path, 'regions') ?? segmentAfter(path, 'zones'),
    leaf: lastSegment(path),
  };
}

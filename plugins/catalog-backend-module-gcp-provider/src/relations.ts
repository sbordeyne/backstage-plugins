import {
  RELATION_DEPENDENCY_OF,
  RELATION_DEPENDS_ON,
  RELATION_HAS_PART,
  RELATION_PART_OF,
} from '@backstage/catalog-model';

/**
 * A relation as a pair of directions.
 *
 * Backstage stores each direction as its own row, and a custom relation type has no automatic
 * reverse, so both halves are named here and emitted together.
 */
export interface RelationPair {
  /** From the actor or child outward, e.g. `readerOf` on a service account. */
  forward: string;
  /** From the resource or parent back, e.g. `readBy` on the bucket. */
  reverse: string;
}

/**
 * What an IAM role lets an identity do, as a relation pair.
 *
 * The vocabulary is the verbs the services themselves use — publishing, invoking, connecting —
 * with read/write/admin/access underneath for everything that does not have a verb of its own.
 * Reverse names are passive (`readBy`, `publishedToBy`), matching Backstage's own `ownedBy` and
 * `apiConsumedBy`.
 */
export const IAM_RELATIONS = {
  publisher: { forward: 'publisherTo', reverse: 'publishedToBy' },
  subscriber: { forward: 'subscriberOf', reverse: 'subscribedBy' },
  invoker: { forward: 'invokerOf', reverse: 'invokedBy' },
  client: { forward: 'clientOf', reverse: 'connectedToBy' },
  encrypter: { forward: 'encrypterOf', reverse: 'encryptedBy' },
  accessor: { forward: 'accessorOf', reverse: 'accessedBy' },
  admin: { forward: 'adminOf', reverse: 'administeredBy' },
  writer: { forward: 'writerOf', reverse: 'writtenBy' },
  reader: { forward: 'readerOf', reverse: 'readBy' },
  /** Anything that classifies as nothing more specific. */
  user: { forward: 'userOf', reverse: 'usedBy' },
} as const satisfies Record<string, RelationPair>;

export type IamRelationKind = keyof typeof IAM_RELATIONS;

/**
 * Structural relations, for the edges that are containment or attachment rather than access.
 *
 * Containment reuses Backstage's own `partOf` / `hasPart`, because a Spanner database really is
 * part of its instance and the built-in pair already means that. Attachment has no built-in, so it
 * gets a pair of its own: a GKE cluster is not part of its subnet, it is plugged into it.
 */
export const STRUCTURAL_RELATIONS = {
  partOf: { forward: RELATION_PART_OF, reverse: RELATION_HAS_PART },
  attachedTo: { forward: 'attachedTo', reverse: 'hasAttached' },
} as const satisfies Record<string, RelationPair>;

export type StructuralRelationKind = keyof typeof STRUCTURAL_RELATIONS;

/** The pair `dependsOn` / `dependencyOf`, used for every edge when relations are left built-in. */
export const DEPENDS_ON_RELATION: RelationPair = {
  forward: RELATION_DEPENDS_ON,
  reverse: RELATION_DEPENDENCY_OF,
};

/**
 * Which vocabulary the module emits.
 *
 * `builtin` keeps every edge as `dependsOn`, which is what the catalog and its graph views have
 * always understood. `gcp` replaces those edges with the typed pairs above — richer to read, but
 * anything filtering on `dependsOn` stops seeing them.
 */
export type RelationMode = 'builtin' | 'gcp';

/**
 * Role suffixes that name a specific verb, most specific first.
 *
 * Matching is by suffix rather than by exact role name so that a role this module has never heard
 * of — and GCP adds them constantly — still classifies: `roles/newservice.viewer` reads.
 */
const ROLE_PATTERNS: [RegExp, IamRelationKind][] = [
  [/\.publisher$/i, 'publisher'],
  [/\.(subscriber|receiver)$/i, 'subscriber'],
  [/\.invoker$/i, 'invoker'],
  [/\.(client|connectionUser|instanceUser)$/i, 'client'],
  [/crypto(Key|)?(Encrypter|Decrypter|EncrypterDecrypter|SignerVerifier)$/i, 'encrypter'],
  [/\.(secretAccessor|accessor)$/i, 'accessor'],
  [/\.(admin|owner|securityAdmin)$/i, 'admin'],
  [/\.(editor|writer|objectCreator|objectUser|developer|dataEditor|dataOwner|user)$/i, 'writer'],
  [/\.(viewer|reader|objectViewer|dataViewer|metadataViewer|browser)$/i, 'reader'],
];

/**
 * What a role lets its holder do.
 *
 * Unrecognized roles fall back to `user`, which says the identity has *some* access without
 * claiming to know what kind — better than guessing `admin` and better than dropping the edge.
 */
export function classifyRole(role: string): IamRelationKind {
  for (const [pattern, kind] of ROLE_PATTERNS) {
    if (pattern.test(role)) {
      return kind;
    }
  }
  return 'user';
}

/** The pair a role maps to, or `dependsOn` when the built-in vocabulary is in use. */
export function relationForRole(role: string, mode: RelationMode): RelationPair {
  return mode === 'builtin' ? DEPENDS_ON_RELATION : IAM_RELATIONS[classifyRole(role)];
}

/** The pair a structural edge maps to, likewise collapsing to `dependsOn` in built-in mode. */
export function relationForStructure(kind: StructuralRelationKind, mode: RelationMode): RelationPair {
  return mode === 'builtin' ? DEPENDS_ON_RELATION : STRUCTURAL_RELATIONS[kind];
}

/** Every relation type this module can emit, for documentation and tests. */
export function allRelationTypes(): string[] {
  return [...Object.values(IAM_RELATIONS), ...Object.values(STRUCTURAL_RELATIONS)]
    .flatMap(pair => [pair.forward, pair.reverse])
    .filter((type, index, all) => all.indexOf(type) === index);
}

export interface Config {
  kubespec?: {
    /**
     * Absolute path overriding the packaged example/link directory. Only useful
     * when authoring metadata locally; production resolves it from the package.
     */
    metadataDir?: string;

    /**
     * Delete stored sources that are no longer listed in this config. Turning it
     * off leaves removed sources browsable but frozen.
     * @default true
     */
    pruneUnknownSources?: boolean;

    search?: {
      /**
       * Which versions get a property-path index.
       *
       * 'latest' indexes only the newest version of each source (~170k rows).
       * 'all' indexes every ingested version (~1.6M rows, ~400MB in the shared
       * portal database) and in exchange lets property search work while
       * browsing an older version.
       * @default 'latest'
       */
      scope?: 'latest' | 'all';

      /**
       * Property paths deeper than this are not indexed. Depth 6 covers ~70% of
       * the nodes in the Kubernetes tree; deeper paths are leaf scalars of
       * embedded types and are effectively never searched by name.
       * @default 6
       */
      maxDepth?: number;

      /**
       * @default 50
       */
      maxResults?: number;
    };

    sync?: {
      /**
       * @default true
       */
      enabled?: boolean;

      /**
       * Sources ingested in parallel. Versions within one source are always
       * sequential, because each version's change list is diffed against the one
       * before it.
       * @default 4
       */
      concurrency?: number;

      /**
       * Manifest files downloaded in parallel within one version. File bodies come
       * from raw.githubusercontent.com and cost no API quota, but burst
       * concurrency is what trips GitHub's secondary rate limit.
       * @default 8
       */
      fileConcurrency?: number;

      /**
       * Versions ingested per tick, across all sources. Bounds the cost of the
       * first, cold run — steady state is far below this, because unchanged
       * versions are skipped without downloading anything.
       * @default 60
       */
      maxVersionsPerTick?: number;

      /**
       * How long a tick may spend ingesting before it stops and leaves the rest
       * for the next one.
       *
       * Must stay comfortably below `sync.schedule.timeout`. The scheduler never
       * extends a running task's ticket and only its janitor clears an expired
       * one, so that timeout is also how long an abandoned ticket — from a
       * crashed pod, a rolling deploy, a reloading dev server — blocks every
       * manual sync. Stopping the tick on purpose keeps that window short without
       * ever truncating work: each version is committed on its own, and an
       * unchanged one is skipped without being downloaded.
       * @default 10
       */
      maxTickDurationMinutes?: number;

      /**
       * A single spec or manifest larger than this is rejected. A Kubernetes
       * swagger.json is ~4MB, so this is a circuit breaker rather than a limit
       * anything legitimate approaches.
       * @default 67108864
       */
      maxSpecBytes?: number;

      /**
       * Circuit breaker on a pathological schema. A resource whose expansion
       * exceeds this is stored truncated and flagged, rather than failing the
       * whole version.
       * @default 50000
       */
      maxResourceNodes?: number;

      /**
       * The deepest schema measured across the whole corpus reaches 14 levels, so
       * this leaves headroom rather than sitting on the observed maximum.
       * @default 20
       */
      maxResourceDepth?: number;

      /**
       * Standard scheduler task schedule.
       *
       * `timeout` should stay comfortably above `maxTickDurationMinutes`: a
       * healthy tick then never reaches it, and it only bounds how long a lost
       * ticket blocks the next sync.
       */
      schedule?: {
        frequency: { [key: string]: number } | string;
        timeout: { [key: string]: number } | string;
        initialDelay?: { [key: string]: number } | string;
        scope?: 'global' | 'local';
      };
    };

    /**
     * The core Kubernetes API, pinned to explicit minor versions rather than tag
     * rules: upstream's tag scheme needs a bespoke minor extraction that no
     * declarative rule expresses.
     */
    kubernetes?: {
      /**
       * @default true
       */
      enabled?: boolean;

      /**
       * @default 'Kubernetes'
       */
      name?: string;

      logoUrl?: string;

      /**
       * @default 'kubernetes/kubernetes'
       */
      repo?: string;

      /**
       * @default 'api/openapi-spec/swagger.json'
       */
      specPath?: string;

      /**
       * Minors to ingest, e.g. ['v1.31', 'v1.32']. A minor dropped from this list
       * is pruned from the database on the next sync.
       */
      minors?: string[];

      /**
       * The git tag holding a minor's spec. `{minor}` is substituted.
       * @default '{minor}.0'
       */
      refTemplate?: string;

      /**
       * Category heading -> the kinds filed under it. A kind that appears in no
       * category falls into `defaultCategory`, so a new upstream kind shows up
       * without a code change.
       */
      categories?: { [category: string]: string[] };

      /**
       * @default 'Other'
       */
      defaultCategory?: string;

      /**
       * Order the category headings are displayed in. Categories not listed here
       * follow, alphabetically.
       */
      categoryOrder?: string[];
    };

    /** Projects that ship CRDs. */
    projects?: Array<{
      /** URL segment and primary key, e.g. 'istio'. */
      slug: string;

      name: string;

      /** 'owner/repo'. */
      repo: string;

      logoUrl?: string;

      /**
       * Candidate manifest paths, each a file or a directory. Order them
       * newest-layout-first: with the default `pathsMode`, the first path that
       * resolves at a given tag wins and the rest are not fetched, which is what
       * lets one entry cover a repo that moved its CRD directory over time.
       */
      paths?: string[];

      /**
       * 'first': the first resolving path wins.
       * 'all': every resolving path contributes, and duplicate kinds across them
       * are collapsed.
       * @default 'first'
       */
      pathsMode?: 'first' | 'all';

      /**
       * Alternative to `paths`: the name of an asset attached to each GitHub
       * release, downloaded instead of walking the repository.
       */
      releaseAsset?: string;

      /** Display order in the source picker. */
      order?: number;

      tags?: {
        /**
         * Required prefix, stripped before every other rule and before the
         * version is parsed. The stripped remainder becomes the displayed
         * version.
         */
        prefix?: string;

        /** Regex a tag must match, applied after `prefix` is stripped. */
        regex?: string;

        /** Regex excluding a tag, applied to the raw tag before `prefix`. */
        exclude?: string;

        /** Inclusive lower bound. A leading `v` is tolerated on either side. */
        minVersion?: string;

        /** Inclusive upper bound. */
        maxVersion?: string;

        /**
         * Drop prereleases such as `-rc.1`, `-beta2` or `-bc1`.
         * @default true
         */
        excludePrerelease?: boolean;

        /**
         * Keep at most this many versions, newest first. The only cost control
         * for a project with no `minVersion`.
         * @default 10
         */
        max?: number;
      };
    }>;
  };
}

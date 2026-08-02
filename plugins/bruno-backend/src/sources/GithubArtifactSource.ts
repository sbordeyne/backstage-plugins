import AdmZip from 'adm-zip';
import type { Octokit } from '@octokit/rest';

import type { BrunoArtifactRef, BrunoArtifactSource, BrunoSourceType } from './types';

export interface GithubSourceOptions {
  owner: string;
  repo: string;
  /** Only artifacts whose name starts with this, and the prefix is stripped from the name. */
  namePrefix: string;
  /** Only artifacts produced by a run on this branch. Empty accepts every branch. */
  branch: string;
  /** Refuses to unpack an entry larger than this, so a small archive cannot expand without bound. */
  maxEntryBytes: number;
}

/**
 * Reads Bruno reports from GitHub Actions artifacts.
 *
 * An artifact is a zip, and its listing says nothing about what is inside, so the **artifact name**
 * is what an entity's report annotation is matched against: an artifact named `users.json` is the
 * report `users.json`. The archive is unwrapped on download — a single JSON entry is taken as the
 * report, and an archive holding several is resolved by the entry whose file name matches the
 * artifact.
 */
export class GithubArtifactSource implements BrunoArtifactSource {
  readonly type: BrunoSourceType = 'github';

  readonly #octokit: Octokit;
  readonly #options: GithubSourceOptions;

  constructor(options: GithubSourceOptions, octokit: Octokit) {
    this.#options = options;
    this.#octokit = octokit;
  }

  async *list(abortSignal?: AbortSignal): AsyncIterable<BrunoArtifactRef> {
    const { owner, repo, namePrefix, branch } = this.#options;
    const perPage = 100;

    // Paged by hand rather than through octokit.paginate: the repository pulls in
    // two @octokit/types versions, and the paginate overloads do not resolve
    // against the endpoint from the other one.
    for (let page = 1; ; page++) {
      const response = await this.#octokit.rest.actions.listArtifactsForRepo({
        owner,
        repo,
        per_page: perPage,
        page,
      });

      for (const artifact of response.data.artifacts) {
        if (abortSignal?.aborted) {
          return;
        }
        // GitHub keeps expired artifacts in the listing with their bytes already
        // deleted, so downloading one is a guaranteed 410.
        if (artifact.expired) {
          continue;
        }
        if (namePrefix && !artifact.name.startsWith(namePrefix)) {
          continue;
        }
        if (branch && artifact.workflow_run?.head_branch !== branch) {
          continue;
        }
        yield this.toRef(artifact);
      }

      if (response.data.artifacts.length < perPage) {
        return;
      }
    }
  }

  async download(ref: BrunoArtifactRef): Promise<Buffer> {
    const response = await this.#octokit.rest.actions.downloadArtifact({
      owner: this.#options.owner,
      repo: this.#options.repo,
      artifact_id: Number(ref.version),
      archive_format: 'zip',
    });

    const archive = new AdmZip(Buffer.from(response.data as ArrayBuffer));
    return this.readReportEntry(archive, ref);
  }

  private readReportEntry(archive: AdmZip, ref: BrunoArtifactRef): Buffer {
    const entries = archive.getEntries().filter(entry => !entry.isDirectory && entry.entryName.endsWith('.json'));

    if (entries.length === 0) {
      throw new Error(`GitHub artifact '${ref.name}' holds no .json entry`);
    }

    const entry =
      entries.length === 1 ? entries[0] : entries.find(candidate => candidate.entryName.split('/').pop() === ref.name);

    if (!entry) {
      throw new Error(
        `GitHub artifact '${ref.name}' holds ${entries.length} .json entries and none is named after it; ` +
          `name the artifact after the report file, or upload one report per artifact`,
      );
    }

    // The listing only knows the compressed size, so the uncompressed one is
    // checked here rather than trusting an archive to be proportionate.
    if (entry.header.size > this.#options.maxEntryBytes) {
      throw new Error(
        `GitHub artifact '${ref.name}' unpacks to ${entry.header.size} bytes, over the ${
          this.#options.maxEntryBytes
        } byte limit`,
      );
    }

    return entry.getData();
  }

  private toRef(artifact: {
    id: number;
    name: string;
    size_in_bytes: number;
    created_at?: string | null;
  }): BrunoArtifactRef {
    const { owner, repo, namePrefix } = this.#options;
    return {
      source: `github://${owner}/${repo}`,
      // An artifact id is unique per upload and never reused, so it is both the
      // version the sync diffs on and the handle the download needs.
      name: namePrefix ? artifact.name.slice(namePrefix.length) : artifact.name,
      version: String(artifact.id),
      createdAt: artifact.created_at ? new Date(artifact.created_at) : new Date(0),
      sizeBytes: artifact.size_in_bytes,
    };
  }
}

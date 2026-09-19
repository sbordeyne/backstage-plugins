import type { LoggerService } from '@backstage/backend-plugin-api';
import type { GithubCredentialsProvider } from '@backstage/integration';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';

const ThrottledOctokit = Octokit.plugin(retry, throttling);

/** Files that live beside CRDs in the same directories and never contain one. */
const IGNORED_FILES = [/^NOTES\.txt$/i, /^OWNERS$/i, /^kustomization\.ya?ml$/i, /\.go$/i, /\.md$/i];

export interface GithubFile {
  /** Repository-relative path. */
  path: string;
  name: string;
  /** The git blob sha, which is what makes the content hash free. */
  sha: string;
  downloadUrl: string;
  size: number;
}

export interface TagListing {
  tags: string[];
  etag?: string;
  /** The listing was unchanged since `etag`, and cost no rate-limit quota. */
  notModified: boolean;
}

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  updatedAt: string;
  downloadUrl: string;
}

export interface GithubClientOptions {
  credentials: GithubCredentialsProvider;
  logger: LoggerService;
}

/**
 * The GitHub access the ingest worker needs, and nothing more.
 *
 * Only the listing calls here spend REST quota. File bodies are fetched from
 * `raw.githubusercontent.com` via `download_url`, which does not count against
 * the API rate limit — which is why a daily sync of nearly thirty repositories
 * fits comfortably inside one hour's budget.
 */
export class GithubClient {
  private readonly octokits = new Map<string, Promise<Octokit>>();
  private requests = 0;

  constructor(private readonly options: GithubClientOptions) {}

  /** REST requests issued so far, reported in the sync statistics. */
  get requestCount(): number {
    return this.requests;
  }

  async listTags(repo: string, etag?: string): Promise<TagListing> {
    const octokit = await this.octokitFor(repo);
    const [owner, name] = splitRepo(repo);

    try {
      this.requests += 1;
      const first = await octokit.request('GET /repos/{owner}/{repo}/tags', {
        owner,
        repo: name,
        per_page: 100,
        headers: etag ? { 'if-none-match': etag } : undefined,
      });

      const tags = first.data.map(tag => tag.name);
      const nextEtag = first.headers.etag;

      // Only the first page carries an ETag worth storing; the rest are walked
      // unconditionally, and only when the first page proved something changed.
      if (first.data.length === 100) {
        // The route string rather than the typed method: `paginate`'s overloads
        // differ between Octokit majors, and this form types the same either way.
        const rest: Array<{ name: string }> = await octokit.paginate('GET /repos/{owner}/{repo}/tags', {
          owner,
          repo: name,
          per_page: 100,
          page: 2,
        });
        this.requests += Math.ceil(rest.length / 100);
        tags.push(...rest.map(tag => tag.name));
      }

      return { tags, etag: nextEtag, notModified: false };
    } catch (error) {
      if (statusOf(error) === 304) {
        return { tags: [], etag, notModified: true };
      }
      throw error;
    }
  }

  /**
   * Walks `paths` and returns every manifest file found.
   *
   * `paths` is a list of candidates tried in order. Under the default
   * `pathsMode: 'first'` the first one that resolves wins — that is what lets a
   * single project entry cover a repository that moved its CRD directory between
   * releases, since the older layouts simply 404 on newer tags.
   */
  async collectManifests(options: {
    repo: string;
    ref: string;
    paths: readonly string[];
    pathsMode: 'first' | 'all';
  }): Promise<GithubFile[]> {
    const files: GithubFile[] = [];

    for (const candidate of options.paths) {
      const found = await this.walkPath(options.repo, options.ref, candidate);
      if (found.length === 0) {
        continue;
      }
      files.push(...found);
      if (options.pathsMode === 'first') {
        break;
      }
    }

    // One basename can appear under two candidate paths in 'all' mode; the first
    // wins, matching the order the candidates were configured in.
    const byPath = new Map<string, GithubFile>();
    for (const file of files) {
      if (!byPath.has(file.path)) {
        byPath.set(file.path, file);
      }
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  private async walkPath(repo: string, ref: string, root: string): Promise<GithubFile[]> {
    const [owner, name] = splitRepo(repo);
    const files: GithubFile[] = [];
    const pending = [root];

    while (pending.length > 0) {
      const path = pending.pop() as string;

      let entries;
      try {
        this.requests += 1;
        const response = await this.octokitFor(repo).then(octokit =>
          octokit.rest.repos.getContent({ owner, repo: name, path, ref }),
        );
        entries = Array.isArray(response.data) ? response.data : [response.data];
      } catch (error) {
        if (statusOf(error) === 404) {
          // Expected: a candidate path that does not exist at this tag.
          continue;
        }
        throw error;
      }

      for (const entry of entries) {
        if (entry.type === 'dir') {
          pending.push(entry.path);
          continue;
        }
        if (entry.type !== 'file' || isIgnored(entry.name) || !entry.download_url) {
          continue;
        }
        files.push({
          path: entry.path,
          name: entry.name,
          sha: entry.sha,
          downloadUrl: entry.download_url,
          size: entry.size ?? 0,
        });
      }
    }

    return files;
  }

  async findReleaseAsset(repo: string, tag: string, assetName: string): Promise<ReleaseAsset | undefined> {
    const [owner, name] = splitRepo(repo);
    const octokit = await this.octokitFor(repo);

    try {
      this.requests += 1;
      const release = await octokit.rest.repos.getReleaseByTag({ owner, repo: name, tag });
      const asset = release.data.assets.find(candidate => candidate.name === assetName);
      if (!asset) {
        return undefined;
      }
      return {
        id: asset.id,
        name: asset.name,
        size: asset.size,
        updatedAt: asset.updated_at,
        downloadUrl: asset.browser_download_url,
      };
    } catch (error) {
      if (statusOf(error) === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Downloads a file body.
   *
   * Uses the token so private repositories work, but the URL is a raw content or
   * release-asset URL rather than an API endpoint, so it costs no REST quota.
   */
  async download(repo: string, url: string, maxBytes: number): Promise<string> {
    const token = await this.tokenFor(repo);
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
      throw new Error(`Refusing to download ${url}: ${declared} bytes exceeds the ${maxBytes} byte limit`);
    }

    const body = await response.text();
    if (body.length > maxBytes) {
      throw new Error(`Refusing to parse ${url}: ${body.length} bytes exceeds the ${maxBytes} byte limit`);
    }
    return body;
  }

  private async tokenFor(repo: string): Promise<string | undefined> {
    const { token } = await this.options.credentials.getCredentials({ url: `https://github.com/${repo}` });
    return token;
  }

  /**
   * One Octokit per repository per worker.
   *
   * GitHub App installation tokens expire after an hour, and a sync tick is
   * allowed to run for two, so the credentials provider is asked per tick rather
   * than once at startup; it caches and refreshes internally.
   */
  private async octokitFor(repo: string): Promise<Octokit> {
    const existing = this.octokits.get(repo);
    if (existing) {
      return existing;
    }

    const created = this.createOctokit(repo);
    this.octokits.set(repo, created);
    return created;
  }

  private async createOctokit(repo: string): Promise<Octokit> {
    const { logger } = this.options;
    const token = await this.tokenFor(repo);

    return new ThrottledOctokit({
      auth: token,
      throttle: {
        onRateLimit: (retryAfter: number, _options: unknown, _octokit: unknown, retryCount: number) => {
          logger.warn(`GitHub rate limit hit for ${repo}, retrying in ${retryAfter}s (attempt ${retryCount + 1})`);
          return retryCount < 3;
        },
        onSecondaryRateLimit: (retryAfter: number, _options: unknown, _octokit: unknown, retryCount: number) => {
          // Triggered by burst concurrency rather than total volume, so backing
          // off once is usually enough.
          logger.warn(`GitHub secondary rate limit for ${repo}, retrying in ${retryAfter}s`);
          return retryCount < 2;
        },
      },
    });
  }
}

export function isIgnored(fileName: string): boolean {
  return IGNORED_FILES.some(pattern => pattern.test(fileName));
}

function splitRepo(repo: string): [string, string] {
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    throw new Error(`Expected a GitHub repository as 'owner/name', got '${repo}'`);
  }
  return [owner, name];
}

function statusOf(error: unknown): number | undefined {
  return (error as { status?: number })?.status;
}

import type { LoggerService } from '@backstage/backend-plugin-api';
import { createHash } from 'crypto';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

import type { KubespecStore } from '../database/KubespecStore';
import type { MetadataEntry, MetadataLinkEntry } from '../database/types';

/** Documentation that lives alongside the content and is not content itself. */
const IGNORED_FILES = new Set(['readme.md', 'notice.md']);

export interface MetadataLoaderOptions {
  store: KubespecStore;
  logger: LoggerService;
  /** Defaults to the directory packaged with this plugin. */
  directory: string;
}

export interface MetadataLoadResult {
  examples: number;
  links: number;
  warnings: string[];
}

/**
 * Loads hand-authored examples and documentation links into the database.
 *
 * The layout mirrors the upstream project's, so its corpus copies over untouched:
 *
 *   metadata/<source>/<apiVersionFull>/<kind lowercased>/1-example.md
 *   metadata/<source>/<apiVersionFull>/<kind lowercased>/<kind>.json
 *
 * `apiVersionFull` may itself contain a slash (`cert-manager.io/v1`), so it is
 * whatever lies between the source directory and the kind directory.
 *
 * Runs once at startup rather than during a sync: the content ships with the
 * code, so an edited example takes effect on deploy without waiting for a tick.
 */
export class MetadataLoader {
  constructor(private readonly options: MetadataLoaderOptions) {}

  async load(): Promise<MetadataLoadResult> {
    const { store, logger, directory } = this.options;
    const warnings: string[] = [];

    const files = await this.listFiles(directory, warnings);
    const examples: MetadataEntry[] = [];
    const links: MetadataLinkEntry[] = [];

    for (const file of files) {
      if (IGNORED_FILES.has(file.name.toLowerCase())) {
        continue;
      }

      const location = this.locationOf(file.relativePath);
      if (!location) {
        warnings.push(`${file.relativePath}: expected <source>/<apiVersion>/<kind>/<file>`);
        continue;
      }

      try {
        if (file.name.endsWith('.md')) {
          examples.push(parseExample(location, file.name, await readFile(file.absolutePath, 'utf-8')));
        } else if (file.name.endsWith('.json')) {
          links.push(...parseLinks(location, await readFile(file.absolutePath, 'utf-8')));
        }
      } catch (error) {
        warnings.push(`${file.relativePath}: ${(error as Error).message}`);
      }
    }

    await store.replaceMetadata(examples, links);
    await store.refreshHasMetadata();

    for (const warning of warnings) {
      logger.warn(`Kubespec metadata: ${warning}`);
    }
    logger.info(`Kubespec metadata loaded: ${examples.length} example(s), ${links.length} link(s)`);

    return { examples: examples.length, links: links.length, warnings };
  }

  private async listFiles(
    directory: string,
    warnings: string[],
  ): Promise<Array<{ absolutePath: string; relativePath: string; name: string }>> {
    const files: Array<{ absolutePath: string; relativePath: string; name: string }> = [];

    const walk = async (current: string, relative: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch (error) {
        // An absent directory is normal: a deployment may ship no examples at all.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          warnings.push(`cannot read ${relative || '.'}: ${(error as Error).message}`);
        }
        return;
      }

      for (const entry of entries) {
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(join(current, entry.name), childRelative);
        } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
          files.push({
            absolutePath: join(current, entry.name),
            relativePath: childRelative,
            name: entry.name,
          });
        }
      }
    };

    await walk(directory, '');
    return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  private locationOf(relativePath: string): MetadataLocation | undefined {
    const segments = relativePath.split(/[/\\]/).filter(Boolean);
    if (segments.length < 4) {
      return undefined;
    }

    const [sourceSlug, ...rest] = segments;
    const kindLower = rest[rest.length - 2];
    const apiVersionFull = rest.slice(0, rest.length - 2).join('/');
    if (!apiVersionFull || !kindLower) {
      return undefined;
    }

    return { sourceSlug, apiVersionFull, kindLower: kindLower.toLowerCase() };
  }
}

export interface MetadataLocation {
  sourceSlug: string;
  apiVersionFull: string;
  kindLower: string;
}

/** `1-pod-probes.md` -> ordinal 1, slug `pod-probes`. */
function parseFileName(name: string): { ordinal: number; slug: string } {
  const withoutExtension = name.replace(/\.md$/, '');
  const match = /^(\d+)-(.*)$/.exec(withoutExtension);
  if (!match) {
    return { ordinal: 0, slug: withoutExtension };
  }
  return { ordinal: Number(match[1]), slug: match[2] };
}

export function parseExample(location: MetadataLocation, fileName: string, source: string): MetadataEntry {
  const { ordinal, slug } = parseFileName(fileName);
  const { frontmatter, body } = splitFrontmatter(source);

  return {
    ...location,
    slug,
    ordinal,
    title: typeof frontmatter.title === 'string' ? frontmatter.title : slug,
    description: typeof frontmatter.description === 'string' ? frontmatter.description : undefined,
    content: extractCodeBlock(body),
    contentHash: createHash('sha256').update(source).digest('hex'),
  };
}

/**
 * Splits `---`-delimited YAML frontmatter from the body.
 *
 * Hand-rolled rather than adding `gray-matter`: the format is three lines of
 * convention, and `yaml` is already a dependency for reading CRDs.
 */
function splitFrontmatter(source: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = source.replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(normalized);
  if (!match) {
    return { frontmatter: {}, body: normalized };
  }

  const parsed = parseYaml(match[1]);
  return {
    frontmatter: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {},
    body: match[2],
  };
}

/**
 * Pulls the YAML out of the first fenced code block.
 *
 * The example is served as plain YAML rather than markdown, so nothing on the
 * page has to render markdown just to show a manifest.
 */
function extractCodeBlock(body: string): string {
  const match = /```[a-zA-Z]*\r?\n([\s\S]*?)```/.exec(body);
  return (match ? match[1] : body).trim();
}

export function parseLinks(location: MetadataLocation, source: string): MetadataLinkEntry[] {
  const parsed = JSON.parse(source) as { links?: Array<{ name?: string; href?: string }> };

  return (parsed.links ?? [])
    .filter((link): link is { name: string; href: string } => Boolean(link?.name && link?.href))
    .map((link, ordinal) => ({ ...location, ordinal, name: link.name, href: link.href }));
}

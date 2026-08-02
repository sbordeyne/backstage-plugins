export interface PackageJsonFacts {
  buildTool: string;
  framework: string;
  languageVersion: string;
}

const FRAMEWORK_MAP: Array<[string, string]> = [
  ['@nestjs/core', 'nestjs'],
  ['next', 'nextjs'],
  ['nuxt', 'nuxtjs'],
  ['fastify', 'fastify'],
  ['express', 'express'],
  ['koa', 'koa'],
];

export function parsePackageJson(content: string, hasYarnLock: boolean): PackageJsonFacts {
  let pkg: any;
  try {
    pkg = JSON.parse(content);
  } catch {
    return { buildTool: 'unknown', framework: 'unknown', languageVersion: '' };
  }

  const buildTool = hasYarnLock ? 'yarn' : 'npm';

  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };

  let framework = 'unknown';
  for (const [dep, name] of FRAMEWORK_MAP) {
    if (dep in allDeps) {
      framework = name;
      break;
    }
  }

  // Strip non-numeric prefix from engines.node (e.g. ">=18" → "18")
  const rawNode = String(pkg.engines?.node ?? '');
  const languageVersion = rawNode.replace(/[^0-9.]/g, '').split('.')[0] ?? '';

  return { buildTool, framework, languageVersion };
}

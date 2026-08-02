import { XMLParser } from 'fast-xml-parser';

export interface PomFacts {
  languageVersion: string;
  framework: string;
  springBootVersion: string;
  metricsFramework: string;
}

export function parsePom(xmlContent: string): PomFacts {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    // Ensure single-child arrays are always arrays, not plain objects
    isArray: tagName => tagName === 'dependency' || tagName === 'plugin' || tagName === 'execution',
  });

  let doc: any;
  try {
    doc = parser.parse(xmlContent);
  } catch {
    return emptyPomFacts();
  }

  const project = doc?.project ?? {};
  const props = project.properties ?? {};

  // languageVersion: check properties first, then compiler plugin config
  let languageVersion = String(props['java.version'] ?? props['maven.compiler.source'] ?? '').trim();

  if (!languageVersion) {
    const build = project.build ?? {};
    const plugins: any[] = [build.plugins?.plugin ?? []].flat();
    const compilerPlugin = plugins.find((p: any) => String(p.artifactId ?? '').includes('maven-compiler-plugin'));
    const conf = compilerPlugin?.configuration ?? {};
    languageVersion = String(conf.release ?? conf.source ?? '').trim();
  }

  // Spring Boot parent detection
  const parent = project.parent ?? {};
  const isSpringBoot = String(parent.artifactId ?? '').trim() === 'spring-boot-starter-parent';
  const springBootVersion = isSpringBoot ? String(parent.version ?? '').trim() : '';
  const framework = isSpringBoot ? 'spring-boot' : 'unknown';

  // Micrometer detection
  const depsSection = project.dependencies ?? {};
  const dependencies: any[] = [depsSection.dependency ?? []].flat();
  const hasMicrometer = dependencies.some((d: any) => String(d.groupId ?? '').startsWith('io.micrometer'));
  const metricsFramework = hasMicrometer ? 'micrometer' : 'unknown';

  return { languageVersion, framework, springBootVersion, metricsFramework };
}

function emptyPomFacts(): PomFacts {
  return {
    languageVersion: '',
    framework: 'unknown',
    springBootVersion: '',
    metricsFramework: 'unknown',
  };
}

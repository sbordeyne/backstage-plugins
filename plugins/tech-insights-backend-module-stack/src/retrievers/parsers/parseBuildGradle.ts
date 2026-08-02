export interface GradleFacts {
  languageVersion: string;
  framework: string;
  metricsFramework: string;
}

export function parseBuildGradle(content: string): GradleFacts {
  // languageVersion: sourceCompatibility = 21 | '21' | JavaVersion.VERSION_21
  const srcCompatMatch =
    content.match(/sourceCompatibility\s*=\s*['"]?(\d[\d.]*)['"]?/) ?? content.match(/JavaVersion\.VERSION_(\d+)/);
  const languageVersion = srcCompatMatch?.[1] ?? '';

  // Spring Boot: id 'org.springframework.boot' plugin present
  const isSpringBoot = /id\s+['"]org\.springframework\.boot['"]/.test(content);
  const framework = isSpringBoot ? 'spring-boot' : 'unknown';

  // Micrometer: any io.micrometer dependency
  const hasMicrometer = /['"]io\.micrometer:/.test(content);
  const metricsFramework = hasMicrometer ? 'micrometer' : 'unknown';

  return { languageVersion, framework, metricsFramework };
}

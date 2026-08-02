const BROWSERS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Edge', pattern: /Edg[e]?\// },
  { name: 'Chrome', pattern: /Chrome\// },
  { name: 'Firefox', pattern: /Firefox\// },
  { name: 'Safari', pattern: /Safari\// },
];

/**
 * Mobile platforms come first: their user agents also carry desktop tokens, so an
 * iPhone would otherwise be reported as macOS and an Android phone as Linux.
 */
const PLATFORMS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'iOS', pattern: /iPhone|iPad/ },
  { name: 'Android', pattern: /Android/ },
  { name: 'macOS', pattern: /Mac OS X|Macintosh/ },
  { name: 'Windows', pattern: /Windows/ },
  { name: 'Linux', pattern: /Linux|X11/ },
];

/**
 * Suggests a name for the device key this browser is about to enroll, so that a user
 * looking at their device list can tell which entry is which.
 *
 * @public
 */
export function describeBrowser(userAgent: string): string {
  const browser = BROWSERS.find(candidate => candidate.pattern.test(userAgent))?.name;
  const platform = PLATFORMS.find(candidate => candidate.pattern.test(userAgent))?.name;
  if (browser && platform) {
    return `${browser} on ${platform}`;
  }
  return browser ?? platform ?? 'This browser';
}

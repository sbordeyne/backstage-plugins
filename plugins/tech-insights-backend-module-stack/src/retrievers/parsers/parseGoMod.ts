export interface GoModFacts {
  languageVersion: string;
}

export function parseGoMod(content: string): GoModFacts {
  const match = content.match(/^go\s+(\S+)/m);
  return { languageVersion: match?.[1] ?? '' };
}

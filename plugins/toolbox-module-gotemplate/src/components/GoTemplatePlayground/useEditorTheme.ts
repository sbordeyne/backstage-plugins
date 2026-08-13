import { useEffect, useState } from 'react';
import { appThemeApiRef, useApi } from '@backstage/core-plugin-api';

/**
 * Resolves the Monaco theme from the Backstage theme rather than from the OS.
 *
 * Backstage's theme is a user choice that need not match `prefers-color-scheme`,
 * so reading the media query would leave the editors light inside a dark app for
 * anyone who set the theme explicitly.
 */
export function useEditorTheme(): 'vs' | 'vs-dark' {
  const appThemeApi = useApi(appThemeApiRef);
  const [variant, setVariant] = useState<'light' | 'dark'>(() =>
    resolveVariant(appThemeApi.getActiveThemeId(), appThemeApi.getInstalledThemes()),
  );

  useEffect(() => {
    const subscription = appThemeApi.activeThemeId$().subscribe(themeId => {
      setVariant(resolveVariant(themeId, appThemeApi.getInstalledThemes()));
    });
    return () => subscription.unsubscribe();
  }, [appThemeApi]);

  return variant === 'dark' ? 'vs-dark' : 'vs';
}

function resolveVariant(
  themeId: string | undefined,
  themes: { id: string; variant?: 'light' | 'dark' }[],
): 'light' | 'dark' {
  const active = themes.find(theme => theme.id === themeId);
  if (active?.variant) return active.variant;

  // No explicit selection means the app follows the system preference.
  if (!themeId && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return active?.variant ?? 'light';
}

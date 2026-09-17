/**
 * Dark or light, remembered per browser.
 *
 * Dark is the dashboard's own look and stays the default: a fresh browser, a
 * private window, or a machine where storage is blocked all open dark. Light is
 * a choice the reader makes, and the only thing it changes is colour — every
 * filter, export and table behaves identically in both.
 *
 * The attribute lives on `<html>` rather than on a React root, for two reasons:
 * the page background is painted from `html`/`body` before React mounts, and
 * the inline script in index.html sets the same attribute on first paint so the
 * page never flashes dark before switching. `color-scheme` follows it so the
 * browser's own furniture — scrollbars, form controls, the autofill tint —
 * matches the theme instead of staying dark on a white page.
 */
export type Theme = 'dark' | 'light'

/** Kept in step with the inline script in index.html. */
export const THEME_KEY = 'jnt-theme'

export const THEME_LABEL: Record<Theme, string> = {
  dark: 'Mode Gelap',
  light: 'Mode Terang',
}

/** What the browser remembers, defaulting to dark whenever it cannot say. */
export function storedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    /* private mode, or site data blocked — the default is the answer */
    return 'dark'
  }
}

/** Paints the theme and remembers it. A refused write is not an error worth
 *  showing: the page is already in the right theme for this session. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* nothing to do — the choice simply does not survive a reload */
  }
}

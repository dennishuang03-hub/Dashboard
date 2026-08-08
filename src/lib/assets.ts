/**
 * Image assets out of `src/assets`, resolved by name rather than imported.
 *
 * A plain `import bg from './assets/Background-image.jpg'` would be shorter and
 * would also fail the *build* if the file is ever missing or renamed — and this
 * project has already been bitten twice by exactly that class of problem, where
 * the dashboard works on the machine that has the file and breaks on the Linux
 * box that builds it. A glob that matches nothing is `{}`, so a missing image
 * costs a fallback instead of a broken deploy.
 *
 * Matching is by pattern, not by exact filename, for the same reason: someone
 * saving a new export as `JT Express Logo White v2.png` should not have to edit
 * TypeScript for the logo to keep working.
 */
const ASSETS = import.meta.glob('../assets/*.{png,jpg,jpeg,svg,webp}', {
  query: '?url', import: 'default', eager: true,
}) as Record<string, string>

/** Every asset, sorted by path so the choice is stable across machines. */
const ENTRIES = Object.entries(ASSETS).sort(([a], [b]) => a.localeCompare(b))

/** First asset whose path matches every pattern given. */
function pick(...tests: RegExp[]): string | null {
  const hit = ENTRIES.find(([path]) => tests.every((re) => re.test(path)))
  return hit ? hit[1] : null
}

/**
 * The wordmark on white, for the red plate and for anything sitting on a dark
 * photograph — which is both places it is used.
 */
export const LOGO_WHITE: string | null =
  pick(/logo/i, /white/i) ?? pick(/jt[-_ ]?express[-_ ]?logo/i) ?? pick(/logo/i)

/**
 * The general-purpose mark. Unchanged from what the top bar already resolved to,
 * deliberately — this module was added for the login screen and should not
 * quietly restyle the dashboard on its way past.
 */
export const LOGO_DEFAULT: string | null =
  pick(/jt[-_ ]?express[-_ ]?logo/i) ?? pick(/logo/i)

/** Never let a logo file win a non-logo slot — they share this folder. */
const NOT_LOGO = /^(?!.*logo).*$/i

/**
 * The login screen's backdrop.
 *
 * Tried in order of how clearly the name says "this is a background", rather
 * than as one combined pattern: `hero.png` also sits in this folder, and with a
 * single pattern which of the two wins would come down to how `localeCompare`
 * happens to order their filenames. That is not a thing anyone should have to
 * reason about when swapping a picture.
 */
export const LOGIN_BG: string | null =
  pick(/background/i, NOT_LOGO)
  ?? pick(/[-_/]bg[-_.]/i, NOT_LOGO)
  ?? pick(/hero/i, NOT_LOGO)

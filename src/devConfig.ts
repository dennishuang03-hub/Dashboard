/**
 * The development switch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *   SKIP_LOGIN = true    →  no login screen. Straight to the dashboard.
 *   SKIP_LOGIN = false   →  the login screen, exactly as in production.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This is the only line to change. Leave it `true` while working on the
 * dashboard; set it `false` when you want to test the sign-in flow itself.
 *
 * **You do not have to remember to turn it off before deploying.** Two separate
 * things make sure of that, and either one alone would be enough:
 *
 *  1. `import.meta.env.DEV` is `false` in a production build, and Vite replaces
 *     it with that literal at build time — so `skipLogin` folds to `false` and
 *     the branch is removed from the bundle entirely. The flag is not read in
 *     production; it does not exist there.
 *
 *  2. Even if it somehow were read, skipping the login screen only changes what
 *     the browser *draws*. The numbers come from `/api/report`, which checks the
 *     session cookie on the server before it opens the file. A bypassed screen
 *     in production would show an empty dashboard, not your data.
 *
 * A switch that can only fail safely is one you can leave alone.
 *
 * The dashboard still needs a workbook to draw. `npm run dev` serves one from
 * `data/` through a dev-only stand-in for `/api/report` — see `devApi()` in
 * vite.config.ts — so skipping the login gives you a working dashboard rather
 * than an empty one. To exercise the real sign-in against the real functions,
 * use `vercel dev` instead.
 */
export const SKIP_LOGIN = true

/**
 * What the rest of the app actually asks. Never `SKIP_LOGIN` on its own — the
 * `import.meta.env.DEV` half is the part that makes this safe, so the two are
 * kept welded together in one exported value rather than left to each caller to
 * remember.
 */
export const skipLogin: boolean = import.meta.env.DEV && SKIP_LOGIN

/**
 * Who you are when the login is skipped.
 *
 * `role: 'team'` because that is what the real team account issues today, so
 * development sees the same permissions production does. When the per-agent
 * accounts land, switching `agent` to a Kode Agent here is how you will preview
 * a single agent's view without ten test logins.
 */
export const DEV_IDENTITY = {
  user: 'dev',
  role: 'team',
  agent: null,
} as const

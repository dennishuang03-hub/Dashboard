/**
 * The J&T wordmark, shared by the dashboard's top bar and the login screen.
 *
 * Lifted out of Dashboard.tsx when the login page arrived: the sign-in screen is
 * the first thing anyone sees, and a second, slightly-different mark drawn there
 * would be the kind of small inconsistency that makes an internal tool look
 * improvised.
 */

/**
 * The supplied logo file, when there is one.
 *
 * Globbed rather than imported for the same reason the workbook once was: the
 * repo does not carry the image, and a static `import` of a missing file fails
 * the build, so anyone cloning this before adding the artwork would get nothing
 * to run. Anything with "logo" in the name matches — `hero.png`, `react.svg` and
 * `vite.svg` share the folder and must not be mistaken for it.
 */
const LOGOS = import.meta.glob('../assets/*.{png,jpg,jpeg,svg,webp}', {
  query: '?url', import: 'default', eager: true,
}) as Record<string, string>

const logoUrl: string | null = (() => {
  const named = Object.entries(LOGOS).filter(([p]) => /logo/i.test(p))
  if (!named.length) return null
  // an exact JT-Express-Logo.* beats any other file that merely says "logo"
  const exact = named.find(([p]) => /jt[-_ ]?express[-_ ]?logo/i.test(p))
  return (exact ?? named.sort(([a], [b]) => a.localeCompare(b))[0])[1]
})()

/**
 * The drawn fallback is a wordmark, not the real logo — close enough to read as
 * J&T at a glance, honest enough not to be mistaken for the licensed artwork.
 * The viewBox is cropped tight to the letters so the red plate has no dead
 * margin around it.
 */
export default function JntLogo({ className = 'jtlogo' }: { className?: string }) {
  if (logoUrl) return <img className={className} src={logoUrl} alt="J&T Express" />

  const FONT = "'Arial Black','Arial Bold','Helvetica Neue',Arial,sans-serif"
  return (
    <svg className={className} viewBox="0 0 262 58" role="img" aria-label="J&T Express">
      <g fill="#fff" transform="skewX(-11)">
        {/* kept on one line: SVG would otherwise fold the surrounding JSX
            indentation into a leading space and nudge the glyphs right */}
        <text x="24" y="46" fontFamily={FONT} fontSize="48" fontWeight="900" letterSpacing="-1.5">J&amp;T</text>
        <text x="132" y="46" fontFamily={FONT} fontSize="26" fontWeight="900" letterSpacing="0.5">EXPRESS</text>
        {/* speed lines: they meet the top-right of the T and fan out to the
            right, matching the swoosh on the printed mark */}
        <rect x="118" y="2" width="52" height="5" />
        <rect x="124" y="10" width="46" height="5" />
        <rect x="130" y="18" width="40" height="5" />
      </g>
    </svg>
  )
}

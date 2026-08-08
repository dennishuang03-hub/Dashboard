/**
 * The J&T wordmark, shared by the dashboard's top bar and the login screen.
 *
 * Lifted out of Dashboard.tsx when the login page arrived: the sign-in screen is
 * the first thing anyone sees, and a second, slightly-different mark drawn there
 * would be the kind of small inconsistency that makes an internal tool look
 * improvised.
 */
import { LOGO_DEFAULT, LOGO_WHITE } from '../lib/assets'

export default function JntLogo({
  className = 'jtlogo',
  variant = 'default',
}: {
  className?: string
  /**
   * `white` asks for the white-lettered file by name. The default resolution
   * usually lands on it anyway, but "usually" is not something the login screen
   * should depend on: it sits on a red plate over a photograph, and a dark
   * wordmark there would be unreadable rather than merely off-brand.
   */
  variant?: 'default' | 'white'
}) {
  const src = variant === 'white' ? LOGO_WHITE : LOGO_DEFAULT
  if (src) return <img className={className} src={src} alt="J&T Express" />

  /**
   * The drawn fallback, for a checkout that does not have the artwork yet — a
   * wordmark close enough to read as J&T at a glance, and honest enough not to
   * be mistaken for the licensed logo. The viewBox is cropped tight to the
   * letters so the red plate has no dead margin around it.
   */
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

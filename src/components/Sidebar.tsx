/**
 * The application rail.
 *
 * The dashboard used to be one very long page: agent-level performance on top,
 * the 1,666-row drop-point list underneath, and no way to look at the second
 * without scrolling past the first. They are two different reports read by two
 * different people on two different mornings, and stacking them meant every
 * visit started with the wrong one.
 *
 * So they became two destinations, and this is what chooses between them. It is
 * built as a list of groups rather than as two hard-coded buttons, because more
 * reports are coming — adding one is an entry in `NAV`, not a change here.
 *
 * ── Three states, not two ────────────────────────────────────────────────────
 *
 *   full     the default on a wide screen: icons and labels, content pushed over
 *   mini     icons only, 66px, content pushed over by that much instead
 *   drawer   below 900px: off-canvas over the content, with a scrim
 *
 * `mini` peeks back open on hover. That is the part worth being careful about:
 * the expansion is an *overlay*, so the page underneath does not reflow. A rail
 * that pushed the content every time the pointer crossed it would make the whole
 * dashboard jump on the way to the scrollbar, which is the exact failure mode
 * that gives hover-expand its bad reputation. Widening over the top costs
 * nothing and cannot move a chart out from under the cursor.
 *
 * Hover is a convenience layered on the toggle, never a replacement for it: the
 * button at the top of the rail is the real control, so the rail is fully usable
 * from a keyboard and on a touchscreen that has no hover at all.
 */
import { useEffect } from 'react'
/* React's synthetic event, not the DOM global of the same name. Imported by name
   rather than reached for as `React.MouseEvent`, which under the modern JSX
   transform is a UMD-global reference in a file that has no `React` import. */
import type { MouseEvent } from 'react'
import JntLogo from './JntLogo'
import Zh from './Zh'

export type IconName =
  | 'grid' | 'pin' | 'clock' | 'check' | 'trend' | 'bars' | 'users' | 'db' | 'gear'
  | 'logout' | 'collapse' | 'expand' | 'close' | 'menu'

export interface NavItem {
  id: string
  label: string
  zh?: string
  icon: IconName
  /** shown under the label in the expanded rail — what the destination is for */
  hint?: string
  /** a count or short tag on the right, e.g. "1666" */
  tag?: string
}

export interface NavGroup {
  id: string
  /** the small caps heading above the group; omit for an ungrouped run */
  label?: string
  items: NavItem[]
}

/**
 * 24×24 stroke icons, drawn here rather than pulled from a package.
 *
 * Six icons is not worth a dependency, and a stroke set defined in one place
 * stays visually consistent — same 1.9px weight, same round caps — in a way that
 * mixing an icon font with a couple of hand-drawn SVGs never does.
 */
function Icon({ name }: { name: IconName }) {
  const p = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  return (
    <svg className="navico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === 'grid' && (
        <g {...p}>
          <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
        </g>
      )}
      {name === 'pin' && (
        <g {...p}>
          <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" />
          <circle cx="12" cy="10" r="2.6" />
        </g>
      )}
      {name === 'clock' && (
        <g {...p}><circle cx="12" cy="12" r="8.6" /><path d="M12 7v5.3l3.4 2" /></g>
      )}
      {name === 'check' && (
        <g {...p}><circle cx="12" cy="12" r="8.6" /><path d="M8.2 12.3l2.6 2.6 5-5.4" /></g>
      )}
      {name === 'trend' && (
        <g {...p}><path d="M3 16.5l5.5-5.5 3.5 3.5L21 5.5" /><path d="M15.5 5.5H21v5.5" /></g>
      )}
      {name === 'bars' && (
        <g {...p}>
          <path d="M4.5 20V13" /><path d="M9.8 20V8" /><path d="M15.1 20v-6" /><path d="M20.4 20V4" />
        </g>
      )}
      {name === 'users' && (
        <g {...p}>
          <circle cx="9.2" cy="8.4" r="3.4" />
          <path d="M2.8 20a6.4 6.4 0 0 1 12.8 0" />
          <path d="M16.4 5.4a3.4 3.4 0 0 1 0 6.4M17.6 14.4A6.4 6.4 0 0 1 21.4 20" />
        </g>
      )}
      {name === 'db' && (
        <g {...p}>
          <ellipse cx="12" cy="6" rx="7.6" ry="3" />
          <path d="M4.4 6v6c0 1.7 3.4 3 7.6 3s7.6-1.3 7.6-3V6" />
          <path d="M4.4 12v6c0 1.7 3.4 3 7.6 3s7.6-1.3 7.6-3v-6" />
        </g>
      )}
      {name === 'gear' && (
        <g {...p}>
          <circle cx="12" cy="12" r="3.1" />
          <path d="M19.2 14.2a1.6 1.6 0 0 0 .32 1.76l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.06-.06a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-.97 1.46V20a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1.04-1.46 1.6 1.6 0 0 0-1.76.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.46-.97H4a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.46-1.04 1.6 1.6 0 0 0-.32-1.76l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.76.32H9.8a1.6 1.6 0 0 0 .97-1.46V4a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.76-.32l.06-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.76v.08a1.6 1.6 0 0 0 1.46.97H20a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.46.97z" />
        </g>
      )}
      {name === 'logout' && (
        <g {...p}>
          <path d="M9.5 4.5H5.4A1.4 1.4 0 0 0 4 5.9v12.2a1.4 1.4 0 0 0 1.4 1.4h4.1" />
          <path d="M15.4 16.4L19.8 12l-4.4-4.4" /><path d="M19.8 12H9.5" />
        </g>
      )}
      {/* The two chevrons of the reference mark: « collapses, » expands. */}
      {name === 'collapse' && (
        <g {...p}><path d="M11.5 6l-6 6 6 6" /><path d="M19 6l-6 6 6 6" /></g>
      )}
      {name === 'expand' && (
        <g {...p}><path d="M5 6l6 6-6 6" /><path d="M12.5 6l6 6-6 6" /></g>
      )}
      {name === 'close' && <g {...p}><path d="M6 6l12 12M18 6L6 18" /></g>}
      {name === 'menu' && (
        <g {...p}><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></g>
      )}
    </svg>
  )
}

/**
 * Give up focus when a button was pressed with a pointer — but not when it was
 * pressed with the keyboard.
 *
 * This is what keeps the collapsed rail from sticking open, and the bug it fixes
 * is worth spelling out because the cause is nowhere near where it shows up.
 *
 * The rail peeks open on `:hover` *or* `:focus-within`, the second so that
 * tabbing through a 66px column of icons shows the labels being tabbed through.
 * But a mouse click on a `<button>` also leaves it focused. So: collapse the
 * rail, move the pointer away, and `:hover` goes false while `:focus-within`
 * stays true — because focus is still sitting on the button that was just
 * clicked. The rail stays wide over the report indefinitely, and nothing the
 * pointer does closes it, because the pointer is not what is holding it open.
 * Clicking a destination did the same thing.
 *
 * `e.detail` is the click count, and it is `0` for a click synthesised from
 * Enter or Space — so this drops focus for the mouse, which never wanted the
 * expansion, and keeps it for the keyboard, which is the only reason the
 * `:focus-within` half exists.
 *
 * The CSS alternative is `:has(:focus-visible)`, which says the same thing more
 * directly. It is not used because an unsupported `:has()` invalidates the whole
 * selector list it appears in, and the list it would appear in is the one that
 * hides the labels — the failure mode is a 66px rail with its text spilling out
 * of it, which is worse than the bug being fixed.
 */
function dropPointerFocus(e: MouseEvent<HTMLButtonElement>) {
  if (e.detail > 0) e.currentTarget.blur()
}

export default function Sidebar({
  groups, active, onSelect, mini, onToggleMini, drawerOpen, onCloseDrawer, onSignOut, user,
}: {
  groups: NavGroup[]
  active: string
  onSelect: (id: string) => void
  /** desktop: icons only */
  mini: boolean
  onToggleMini: () => void
  /** mobile: the rail is over the page */
  drawerOpen: boolean
  onCloseDrawer: () => void
  onSignOut: () => void
  user: string
}) {
  /**
   * While the drawer is over the page, Escape closes it and the page behind it
   * does not scroll.
   *
   * The scroll lock is the half that is easy to skip and immediately noticed:
   * a drawer that lets the report scroll underneath it turns a thumb-swipe meant
   * for the menu into a swipe through 1,666 rows, and the menu is then floating
   * over somewhere completely different when it closes.
   */
  useEffect(() => {
    if (!drawerOpen) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseDrawer() }
    document.addEventListener('keydown', esc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = prev
    }
  }, [drawerOpen, onCloseDrawer])

  return (
    <>
      {/* Click-anywhere-else, and a dimmer that says the page behind is out of
          play. Rendered always and faded by CSS rather than mounted on demand,
          so the fade has something to animate from. */}
      <div
        className={`sbscrim${drawerOpen ? ' on' : ''}`}
        onClick={onCloseDrawer}
        aria-hidden="true"
      />

      <aside className="sidebar" aria-label="Navigasi utama">
        <div className="sbhead">
          <div className="sblogo"><JntLogo variant="plain" /></div>
          {/* Tagline and wordmark are one unit and disappear together with the
              rail's width — in `mini` the header is a 66px column and there is
              nothing to put a line of prose on. */}
          <span className="sbtag">Kenyamanan, Hingga sampai</span>

          {/*
            The one control, at the top.

            It was going to be a "Tutup Sidebar" row at the bottom of the list,
            which is where the reference puts it, and that is the wrong end: it
            is not a destination and should not sit in a column of destinations,
            and at the bottom of a list that will keep growing it eventually
            falls below the fold. Up here it is next to the thing it resizes and
            it stays put however many reports get added.

            The same button carries the mobile close, because on a phone
            "collapse the rail" and "put the drawer away" are the same wish; only
            the glyph changes.
          */}
          <button
            className="sbtoggle"
            onClick={(e) => {
              dropPointerFocus(e)
              if (drawerOpen) onCloseDrawer()
              else onToggleMini()
            }}
            title={drawerOpen ? 'Tutup menu' : mini ? 'Buka sidebar' : 'Tutup sidebar'}
            aria-label={drawerOpen ? 'Tutup menu' : mini ? 'Buka sidebar' : 'Tutup sidebar'}
            aria-expanded={!mini}
          >
            <span className="sbt-drawer"><Icon name="close" /></span>
            <span className="sbt-rail"><Icon name={mini ? 'expand' : 'collapse'} /></span>
          </button>
        </div>

        <nav className="sbnav">
          {groups.map((g) => (
            <div className="sbgroup" key={g.id}>
              {/* The heading collapses to a rule rather than disappearing: in
                  `mini` the words will not fit, but the *break* between two
                  groups still has to be visible or the icons run together into
                  one undifferentiated column. */}
              {g.label && <span className="sbgh">{g.label}</span>}
              {g.items.map((it) => (
                <button
                  key={it.id}
                  className={`sbitem${active === it.id ? ' on' : ''}`}
                  onClick={(e) => { dropPointerFocus(e); onSelect(it.id) }}
                  aria-current={active === it.id ? 'page' : undefined}
                  /* The native tooltip is the label's stand-in while the rail is
                     collapsed and the pointer has not sat still long enough to
                     expand it. */
                  title={it.label}
                >
                  <Icon name={it.icon} />
                  <span className="sbtext">
                    <span className="sbl">{it.label}<Zh>{it.zh ?? ''}</Zh></span>
                    {it.hint && <span className="sbh">{it.hint}</span>}
                  </span>
                  {it.tag && <span className="sbtag-n">{it.tag}</span>}
                </button>
              ))}
            </div>
          ))}

          {/*
            Deliberate empty space, held for the reports that are not built yet.

            The footer is already pinned by the nav's own `flex:1` — this is not
            doing that. What it does is keep the growing part of the rail
            visually open: a new group added above lands in room that was
            obviously waiting for it, instead of appearing squeezed against the
            divider over LogOut.
          */}
          <div className="sbfill" />
        </nav>

        <div className="sbfoot">
          <button
            className="sbitem danger"
            onClick={(e) => { dropPointerFocus(e); onSignOut() }}
            title={`Keluar — ${user}`}
          >
            <Icon name="logout" />
            <span className="sbtext">
              <span className="sbl">LogOut</span>
              <span className="sbh">{user}</span>
            </span>
          </button>
          <div className="sbbrand">
            <span className="sbbrand-n">J&amp;T EXPRESS</span>
            <span className="sbbrand-s">Connecting a Better Tomorrow</span>
          </div>
        </div>
      </aside>
    </>
  )
}

/** The hamburger in the top bar — the only way into the drawer on a phone. */
export function NavButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="navbtn" onClick={onClick} aria-label="Buka menu">
      <Icon name="menu" />
    </button>
  )
}

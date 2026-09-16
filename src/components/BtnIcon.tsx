/**
 * The small glyphs that sit in front of an action button's label.
 *
 * Each export writes a different kind of file, and the icon is what lets a
 * row of three buttons be told apart before the words are read: a picture, a
 * page, a grid. Stroked at 1.8 so they carry the same weight as the 13px
 * bold label beside them, and `currentColor` so each button's hover colour
 * reaches the icon without a second rule.
 */
export type BtnIconName = 'image' | 'pdf' | 'sheet' | 'spin' | 'list' | 'collapse' | 'check' | 'clear' | 'retry' | 'close'

export default function BtnIcon({ name }: { name: BtnIconName }) {
  const p = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  return (
    <svg className={`bico${name === 'spin' ? ' bico-spin' : ''}`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {name === 'image' && (
        <g {...p}>
          <rect x="1.8" y="3" width="12.4" height="10" rx="1.8" />
          <circle cx="5.6" cy="6.4" r="1.2" />
          <path d="M2.4 12.2l3.8-3.6 2.6 2.4 2-1.8 3 2.8" />
        </g>
      )}
      {name === 'pdf' && (
        <g {...p}>
          <path d="M9.4 1.8H4.2a1.4 1.4 0 0 0-1.4 1.4v9.6a1.4 1.4 0 0 0 1.4 1.4h7.6a1.4 1.4 0 0 0 1.4-1.4V5.6z" />
          <path d="M9.2 1.8v3.9h4" />
          <path d="M5.4 9h5.2M5.4 11.4h3.4" />
        </g>
      )}
      {name === 'sheet' && (
        <g {...p}>
          <rect x="2" y="2.4" width="12" height="11.2" rx="1.6" />
          <path d="M2 6.2h12M2 9.9h12M6.4 2.4v11.2" />
        </g>
      )}
      {name === 'spin' && (
        <g {...p}><path d="M14 8a6 6 0 1 1-2.2-4.64" /></g>
      )}
      {name === 'list' && (
        <g {...p}><path d="M4.5 6l3.5 3.5L11.5 6" /></g>
      )}
      {name === 'collapse' && (
        <g {...p}><path d="M4.5 10l3.5-3.5L11.5 10" /></g>
      )}
      {name === 'check' && (
        <g {...p}><rect x="2" y="2" width="12" height="12" rx="2.6" /><path d="M5 8.2l2.1 2.1L11.2 6" /></g>
      )}
      {name === 'clear' && (
        <g {...p}><path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" /></g>
      )}
      {name === 'retry' && (
        <g {...p}><path d="M13.4 7.2A5.4 5.4 0 1 0 12.2 11" /><path d="M13.8 3v4.2H9.6" /></g>
      )}
      {name === 'close' && (
        <g {...p}><path d="M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4" /></g>
      )}
    </svg>
  )
}

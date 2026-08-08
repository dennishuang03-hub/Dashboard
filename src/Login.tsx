/**
 * Sign-in screen.
 *
 * Deliberately thin. Every decision that matters — is this the right password,
 * how long may the session last, may this person see the workbook — is made by
 * `/api/login` on the server. This component collects two strings, posts them,
 * and reports what came back.
 *
 * That thinness is the security property, not a shortcut. A login screen that
 * decided anything locally would be deciding it inside the visitor's own browser,
 * where they can edit the answer. There is nothing here worth tampering with
 * because there is nothing here to tamper with: no password, no hash, no token,
 * no "isLoggedIn" flag that unlocks the data. The session arrives as an HttpOnly
 * cookie this code cannot read, and the numbers arrive from a route that checks
 * that cookie before it opens the file.
 */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import JntLogo from './components/JntLogo'
import Zh from './components/Zh'
import { LOGIN_BG } from './lib/assets'
import type { CSSProperties } from 'react'
import type { Identity } from './lib/session'
import './dashboard.css'

/**
 * The backdrop is handed to CSS as a custom property rather than set as an
 * inline `background-image`, so the stylesheet keeps ownership of the dark
 * overlay laid over it. A photograph straight behind a form is unreadable at
 * some point in the day — the overlay is what guarantees the card and its labels
 * stay legible whatever the image turns out to be.
 */
const bgStyle: CSSProperties | undefined = LOGIN_BG
  ? ({ '--login-bg': `url("${LOGIN_BG}")` } as CSSProperties)
  : undefined

/* Stroked rather than filled, at 18px, so the icon sits at the same visual
   weight as the label type beside it instead of becoming a black blob. */
function Eye() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M6.61 6.61A18.4 18.4 0 0 0 1 12s4 8 11 8a9 9 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  )
}

export default function Login({ onSignedIn }: { onSignedIn: (who: Identity) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const userRef = useRef<HTMLInputElement>(null)
  useEffect(() => { userRef.current?.focus() }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr('')

    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /* The cookie the server sets is the whole point of the call, and a
           cross-origin default would drop it. */
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      })

      const data = (await r.json().catch(() => ({}))) as {
        error?: string; user?: string; role?: 'team' | 'agent'; agent?: string | null
      }

      if (!r.ok) {
        /*
         * A failure with no `error` field did not come from our API.
         *
         * Every route here answers a failure in JSON with a sentence in it, so
         * the fallback below only fires when something *else* replied — Vercel's
         * HTML 404 when the function was never deployed, or its 500 when the
         * function threw on the way up. Those are configuration problems, and
         * the old text ("Tidak dapat masuk. Coba lagi.") sent people to check
         * their password instead, which was the one thing that was fine.
         *
         * The status code is the whole diagnosis, so it goes on screen: 404 is
         * "not deployed", 500 is "crashed", 401 would have carried a message of
         * its own.
         */
        setErr(data.error || `Server membalas ${r.status}${
          r.status === 404 ? ' — /api/login tidak ditemukan (fungsi belum ter-deploy).'
          : r.status >= 500 ? ' — fungsi login gagal berjalan. Periksa log di Vercel.'
          : '.'}`)
        /* Clear only the password. Retyping the username after a typo in the
           other field is a small, pointless annoyance. */
        setPassword('')
        return
      }

      onSignedIn({
        user: data.user ?? username,
        role: data.role ?? 'team',
        agent: data.agent ?? null,
      })
    } catch {
      setErr('Tidak dapat menghubungi server. Periksa koneksi Anda.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`loginpage${LOGIN_BG ? ' has-bg' : ''}`} style={bgStyle}>
      {/* The mark sits above the card rather than inside it, on the page itself.
          It is a sibling of the form, not a child, so nothing about the card —
          its padding, its clipped corners, its `overflow:hidden` — can crop the
          raised edge the logo casts. */}
      <div className="loginstack">
        <div className="loginbrand plain">
          <JntLogo className="jtlogo" variant="plain" />
        </div>

        <form className="logincard" onSubmit={submit} noValidate>
          <div className="loginbody">
          <h1>
            DASHBOARD PERFORMA AGEN HARIAN
            <Zh>每日代理区绩效看板</Zh>
          </h1>
          {/* No Mandarin gloss on this line: the convention in this project is
              that headings are glossed and running prose is not (see Zh.tsx). */}
          <p className="loginsub">
            Halaman ini khusus untuk tim internal. Masuk untuk melihat laporan.
          </p>

          <label className="loginfield">
            <span>Nama Pengguna <Zh>用户名</Zh></span>
            <input
              ref={userRef}
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
              required
            />
          </label>

          <label className="loginfield">
            <span>Kata Sandi <Zh>密码</Zh></span>
            <span className="pwwrap">
              <input
                name="password"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
              />
              {/*
                A reveal toggle earns its place on a shared-account login: the
                password is long and came out of a password manager, and without
                it a single mistyped character is indistinguishable from a wrong
                password — which is exactly the confusion that wastes an
                afternoon. It is off by default and never persists.

                `type="button"` because the default inside a <form> is submit,
                which would fire a login attempt on every peek. `onMouseDown`
                is prevented so the caret stays where it was rather than the
                field losing focus mid-typing.
              */}
              <button
                type="button"
                className="pweye"
                onClick={() => setShowPw((v) => !v)}
                onMouseDown={(e) => e.preventDefault()}
                disabled={busy}
                aria-pressed={showPw}
                aria-label={showPw ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                title={showPw ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
              >
                {showPw ? <EyeOff /> : <Eye />}
              </button>
            </span>
          </label>

          {/* `role="alert"` so a screen reader announces the failure instead of
              leaving the user wondering why nothing happened. */}
          {err && <div className="loginerr" role="alert">{err}</div>}

          <button className="loginbtn" type="submit" disabled={busy || !username || !password}>
            {busy ? 'Memeriksa…' : 'Login'}
          </button>

          <p className="loginnote">
            Sesi berakhir otomatis setelah 8 jam. Jangan bagikan akun ini di luar tim.
          </p>
          </div>
        </form>
      </div>
    </div>
  )
}

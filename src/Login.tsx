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

export default function Login({ onSignedIn }: { onSignedIn: (who: Identity) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
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
      <form className="logincard" onSubmit={submit} noValidate>
        <div className="loginbrand">
          <JntLogo className="jtlogo" variant="white" />
        </div>

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
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
            />
          </label>

          {/* `role="alert"` so a screen reader announces the failure instead of
              leaving the user wondering why nothing happened. */}
          {err && <div className="loginerr" role="alert">{err}</div>}

          <button className="loginbtn" type="submit" disabled={busy || !username || !password}>
            {busy ? 'Memeriksa…' : 'Masuk'}
          </button>

          <p className="loginnote">
            Sesi berakhir otomatis setelah 8 jam. Jangan bagikan akun ini di luar tim.
          </p>
        </div>
      </form>
    </div>
  )
}

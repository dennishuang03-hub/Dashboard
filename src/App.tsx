/**
 * The gate.
 *
 * On load the app asks `/api/session` who it is talking to, and shows either the
 * login screen or the dashboard. Three details are worth stating, because each
 * one is a mistake that is easy to make here:
 *
 *  1. The answer comes from the server, every load. There is no `isLoggedIn`
 *     flag in localStorage, because a flag the browser stores is a flag the
 *     browser's owner can set. The session lives in an HttpOnly cookie this code
 *     cannot read, which is precisely why it has to ask.
 *
 *  2. This gate is a *convenience*, not the protection. Anyone can edit the
 *     JavaScript in their own browser to render <Dashboard /> unconditionally —
 *     and get an empty one, because the numbers come from `/api/report`, which
 *     checks the cookie itself. The rule is that the client decides what to draw
 *     and the server decides what exists.
 *
 *  3. `booting` exists so an already-signed-in user does not see the login form
 *     flash past on every refresh.
 */
import { useCallback, useEffect, useState } from 'react'
import Dashboard from './Dashboard'
import Login from './Login'
import type { Identity } from './lib/session'
import './dashboard.css'

export default function App() {
  const [who, setWho] = useState<Identity | null>(null)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    let cancelled = false

    fetch('/api/session', { credentials: 'same-origin' })
      .then(async (r) => {
        if (!r.ok) return null
        return (await r.json()) as Identity
      })
      .then((id) => { if (!cancelled) setWho(id) })
      /* A network failure is not a session — fall through to the login screen
         rather than leaving the user on a spinner with nothing to do. */
      .catch(() => { if (!cancelled) setWho(null) })
      .finally(() => { if (!cancelled) setBooting(false) })

    return () => { cancelled = true }
  }, [])

  /** Called by the dashboard when the server says a request was unauthorised. */
  const onExpired = useCallback(() => setWho(null), [])

  if (booting) return <div className="bootscreen">Memeriksa sesi…</div>
  if (!who) return <Login onSignedIn={setWho} />
  return <Dashboard who={who} onSignedOut={onExpired} />
}

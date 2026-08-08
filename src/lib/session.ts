/**
 * What the browser is allowed to know about who is signed in.
 *
 * This is the whole of it: a name, a role, and — once the per-agent accounts
 * exist — which agent the session belongs to. No token, no expiry the client can
 * act on, nothing that could be edited into more access than it started with.
 * The session itself lives in an HttpOnly cookie that this code cannot read; the
 * shape below is only the answer `/api/session` gives when asked.
 *
 * It lives in its own file so that both the login screen and the dashboard can
 * refer to it without one of them having to import the other.
 */
export interface Identity {
  user: string
  role: 'team' | 'agent'
  /** Kode Agent this session is scoped to, or null for the whole region. */
  agent: string | null
}

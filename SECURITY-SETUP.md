# Login & security — setup and reasoning

The dashboard is behind a login. This document is what you need to switch it on,
what it actually protects, and what it does not.

---

## 1. Generate the secrets

On your own machine, in the project folder:

```bash
npm run secrets
```

It asks for a password twice, hidden, and prints three values. **The password is
never written to a file, never sent anywhere, and never shown on screen.** Only
its scrypt hash leaves the tool, and a hash cannot be turned back into the
password — not by an attacker, and not by you. If it is lost, run the tool again
and replace the variable.

No password? `npm run secrets -- --generate` invents a strong one and shows it
once. Put it straight into the team password manager.

---

## 2. Put them in Vercel

Project → **Settings** → **Environment Variables**. Add all three to
**Production**, **Preview** and **Development**:

| Variable | What it is |
|---|---|
| `AUTH_USERNAME` | the team account name, e.g. `team` |
| `AUTH_PASSWORD_HASH` | the `scrypt$…` line from step 1 |
| `SESSION_SECRET` | the long random string from step 1 — signs session cookies |

Then **Redeploy**. Environment variables are read at request time, but a deploy
is the cleanest way to be sure.

If any of the three is missing the API refuses every request with a 503 rather
than letting anyone in. A broken deploy is safer than an open one.

---

## 3. Move the workbook

```
my-app/
  data/
    Dashboard Data 06 Agustus 2026 (Value) Updated.xlsx   ← move it here
  src/
    Data/                                                  ← delete the folder
```

Commit and push the file. `/api/report` serves the newest spreadsheet in `data/`,
and only to a signed-in session.

Until you move it the server still finds it in `src/Data/` — that fallback exists
so pulling this change does not blank your dashboard, not because the old
location is fine.

---

## 4. Check the repository is private

`https://github.com/dennishuang03-hub/Dashboard` → Settings → General → Danger
Zone → **Change repository visibility → Private**.

This matters more than everything above. The workbook is committed to Git, so a
public repo publishes the report regardless of how good the login is. The
dashboard cannot protect a file that GitHub is also serving.

---

## What this actually protects

**The data is served by the server, not shipped to the browser.** That is the
whole design. Before, the workbook was a Vite asset with a public URL: anyone who
loaded the page could open the Network tab and download the regional report, and
any login drawn in React would have been decoration — the visitor's browser runs
that code and can be told to skip it.

Now `/api/report` reads the session cookie before it opens the file. Editing the
JavaScript still lets someone render an empty dashboard. It does not produce
data, because the data was never sent.

The specific measures:

- **scrypt** password hashing (N=32768, r=8) — about 100 ms and 34 MB per guess.
  A ten-million-word list costs roughly eleven CPU-days *per server instance*.
  The stored value is a hash; a leak of the environment variables does not hand
  anyone the password.
- **Constant-time comparison** on username, password digest and cookie
  signature, so response timing leaks nothing about how close a guess was.
- **One error message** for every login failure, so the form cannot be used to
  discover which usernames exist.
- **A response-time floor** on `/api/login`, so a wrong username and a wrong
  password take the same time.
- **HMAC-SHA256 signed sessions.** The cookie says who you are; the signature
  makes it un-editable without `SESSION_SECRET`. Deliberately not a JWT — that
  format's `alg` header is a well-known source of authentication bypasses, and
  this app needs exactly one algorithm.
- **HttpOnly + Secure + SameSite=Strict** cookie. JavaScript cannot read it, so
  an XSS bug cannot steal the session; it never travels over plain HTTP; and it
  is never sent on a request another site started, which is what makes CSRF a
  non-event here. This is also why the token is *not* in `localStorage` — that
  is precisely a token any injected script can read.
- **An Origin check** on every POST, as a second lock on the same door.
- **8-hour sessions.** A shift, not a month.
- **Security headers** in `vercel.json`: a content-security policy, HSTS,
  `X-Frame-Options: DENY` (no clickjacking), `nosniff`, `no-referrer`.
- **`no-store` on every API response**, so Vercel's shared CDN never holds a copy
  of one person's answer and serves it to the next request.

## What it does not protect against

Worth being straight about.

- **A shared password.** One account, one password, everyone who has it sees
  everything. When someone leaves the team, rotate it (step 1 and 2 again).
- **Brute force from many IPs.** The rate limiter lives in each serverless
  instance's memory, so it is neither shared nor durable — an attacker who
  reconnects enough will meet a fresh instance. scrypt's cost is the real
  defence, together with a long password. If you want a hard limit, add Vercel
  KV or Upstash Redis and move the counter there.
- **A public GitHub repo.** See step 4.
- **Someone already signed in on an unlocked machine.** No software fixes this.
- **Phishing.** A convincing fake login page collects passwords no matter how
  the real one is built.

---

## Adding the ten agent accounts later

The pieces are already in place for it, which is why the session token carries a
`role` and an `agent` field it does not yet need.

1. Replace the single `AUTH_USERNAME` / `AUTH_PASSWORD_HASH` pair with a small
   table of accounts — one hash and one Kode Agent each. At eleven accounts a
   JSON environment variable is still reasonable; beyond that, use a database.
2. In `api/login.ts`, look the user up in that table and issue
   `{ r: 'agent', a: 'AGENT12' }` instead of `{ r: 'team', a: null }`.
3. In `api/report.ts`, at the marked comment: when `session.a` is set, open the
   workbook **on the server**, drop every row belonging to another agent, and
   send back only what remains.

Step 3 is the one that matters. Filtering in the browser instead would mean
sending all ten agents' numbers to all ten agents and asking the page not to draw
nine of them — which is not a restriction, just a rendering choice the viewer can
undo in the developer console.

---

## Local development

The API routes need Vercel's runtime, so plain `npm run dev` serves the UI with
no `/api` behind it — the login will fail to reach the server. Use:

```bash
npm i -g vercel     # once
vercel link         # once, connects this folder to the project
vercel env pull     # writes .env.local — it is gitignored
vercel dev          # UI + API together
```

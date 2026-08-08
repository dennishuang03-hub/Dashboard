/**
 * Make a route work under either calling convention Vercel might use.
 *
 * Vercel's Node runtime supports two shapes of function:
 *
 *   web     (request: Request) => Response          — what these routes are written in
 *   legacy  (req: IncomingMessage, res: ServerResponse) => void
 *
 * and it decides which one it is looking at by inspecting the export. When it
 * guesses "legacy" for a handler written in the web style, the failure is
 * immediate and total: `req.headers` on an IncomingMessage is a plain object, so
 * the first `req.headers.get(...)` throws `TypeError: req.headers.get is not a
 * function`, the invocation dies, and the browser gets
 * FUNCTION_INVOCATION_FAILED with nothing useful in it.
 *
 * Rather than keep guessing which convention this deployment uses, `adapt`
 * accepts both. One argument means the web signature and the handler is called
 * as-is; two means the legacy one, so the Node request is converted into a
 * `Request`, and the `Response` that comes back is written out to the
 * `ServerResponse`. The route itself stays written the one way, and the question
 * of how Vercel invokes it stops mattering.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

export type WebHandler = (req: Request) => Promise<Response>

/** Node's request object → a WHATWG `Request`. */
async function toRequest(req: IncomingMessage): Promise<Request> {
  /* `Request` demands an absolute URL, and Node only gives us the path. The
     forwarded headers are what the browser actually addressed, which is also
     what `originAllowed` compares against. */
  const host = header(req, 'x-forwarded-host') ?? header(req, 'host') ?? 'localhost'
  const proto = header(req, 'x-forwarded-proto') ?? 'https'
  const url = new URL(req.url ?? '/', `${proto}://${host}`)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue
    if (Array.isArray(value)) for (const one of value) headers.append(key, one)
    else headers.set(key, value)
  }

  /* A marker for /api/health, so the diagnostic can report which convention the
     runtime actually used. Set on the converted request only, and stripped of
     any client-supplied value first so it cannot be spoofed into lying. */
  headers.delete('x-vercel-adapted')
  headers.set('x-vercel-adapted', '1')

  const method = (req.method ?? 'GET').toUpperCase()

  /* A GET or HEAD may not carry a body, and handing `Request` an empty one for
     those throws rather than being ignored. */
  let body: Uint8Array | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
    }
    const joined = Buffer.concat(chunks)
    if (joined.byteLength) body = new Uint8Array(joined)
  }

  return new Request(url, { method, headers, body })
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

/** A `Response` → written out on Node's response object. */
async function send(res: ServerResponse, out: Response): Promise<void> {
  res.statusCode = out.status

  /* Set-Cookie is the one header that may legitimately appear more than once,
     and `forEach` folds repeats into a single comma-joined string — which for
     cookies produces one malformed cookie instead of two good ones. It is taken
     out separately and set as an array. */
  const withGetter = out.headers as Headers & { getSetCookie?: () => string[] }
  const cookies = typeof withGetter.getSetCookie === 'function'
    ? withGetter.getSetCookie.call(out.headers)
    : []

  out.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return
    res.setHeader(key, value)
  })
  if (cookies.length) res.setHeader('Set-Cookie', cookies)

  const buf = Buffer.from(await out.arrayBuffer())
  res.end(buf)
}

/**
 * The returned function deliberately declares two parameters: some versions of
 * the runtime read `fn.length` to tell the conventions apart, and a one-argument
 * function advertises itself as web-only. Declaring both and branching on what
 * actually arrives is the arrangement that cannot be misread either way.
 */
export function adapt(fn: WebHandler) {
  return async function route(
    a: Request | IncomingMessage,
    b?: ServerResponse,
  ): Promise<Response | void> {
    if (!b) return fn(a as Request)
    const out = await fn(await toRequest(a as IncomingMessage))
    await send(b, out)
  }
}

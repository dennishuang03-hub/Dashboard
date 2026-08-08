#!/usr/bin/env node
/**
 * Generate the two secrets the deployment needs, without either of them ever
 * leaving this machine in plaintext.
 *
 *   node scripts/hash-password.mjs
 *
 * It prints an AUTH_PASSWORD_HASH and a SESSION_SECRET to paste into Vercel's
 * environment variables. The password you type is never written to a file, never
 * sent anywhere, and never echoed to the terminal — it exists only long enough
 * to be hashed. Nobody else, including whoever set this project up, needs to
 * know it.
 *
 * The hash is not reversible. If the password is lost, run this again and
 * replace the variable; there is no recovery, by design.
 */
import { randomBytes, scrypt as scryptCb } from 'node:crypto'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'

/* Must stay in step with SCRYPT / KEYLEN / MAXMEM in api/_lib/auth.ts. The
   parameters are written into the digest, so a mismatch here still produces a
   hash the server can verify — but at whatever cost this file chose, which is
   not what the server was tuned for. */
const SCRYPT = { N: 32768, r: 8, p: 1 }
const KEYLEN = 64
const MAXMEM = 96 * 1024 * 1024

const scrypt = (password, salt, keylen, opts) =>
  new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, dk) => {
      if (err) reject(err)
      else resolve(dk)
    })
  })

const MIN_LEN = 12

/**
 * Whether we can actually hide what is typed.
 *
 * Echo suppression needs a real terminal. Git Bash / MinTTY on Windows pipes
 * stdin instead of attaching a TTY, and there the mute silently does nothing —
 * the password would be typed in clear view and left sitting in the scrollback.
 * Better to say so and stop than to promise a privacy this cannot deliver.
 */
const canHide = process.stdin.isTTY === true

/** Ask for a line with the echo suppressed, so shoulder-surfing gets nothing. */
function askHidden(prompt) {
  return new Promise((resolve) => {
    let muted = false
    const out = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk)
        cb()
      },
    })
    const rl = createInterface({ input: process.stdin, output: out, terminal: true })
    rl.question(prompt, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
    muted = true
  })
}

async function hashPassword(password) {
  const salt = randomBytes(16)
  const dk = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { ...SCRYPT, maxmem: MAXMEM })
  return [
    'scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString('base64url'), dk.toString('base64url'),
  ].join('$')
}

/**
 * A generated suggestion, offered because a password someone invents under mild
 * pressure is usually the weakest link in an otherwise sound setup. 24 base64url
 * characters is ~144 bits — not memorable, which is the point: it belongs in the
 * team's password manager, not in anyone's head.
 */
function suggest() {
  return randomBytes(18).toString('base64url')
}

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  Usage: node scripts/hash-password.mjs [--generate]

    (no flags)   type your own password, hidden
    --generate   invent a strong password, show it once, hash it
`)
  process.exit(0)
}

console.log('\n  J&T Dashboard — secret setup\n')

let password

if (args.includes('--generate')) {
  password = suggest()
  console.log('  Kata sandi baru (simpan di password manager sekarang — hanya ditampilkan sekali):\n')
  console.log(`      ${password}\n`)
} else if (!canHide) {
  console.error('  ✗ Terminal ini tidak dapat menyembunyikan ketikan Anda.')
  console.error('    (Git Bash / MinTTY tidak menyediakan TTY untuk Node.)\n')
  console.error('    Gunakan PowerShell atau Command Prompt, atau jalankan:')
  console.error('        npm run secrets -- --generate\n')
  process.exit(1)
} else {
  password = await askHidden('  Kata sandi (tidak ditampilkan): ')
  const again = await askHidden('  Ulangi kata sandi          : ')

  if (password !== again) {
    console.error('\n  ✗ Kata sandi tidak cocok. Tidak ada yang dibuat.\n')
    process.exit(1)
  }
  if (password.length < MIN_LEN) {
    console.error(`\n  ✗ Terlalu pendek — minimal ${MIN_LEN} karakter.`)
    console.error(`    Saran: ${suggest()}\n`)
    process.exit(1)
  }
}

process.stdout.write('\n  Menghitung scrypt (butuh ~1 detik)… ')
const hash = await hashPassword(password)
process.stdout.write('selesai.\n')

console.log(`
  ────────────────────────────────────────────────────────────────
  Salin ke Vercel → Project → Settings → Environment Variables
  (Production, Preview, dan Development)
  ────────────────────────────────────────────────────────────────

  AUTH_USERNAME
  team

  AUTH_PASSWORD_HASH
  ${hash}

  SESSION_SECRET
  ${randomBytes(48).toString('base64url')}

  ────────────────────────────────────────────────────────────────
  · AUTH_USERNAME boleh diganti sesuai keinginan.
  · SESSION_SECRET baru = semua sesi yang sedang berjalan berakhir.
  · Jangan commit nilai-nilai ini ke Git.
`)

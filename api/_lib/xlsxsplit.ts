/**
 * Send half a workbook.
 *
 * ── Why a route has any business opening a zip ───────────────────────────────
 *
 * The dashboard already reads only the tabs the page in front of the reader
 * needs — the OTPU tabs wait until somebody opens an OTPU page. That halved the
 * time the browser spends parsing, and it did nothing at all for the time spent
 * downloading, because the tabs it was not reading still arrived in the same
 * file. On a 10 Mbps line that is the larger half: 4,6 s of download against
 * 4,1 s of parse, measured, on the file this was written for.
 *
 * An .xlsx is a zip, and each worksheet is its own entry in it. So the two
 * halves can be separated without understanding a single cell: read the central
 * directory, decide which worksheet entries belong to the half being asked for,
 * and copy the rest across **still compressed**. Nothing is inflated but the two
 * small XML parts that say which entry is which sheet, so this costs
 * milliseconds rather than the seconds a real parse would.
 *
 * The daily half of the current file is 1,32 MB where the whole thing is 5,44 MB.
 *
 * ── Why the result is still a workbook ───────────────────────────────────────
 *
 * `xl/workbook.xml` is kept whole, so the file still *names* every sheet — the
 * missing ones simply have no part behind them. SheetJS answers that with a
 * `SheetNames` listing all of them and a `Sheets` holding the ones that came,
 * which is exactly the shape `parseWorkbook` already tolerates from the client's
 * own `readWorkbookSheets`. Neither side needs a new code path; the file just
 * arrives smaller.
 *
 * ── What it refuses to do ────────────────────────────────────────────────────
 *
 * Every unexpected shape — Zip64, encryption, an entry whose size the central
 * directory does not state outright — returns the original bytes untouched. A
 * workbook that arrives whole is slow; a workbook this file has guessed wrong
 * about is a dashboard that will not open, and the second failure is much worse
 * than the first.
 */
import { inflateRawSync } from 'node:zlib'

export type ReportPart = 'daily' | 'otpu' | 'full'

/**
 * Which tabs are the OTPU report.
 *
 * Deliberately the same two patterns as `isOtpuSheet` in `src/lib/jnt.ts`, which
 * is where the browser makes the identical decision — change one and change the
 * other. They are duplicated rather than shared because this file runs in the
 * serverless function and that one pulls in SheetJS; four lines of regex is a
 * smaller price than either half importing the other's world.
 */
const OTPU_TAB_RE = /^\s*otpu\s*[-_ ]*(agen|seller)/i

/* Signatures and the fixed field offsets of the two zip headers this reads. */
const SIG_EOCD = 0x06054b50
const SIG_EOCD64_LOCATOR = 0x07064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
/** A field holding this in a 32-bit slot means "the real value is in a Zip64 extra". */
const ZIP64_MARKER = 0xffffffff

interface Entry {
  /** the raw name bytes, copied through rather than re-encoded */
  nameRaw: Buffer
  name: string
  flags: number
  method: number
  time: number
  date: number
  crc: number
  csize: number
  usize: number
  /** the compressed bytes, exactly as they sit in the source file */
  data: Buffer
}

/** Read the central directory. `null` for anything this cannot honestly handle. */
function readEntries(b: Buffer): Entry[] | null {
  /* The end-of-central-directory record is last, but a zip comment can follow
     it, so it is found by scanning back — bounded by the 64 KB a comment may
     be. */
  let eocd = -1
  const floor = Math.max(0, b.length - (0xffff + 22))
  for (let i = b.length - 22; i >= floor; i--) {
    if (b.readUInt32LE(i) === SIG_EOCD) { eocd = i; break }
  }
  if (eocd < 0) return null
  /* Zip64 puts a locator immediately before the classic record. Nothing this
     serves is anywhere near four gigabytes, so its presence means the file is
     not the shape assumed here and is left alone. */
  if (eocd >= 20 && b.readUInt32LE(eocd - 20) === SIG_EOCD64_LOCATOR) return null

  const count = b.readUInt16LE(eocd + 10)
  let off = b.readUInt32LE(eocd + 16)
  if (count === 0xffff || off === ZIP64_MARKER) return null

  const out: Entry[] = []
  for (let i = 0; i < count; i++) {
    if (off + 46 > b.length || b.readUInt32LE(off) !== SIG_CENTRAL) return null
    const flags = b.readUInt16LE(off + 8)
    if (flags & 0x01) return null                       // encrypted
    const csize = b.readUInt32LE(off + 20)
    const usize = b.readUInt32LE(off + 24)
    const nlen = b.readUInt16LE(off + 28)
    const elen = b.readUInt16LE(off + 30)
    const clen = b.readUInt16LE(off + 32)
    const lho = b.readUInt32LE(off + 42)
    if (csize === ZIP64_MARKER || usize === ZIP64_MARKER || lho === ZIP64_MARKER) return null
    if (lho + 30 > b.length || b.readUInt32LE(lho) !== SIG_LOCAL) return null

    const nameRaw = b.subarray(off + 46, off + 46 + nlen)
    /* The local header carries its own name and extra lengths, and they are not
       always the central directory's — the data begins after whatever *it*
       says. */
    const dataStart = lho + 30 + b.readUInt16LE(lho + 26) + b.readUInt16LE(lho + 28)
    if (dataStart + csize > b.length) return null

    out.push({
      nameRaw,
      name: nameRaw.toString('utf8'),
      flags,
      method: b.readUInt16LE(off + 10),
      time: b.readUInt16LE(off + 12),
      date: b.readUInt16LE(off + 14),
      crc: b.readUInt32LE(off + 16),
      csize,
      usize,
      data: b.subarray(dataStart, dataStart + csize),
    })
    off += 46 + nlen + elen + clen
  }
  return out
}

/** Write the entries back out, compressed bytes and all, in the order given. */
function writeZip(entries: Entry[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const e of entries) {
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(SIG_LOCAL, 0)
    lh.writeUInt16LE(20, 4)
    /* Bit 3 says "the sizes are in a descriptor after the data". They are in
       this header instead, so the bit is cleared and nothing trails the data. */
    lh.writeUInt16LE(e.flags & ~0x08, 6)
    lh.writeUInt16LE(e.method, 8)
    lh.writeUInt16LE(e.time, 10)
    lh.writeUInt16LE(e.date, 12)
    lh.writeUInt32LE(e.crc, 14)
    lh.writeUInt32LE(e.csize, 18)
    lh.writeUInt32LE(e.usize, 22)
    lh.writeUInt16LE(e.nameRaw.length, 26)
    lh.writeUInt16LE(0, 28)
    parts.push(lh, e.nameRaw, e.data)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(SIG_CENTRAL, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(e.flags & ~0x08, 8)
    ch.writeUInt16LE(e.method, 10)
    ch.writeUInt16LE(e.time, 12)
    ch.writeUInt16LE(e.date, 14)
    ch.writeUInt32LE(e.crc, 16)
    ch.writeUInt32LE(e.csize, 20)
    ch.writeUInt32LE(e.usize, 24)
    ch.writeUInt16LE(e.nameRaw.length, 28)
    ch.writeUInt32LE(offset, 42)
    central.push(ch, e.nameRaw)

    offset += 30 + e.nameRaw.length + e.data.length
  }

  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, eocd])
}

/** One entry's bytes, inflated. Only ever called on the two small XML parts. */
function textOf(e: Entry): string {
  if (e.method === 0) return e.data.toString('utf8')
  if (e.method !== 8) throw new Error(`unsupported compression method ${e.method}`)
  return inflateRawSync(e.data).toString('utf8')
}

const unescapeXml = (s: string): string => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  /* last, or an escaped `&amp;lt;` would come out as a tag */
  .replace(/&amp;/g, '&')

const attr = (tag: string, name: string): string => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`))
  return m ? unescapeXml(m[1]) : ''
}

/**
 * Sheet name → the zip entry holding it.
 *
 * `workbook.xml` lists the sheets in order, each pointing at a relationship id;
 * `workbook.xml.rels` says which file that id is. Both are a few kilobytes, and
 * they are the only two entries this module ever inflates.
 */
function sheetParts(entries: Entry[]): Map<string, string> | null {
  const wb = entries.find((e) => e.name === 'xl/workbook.xml')
  const rels = entries.find((e) => e.name === 'xl/_rels/workbook.xml.rels')
  if (!wb || !rels) return null

  const target = new Map<string, string>()
  for (const tag of textOf(rels).match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attr(tag, 'Id')
    let t = attr(tag, 'Target').replace(/^\/?xl\//, '').replace(/^\//, '')
    if (!id || !t) continue
    t = `xl/${t}`
    target.set(id, t)
  }

  const out = new Map<string, string>()
  for (const tag of textOf(wb).match(/<sheet\b[^>]*>/g) ?? []) {
    const name = attr(tag, 'name')
    /* `r:id` is the usual spelling, but the namespace prefix is the author's to
       choose, so anything ending in `:id` counts. */
    const rid = attr(tag, 'r:id') || attr(tag, 'id') || attr(tag, 'relationships:id')
    const path = target.get(rid)
    if (name && path) out.set(name, path)
  }
  return out.size ? out : null
}

/**
 * The requested half of `bytes`, or `bytes` unchanged when the split is not
 * safe to make.
 */
export function splitWorkbook(bytes: Buffer, part: ReportPart): Buffer {
  if (part === 'full') return bytes

  const entries = readEntries(bytes)
  if (!entries) return bytes

  let parts: Map<string, string> | null
  try {
    parts = sheetParts(entries)
  } catch {
    return bytes
  }
  if (!parts) return bytes

  /* Worksheet entries to leave behind — the other half's. Only worksheets are
     ever dropped: styles, shared strings, the workbook part and every rel go in
     both halves, and together they are a fraction of either. */
  const drop = new Set<string>()
  for (const [name, path] of parts) {
    const isOtpu = OTPU_TAB_RE.test(name)
    if (part === 'otpu' ? !isOtpu : isOtpu) drop.add(path)
  }
  if (!drop.size) return bytes

  const kept = entries.filter((e) => !drop.has(e.name))
  try {
    return writeZip(kept)
  } catch {
    return bytes
  }
}

/** `?part=` as one of the three understood values; anything else is `daily`. */
export function partOf(raw: string | null): ReportPart {
  return raw === 'otpu' || raw === 'full' ? raw : 'daily'
}

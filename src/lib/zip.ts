/**
 * A ZIP archive, written in the browser, with no library.
 *
 * Only what "a folder of PNGs" needs: every entry is stored, not deflated —
 * a PNG is already compressed, and deflating it again buys a percent or two for
 * a lot of code. Names are flagged UTF-8 (bit 11), so an RM name with an accent
 * or a Mandarin gloss comes out of Windows Explorer the way it went in. A name
 * with a `/` in it lands in a folder; no separate directory entry is needed.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/** MS-DOS time and date, the only clock a ZIP header has. */
function dosStamp(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export async function zipStore(files: { name: string; data: Blob }[]): Promise<Blob> {
  const enc = new TextEncoder()
  const { time, date } = dosStamp(new Date())
  const parts: (ArrayBuffer | Uint8Array<ArrayBuffer>)[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0

  for (const f of files) {
    const name = enc.encode(f.name)
    const data = new Uint8Array(await f.data.arrayBuffer())
    const crc = crc32(data)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034B50, true)
    local.setUint16(4, 20, true)          // version needed
    local.setUint16(6, 0x0800, true)      // UTF-8 names
    local.setUint16(8, 0, true)           // stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    parts.push(local.buffer, name, data)

    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014B50, true)
    cd.setUint16(4, 20, true)             // made by
    cd.setUint16(6, 20, true)             // version needed
    cd.setUint16(8, 0x0800, true)
    cd.setUint16(10, 0, true)
    cd.setUint16(12, time, true)
    cd.setUint16(14, date, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, data.length, true)
    cd.setUint32(24, data.length, true)
    cd.setUint16(28, name.length, true)
    cd.setUint32(42, offset, true)        // extra, comment, disk, attributes stay 0
    const entry = new Uint8Array(46 + name.length)
    entry.set(new Uint8Array(cd.buffer), 0)
    entry.set(name, 46)
    central.push(entry)

    offset += 30 + name.length + data.length
  }

  const cdSize = central.reduce((n, e) => n + e.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054B50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)

  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' })
}

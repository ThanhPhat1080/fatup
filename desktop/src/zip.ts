// Minimal ZIP writer ("store" method, no compression): enough to hand several files to the browser as one download.
// Photos and most documents are compressed already, so deflating would cost time and gain almost nothing.

/** A zip is built in memory, so the files of one zip may add up to at most 1 GiB. */
export const ZIP_MAX_BYTES = 1024 ** 3;

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Makes names safe and distinct inside one archive: no path separators, repeats become `name (1).ext`, `name (2).ext`… */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((raw) => {
    const clean = raw.replace(/[\\/]/g, '_') || 'file';
    const dot = clean.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
    let name = clean;
    for (let i = 1; seen.has(name.toLowerCase()); i++) name = `${stem} (${i})${ext}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

export function makeZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    offset += b.length;
  };
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // flag: names are UTF-8
    lv.setUint16(8, 0, true); // method: store
    lv.setUint16(12, 0x21, true); // date 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const head = new Uint8Array(46 + name.length);
    const cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    head.set(name, 46);
    central.push(head);
    push(local);
    push(f.data);
  }
  const start = offset;
  for (const c of central) push(c);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, offset - start, true);
  ev.setUint32(16, start, true);
  push(end);
  const out = new Uint8Array(offset);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

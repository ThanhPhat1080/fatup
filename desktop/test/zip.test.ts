import { describe, expect, it } from 'vitest';
import { makeZip, uniqueNames } from '../src/zip';

const dec = new TextDecoder();

/** Reads the central directory back, like an unzip tool would. */
function readZip(zip: Uint8Array) {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.byteLength - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: { name: string; data: Uint8Array; crc: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = v.getUint16(local + 26, true);
    const lExtra = v.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtra;
    out.push({ name, data: zip.subarray(start, start + size), crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('makeZip', () => {
  it('stores every file under its name with a correct CRC', () => {
    const a = new TextEncoder().encode('hello');
    const b = new Uint8Array([0, 1, 2, 3, 255]);
    const entries = readZip(makeZip([{ name: 'a.txt', data: a }, { name: 'ảnh.bin', data: b }]));
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'ảnh.bin']);
    expect(Array.from(entries[0].data)).toEqual(Array.from(a));
    expect(Array.from(entries[1].data)).toEqual(Array.from(b));
    expect(entries[0].crc).toBe(0x3610a686);
    expect(entries[1].crc).toBe(0x7b35f858);
  });

  it('writes an empty archive that is still valid', () => {
    expect(readZip(makeZip([]))).toEqual([]);
  });
});

describe('uniqueNames', () => {
  it('adds (1), (2) before the extension when names repeat', () => {
    expect(uniqueNames(['a.jpg', 'a.jpg', 'b', 'a.jpg', 'b'])).toEqual(['a.jpg', 'a (1).jpg', 'b', 'a (2).jpg', 'b (1)']);
  });
  it('strips path separators so nothing escapes the folder', () => {
    expect(uniqueNames(['../x/y.txt'])).toEqual(['.._x_y.txt']);
  });
});

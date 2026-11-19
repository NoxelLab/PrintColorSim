export interface Embedded {
  icc: Uint8Array | null;
  /** EXIF の向き（1〜8）。指定がなければ 1。 */
  orientation: number;
}

const ascii = (b: Uint8Array, at: number, text: string) => {
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
};
const u16 = (b: Uint8Array, at: number, le = false) => (le ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1]);
const u32 = (b: Uint8Array, at: number, le = false) =>
  (le ? b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24) : (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

const valid = (icc: Uint8Array | null) => (icc && icc.length >= 128 && ascii(icc, 36, 'acsp') ? icc : null);

/** ICC プロファイルのヘッダーにある色空間（'RGB'、'CMYK' など） */
export const iccSpace = (icc: Uint8Array) => String.fromCharCode(...icc.subarray(16, 20)).trim();

async function png(b: Uint8Array) {
  for (let at = 8; at + 8 <= b.length;) {
    const length = u32(b, at);
    if (ascii(b, at + 4, 'IDAT')) break;
    if (ascii(b, at + 4, 'iCCP')) {
      const data = b.subarray(at + 8, at + 8 + length);
      const zlib = data.slice(data.indexOf(0) + 2);
      const stream = new Blob([zlib]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    at += 12 + length;
  }
  return null;
}

/** TIFF の IFD0 から指定したタグの値の位置と個数を返す */
function tiffTag(b: Uint8Array, base: number, tag: number) {
  const le = b[base] === 0x49;
  const ifd = base + u32(b, base + 4, le);
  for (let i = 0, n = u16(b, ifd, le); i < n; i++) {
    const entry = ifd + 2 + i * 12;
    if (u16(b, entry, le) === tag) return { le, entry, count: u32(b, entry + 4, le), offset: base + u32(b, entry + 8, le) };
  }
  return null;
}

function jpeg(b: Uint8Array): Embedded {
  const parts: Uint8Array[] = [];
  let orientation = 1;
  for (let at = 2; at + 4 <= b.length && b[at] === 0xff;) {
    const marker = b[at + 1], length = u16(b, at + 2);
    if (marker === 0xda) break;
    const data = at + 4;
    if (marker === 0xe2 && ascii(b, data, 'ICC_PROFILE\0')) parts[b[data + 12] - 1] = b.subarray(data + 14, at + 2 + length);
    if (marker === 0xe1 && ascii(b, data, 'Exif\0\0')) {
      const tag = tiffTag(b, data + 6, 0x0112);
      if (tag) orientation = u16(b, tag.entry + 8, tag.le);
    }
    at += 2 + length;
  }
  if (!parts.length) return { icc: null, orientation };
  const icc = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { icc.set(p, at); at += p.length; }
  return { icc, orientation };
}

function tiff(b: Uint8Array) {
  const tag = tiffTag(b, 0, 34675);
  return tag ? b.slice(tag.offset, tag.offset + tag.count) : null;
}

function psd(b: Uint8Array) {
  let at = 26;
  at += 4 + u32(b, at);
  const end = at + 4 + u32(b, at);
  at += 4;
  while (at + 12 <= end && ascii(b, at, '8BIM')) {
    const id = u16(b, at + 4);
    at += 6;
    at += (b[at] + 2) & ~1;
    const size = u32(b, at);
    at += 4;
    if (id === 1039) return b.slice(at, at + size);
    at += (size + 1) & ~1;
  }
  return null;
}

/** ファイルに埋め込まれた ICC プロファイルと向きを取り出す */
export async function extract(b: Uint8Array): Promise<Embedded> {
  let found: Embedded = { icc: null, orientation: 1 };
  try {
    if (ascii(b, 1, 'PNG')) found.icc = await png(b);
    else if (b[0] === 0xff && b[1] === 0xd8) found = jpeg(b);
    else if (ascii(b, 0, 'II*\0') || ascii(b, 0, 'MM\0*')) found.icc = tiff(b);
    else if (ascii(b, 0, '8BPS')) found.icc = psd(b);
  } catch {
    // 壊れたメタデータは埋め込みなしとして扱う
  }
  return { icc: valid(found.icc), orientation: found.orientation };
}

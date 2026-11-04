// Just enough ZIP to edit an .xlsx without npm packages (the platform has
// none): read a zip's entries (stored or deflated) and write a new one.
// Inflate uses the runtime's DecompressionStream when it has one, else the
// small inflater below; writing deflates with CompressionStream when there
// is one, else stores the entries uncompressed (a larger but valid file).

// ---------------------------------------------------------------- CRC-32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- inflate (RFC 1951)
// A plain decoder after the classic "tinf" design: Huffman tables as
// (counts, symbols) and canonical decoding one bit at a time.
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function huffman(lengths) {
  const counts = new Uint16Array(16);
  for (const l of lengths) counts[l]++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
  return { counts, symbols };
}

const FIXED_LIT = huffman([...Array(144).fill(8), ...Array(112).fill(9), ...Array(24).fill(7), ...Array(8).fill(8)]);
const FIXED_DIST = huffman(Array(30).fill(5));

export function inflateRaw(src, sizeHint = src.length * 4) {
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.max(sizeHint, 1024));
  let len = 0;
  const ensure = (n) => {
    if (len + n <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, len + n));
    bigger.set(out.subarray(0, len));
    out = bigger;
  };
  const bit = () => {
    if (!bitCnt) {
      if (pos >= src.length) throw new Error('inflate: unexpected end of data');
      bitBuf = src[pos++];
      bitCnt = 8;
    }
    const b = bitBuf & 1;
    bitBuf >>= 1;
    bitCnt--;
    return b;
  };
  const bits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v |= bit() << i;
    return v;
  };
  const decode = ({ counts, symbols }) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let l = 1; l < 16; l++) {
      code |= bit();
      const count = counts[l];
      if (code - first < count) return symbols[index + code - first];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('inflate: bad Huffman code');
  };

  let final = 0;
  while (!final) {
    final = bit();
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCnt = 0; // stored block: byte aligned
      const n = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      ensure(n);
      out.set(src.subarray(pos, pos + n), len);
      len += n;
      pos += n;
      continue;
    }
    let lit = FIXED_LIT;
    let dist = FIXED_DIST;
    if (type === 2) {
      const hlit = bits(5) + 257;
      const hdist = bits(5) + 1;
      const hclen = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3);
      const clTree = huffman(cl);
      const lengths = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const sym = decode(clTree);
        if (sym < 16) lengths[i++] = sym;
        else {
          let prev = 0;
          let rep;
          if (sym === 16) { prev = lengths[i - 1]; rep = 3 + bits(2); }
          else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          while (rep--) lengths[i++] = prev;
        }
      }
      lit = huffman(lengths.subarray(0, hlit));
      dist = huffman(lengths.subarray(hlit));
    } else if (type !== 1) {
      throw new Error('inflate: bad block type');
    }
    for (;;) {
      const sym = decode(lit);
      if (sym === 256) break;
      if (sym < 256) {
        ensure(1);
        out[len++] = sym;
        continue;
      }
      const li = sym - 257;
      const length = LEN_BASE[li] + bits(LEN_EXTRA[li]);
      const di = decode(dist);
      const back = DIST_BASE[di] + bits(DIST_EXTRA[di]);
      ensure(length);
      for (let i = 0; i < length; i++, len++) out[len] = out[len - back];
    }
  }
  return out.subarray(0, len);
}

// ---------------------------------------------------------------- streams (when the runtime has them)
async function viaStream(Stream, format, bytes) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(new Stream(format)));
  return new Uint8Array(await res.arrayBuffer());
}
const hasStream = (Stream, format) => {
  try {
    return typeof Stream === 'function' && typeof Response === 'function' && typeof Blob === 'function' && !!new Stream(format);
  } catch {
    return false;
  }
};
const NATIVE_INFLATE = hasStream(globalThis.DecompressionStream, 'deflate-raw');
const NATIVE_DEFLATE = hasStream(globalThis.CompressionStream, 'deflate-raw');

// ---------------------------------------------------------------- read
/** A zip's files: [{ name, bytes }] in their original order. */
export async function readZip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip: no end of central directory');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = zip.subarray(start, start + compSize);
    let bytes;
    if (method === 0) bytes = raw;
    else if (method === 8) bytes = NATIVE_INFLATE ? await viaStream(DecompressionStream, 'deflate-raw', raw) : inflateRaw(raw, size);
    else throw new Error(`zip: unsupported method ${method} for ${name}`);
    files.push({ name, bytes });
  }
  return files;
}

// ---------------------------------------------------------------- write
/** A new zip from [{ name, bytes }] (deflated when the runtime can, else stored). */
export async function writeZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, bytes } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(bytes);
    let data = bytes;
    let method = 0;
    if (NATIVE_DEFLATE && bytes.length > 64) {
      const packed = await viaStream(CompressionStream, 'deflate-raw', bytes);
      if (packed.length < bytes.length) { data = packed; method = 8; }
    }
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // UTF-8 names
    head.setUint16(8, method, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, bytes.length, true);
    head.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(head.buffer), nameBytes, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, method, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, bytes.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}

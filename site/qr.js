// QR codes, drawn here: no library and no service. Byte mode (UTF-8), error correction level M, versions 1 to 15
// (up to about 400 characters), the mask with the lowest penalty. Enough for a link to open the app on a phone.
import { s } from "./ui.js";

// version -> [data codewords per block for group 1, blocks in group 1, data per block group 2, blocks group 2, EC codewords per block]
const BLOCKS = [null,
  [16, 1, 0, 0, 10], [28, 1, 0, 0, 16], [44, 1, 0, 0, 26], [32, 2, 0, 0, 18], [43, 2, 0, 0, 24], [27, 4, 0, 0, 16], [31, 4, 0, 0, 18],
  [38, 2, 39, 2, 22], [36, 3, 37, 2, 22], [43, 4, 44, 1, 26], [50, 1, 51, 4, 30], [36, 6, 37, 2, 22], [37, 8, 38, 1, 22],
  [40, 4, 41, 5, 24], [41, 5, 42, 5, 24]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70]];

// arithmetic in GF(256) with the QR polynomial
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x = (x << 1) ^ (x & 0x80 ? 0x11d : 0); }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function ecc(data, n) {
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((g, j) => { next[j] ^= g; next[j + 1] ^= mul(g, EXP[i]); });
    gen = next;
  }
  const rem = [...data, ...new Array(n).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const f = rem[i];
    if (f) for (let j = 0; j < gen.length; j++) rem[i + j] ^= mul(gen[j], f);
  }
  return rem.slice(data.length);
}

const capacity = (v) => { const b = BLOCKS[v]; return b[0] * b[1] + b[2] * b[3]; };

function codewords(bytes, v) {
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const total = capacity(v) * 8;
  put(0, Math.min(4, total - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0; data.length < capacity(v); pad++) data.push(pad % 2 ? 0x11 : 0xec);
  const [d1, n1, d2, n2, ec] = BLOCKS[v];
  const blocks = [];
  let at = 0;
  for (let i = 0; i < n1 + n2; i++) { const len = i < n1 ? d1 : d2; blocks.push(data.slice(at, at + len)); at += len; }
  const ecs = blocks.map((b) => ecc(b, ec));
  const out = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ec; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];

function build(v, words, mask) {
  const n = v * 4 + 17, m = Array.from({ length: n }, () => new Array(n).fill(0)), fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (r, c, on) => { m[r][c] = on ? 1 : 0; fn[r][c] = true; };
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(rr, cc, r >= 0 && r <= 6 && c >= 0 && c <= 6 && ring !== 2);
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const last = ALIGN[v].length - 1;
  ALIGN[v].forEach((r, i) => ALIGN[v].forEach((c, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;   // where the finders are
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }));
  // format information, twice: level M (00) and the mask, protected by a BCH code
  let rem = mask;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const fmt = ((mask << 10) | rem) ^ 0x5412, fb = (i) => (fmt >>> i) & 1;
  for (let i = 0; i <= 5; i++) set(i, 8, fb(i));
  set(7, 8, fb(6)); set(8, 8, fb(7)); set(8, 7, fb(8));
  for (let i = 9; i < 15; i++) set(8, 14 - i, fb(i));
  for (let i = 0; i < 8; i++) set(8, n - 1 - i, fb(i));
  for (let i = 8; i < 15; i++) set(n - 15 + i, 8, fb(i));
  set(n - 8, 8, 1);                                                       // the dark module
  if (v >= 7) {                                                           // version information, twice
    let vr = v;
    for (let i = 0; i < 12; i++) vr = (vr << 1) ^ ((vr >>> 11) * 0x1f25);
    const ver = (v << 12) | vr;
    for (let i = 0; i < 18; i++) { const on = (ver >>> i) & 1, a = n - 11 + (i % 3), b = Math.floor(i / 3); set(b, a, on); set(a, b, on); }
  }
  let bit = 0;
  const bits = words.length * 8;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < n; k++) {
      const up = ((right + 1) & 2) === 0, r = up ? n - 1 - k : k;
      for (const c of [right, right - 1]) {
        if (fn[r][c]) continue;
        const val = bit < bits ? (words[bit >>> 3] >>> (7 - (bit & 7))) & 1 : 0;
        bit++;
        m[r][c] = val ^ (MASKS[mask](r, c) ? 1 : 0);
      }
    }
  }
  return m;
}

function penalty(m) {
  const n = m.length;
  let p = 0;
  for (const line of [m, m[0].map((_, c) => m.map((row) => row[c]))]) {
    for (const row of line) {
      for (let i = 0, run = 1; i < n; i++) {
        if (i + 1 < n && row[i + 1] === row[i]) run++;
        else { if (run >= 5) p += run - 2; run = 1; }
      }
      const str = row.join("");
      for (const pat of ["10111010000", "00001011101"]) for (let i = str.indexOf(pat); i >= 0; i = str.indexOf(pat, i + 1)) p += 40;
    }
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const v = m[r][c]; if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3; }
  const dark = m.flat().reduce((a, b) => a + b, 0);
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

/** The modules of the QR code for `text`, as rows of 0 and 1. Throws when the text is too long. */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  const v = BLOCKS.findIndex((b, i) => i > 0 && capacity(i) >= bytes.length + (i < 10 ? 2 : 3));
  if (v < 1) throw new RangeError("too long for a QR code here");
  const words = codewords(bytes, v);
  let best = null, score = Infinity;
  for (let mask = 0; mask < 8; mask++) { const m = build(v, words, mask), p = penalty(m); if (p < score) { best = m; score = p; } }
  return best;
}

/** The QR code as an SVG image, with the quiet zone around it. */
export function qrSvg(text, label) {
  const m = qrMatrix(text), n = m.length + 8;
  let d = "";
  m.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + 4} ${r + 4}h1v1h-1z`; }));
  return s("svg", { viewBox: `0 0 ${n} ${n}`, class: "qr", role: "img", "aria-label": label, "shape-rendering": "crispEdges" },
    s("rect", { width: n, height: n, fill: "#fff" }), s("path", { d, fill: "#000" }));
}

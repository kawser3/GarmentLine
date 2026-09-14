/**
 * A very small PDF writer.
 *
 * WHY NOT A LIBRARY
 * -----------------
 * The project ships no PDF dependency, and the smallest credible one costs a few hundred
 * kilobytes — against a bundle that is already 440 kB and where importing eleven icons
 * carelessly once cost 760 kB. What we actually need is one page size, two core fonts, text,
 * and horizontal rules. That is a few hundred lines of a well-documented file format, so it is
 * written out here rather than imported.
 *
 * WHAT A PDF IS, ENOUGH TO READ THIS
 * ----------------------------------
 * A header, a set of numbered objects, a cross-reference table listing each object's BYTE
 * OFFSET from the start of the file, and a trailer pointing at the table. Readers seek by
 * those offsets, so every byte counted must be a byte written — which is why this assembles
 * into a byte array and measures as it goes, never into a string that something might later
 * re-encode.
 *
 * Only the 14 standard fonts are used, so nothing has to be embedded. That is what keeps this
 * small, and it is also why text is encoded as WinAnsi (Latin-1): those fonts have no glyphs
 * outside it. Characters beyond that range are transliterated rather than dropped, because a
 * silently missing character in a price is worse than an approximated one.
 */

export type PdfFont = "Helvetica" | "Helvetica-Bold";

/** A4 in PDF points (1/72"). */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

interface TextOp {
  kind: "text";
  x: number;
  y: number;
  size: number;
  font: PdfFont;
  text: string;
  gray?: number;
}
interface LineOp {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  gray: number;
}
interface RectOp {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  gray: number;
}
interface ImageOp {
  kind: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  image: PdfImage;
}
type Op = TextOp | LineOp | RectOp | ImageOp;

/**
 * A bitmap, already flattened to opaque RGB.
 *
 * Opaque on purpose. PDF expresses transparency with a separate soft-mask object, which is
 * more machinery than one logo justifies — compositing against the page colour before it gets
 * here produces the same picture. The caller does that on a canvas, where it is one fillRect.
 */
export interface PdfImage {
  width: number;
  height: number;
  /** `width * height * 3` bytes, row-major, no padding. */
  rgb: Uint8Array;
}

/**
 * Latin-1 with the handful of substitutions this document actually needs.
 *
 * A core font cannot render an en dash, a curly quote or a non-breaking space, and the notes
 * and currency formatting produce all three. Mapping them to their ASCII equivalents keeps the
 * sentence readable; leaving them would emit a wrong glyph or nothing at all.
 */
function toWinAnsi(input: string): string {
  /*
   * WinAnsi is NOT Latin-1 in 0x80-0x9F: that range, unused by Latin-1, is where WinAnsi keeps
   * the typographic marks this document needs. Folding the em dash to a hyphen and the bullet
   * to "-" — which this used to do — discards characters the font renders perfectly well, and
   * the em dash carries meaning here: it is how the table says "not applicable", which a
   * hyphen reads as a minus sign instead.
   */
  const swaps: Record<string, string> = {
    "\u20ac": "\x80",
    "\u2026": "\x85",
    "\u2018": "\x91",
    "\u2019": "\x92",
    "\u201c": "\x93",
    "\u201d": "\x94",
    "\u2022": "\x95",
    "\u2013": "\x96",
    "\u2014": "\x97",
    "\u2122": "\x99",
    "\u00a0": " ",
    "\u2007": " ",
    "\u202f": " ",
    "\u2192": "->",
    "\u2265": ">=",
    "\u2264": "<=",
  };
  let out = "";
  for (const ch of input) {
    const mapped = swaps[ch] ?? ch;
    for (const c of mapped) {
      out += c.charCodeAt(0) <= 0xff ? c : "?";
    }
  }
  return out;
}

/** `(`, `)` and `\` delimit and escape string literals, so they must be escaped themselves. */
function escapeText(input: string): string {
  return toWinAnsi(input).replace(/([\\()])/g, "\\$1");
}

/**
 * Width of a string, in points.
 *
 * Needed for right-aligning money columns, which is the difference between a table and a mess.
 * Rather than embed full AFM metrics for two fonts, this uses per-character widths for the
 * ASCII range — the only range these documents contain after transliteration.
 */
const HELV_WIDTHS: Record<string, number> = {};
{
  // Widths are per 1000 units of font size, from the Helvetica AFM.
  const spec: [string, number][] = [
    [" !\"#$%&'()*+,-./", 0],
    ["0123456789", 556],
    ["abcdefghijklmnopqrstuvwxyz", 0],
    ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", 0],
  ];
  void spec;
  const narrow = "iljt.,:;'|!/\\()[]{}` ";
  const wide = "mwMW@%";
  for (let c = 32; c <= 255; c += 1) {
    const ch = String.fromCharCode(c);
    if (ch >= "0" && ch <= "9") HELV_WIDTHS[ch] = 556;
    else if (narrow.includes(ch)) HELV_WIDTHS[ch] = 250;
    else if (wide.includes(ch)) HELV_WIDTHS[ch] = 833;
    else if (ch >= "A" && ch <= "Z") HELV_WIDTHS[ch] = 667;
    else HELV_WIDTHS[ch] = 556;
  }
}

export function textWidth(text: string, size: number, font: PdfFont): number {
  const bold = font === "Helvetica-Bold" ? 1.04 : 1;
  let total = 0;
  for (const ch of toWinAnsi(text)) total += (HELV_WIDTHS[ch] ?? 556) * bold;
  return (total / 1000) * size;
}

export class PdfDocument {
  private pages: Op[][] = [[]];

  private get current(): Op[] {
    return this.pages[this.pages.length - 1];
  }

  newPage() {
    this.pages.push([]);
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /**
   * Draw onto an earlier page.
   *
   * Page furniture — "Page 3 of 7" — cannot be written while a page is current, because the
   * total is not known until the content has finished paginating. Rather than have callers
   * reach into the op lists, this re-points `current` at one page for the duration of `fn`
   * and restores it afterwards.
   */
  onPage(index: number, fn: () => void) {
    if (index < 0 || index >= this.pages.length) return;
    const saved = this.pages;
    this.pages = saved.slice(0, index + 1);
    try {
      fn();
    } finally {
      this.pages = saved;
    }
  }

  text(
    text: string,
    x: number,
    y: number,
    opts: { size?: number; font?: PdfFont; gray?: number } = {},
  ) {
    if (!text) return;
    this.current.push({
      kind: "text",
      x,
      // PDF's origin is the BOTTOM-left. Callers think top-down, like every other layout
      // system, so the flip happens here once instead of at every call site.
      y: PAGE_HEIGHT - y,
      size: opts.size ?? 10,
      font: opts.font ?? "Helvetica",
      text,
      gray: opts.gray,
    });
  }

  /** Right-aligns at `right`, which is what makes a money column line up. */
  textRight(
    text: string,
    right: number,
    y: number,
    opts: { size?: number; font?: PdfFont; gray?: number } = {},
  ) {
    const size = opts.size ?? 10;
    const font = opts.font ?? "Helvetica";
    this.text(text, right - textWidth(text, size, font), y, { ...opts, size, font });
  }

  /** Filled block, for the header band and the totals panel. */
  rect(x: number, y: number, w: number, h: number, gray: number) {
    this.current.push({ kind: "rect", x, y: PAGE_HEIGHT - y - h, w, h, gray });
  }

  /** `y` is the TOP edge, matching every other call here. */
  image(image: PdfImage, x: number, y: number, w: number, h: number) {
    this.current.push({ kind: "image", x, y: PAGE_HEIGHT - y - h, w, h, image });
  }

  rule(x1: number, y: number, x2: number, opts: { width?: number; gray?: number } = {}) {
    this.current.push({
      kind: "line",
      x1,
      y1: PAGE_HEIGHT - y,
      x2,
      y2: PAGE_HEIGHT - y,
      width: opts.width ?? 0.5,
      gray: opts.gray ?? 0.75,
    });
  }

  private contentFor(ops: Op[], imageName: (img: PdfImage) => string): string {
    const parts: string[] = [];
    for (const op of ops) {
      if (op.kind === "text") {
        const g = op.gray ?? 0;
        parts.push(
          `BT /${op.font === "Helvetica-Bold" ? "F2" : "F1"} ${op.size} Tf ` +
            `${g} g ${op.x.toFixed(2)} ${op.y.toFixed(2)} Td (${escapeText(op.text)}) Tj ET`,
        );
      } else if (op.kind === "line") {
        parts.push(
          `${op.gray} G ${op.width} w ${op.x1.toFixed(2)} ${op.y1.toFixed(2)} m ` +
            `${op.x2.toFixed(2)} ${op.y2.toFixed(2)} l S`,
        );
      } else if (op.kind === "rect") {
        parts.push(
          `${op.gray} g ${op.x.toFixed(2)} ${op.y.toFixed(2)} ` +
            `${op.w.toFixed(2)} ${op.h.toFixed(2)} re f`,
        );
      } else {
        // q/Q brackets the transform, so the image's scaling matrix cannot leak into whatever
        // is drawn next — a classic way to end up with text a hundred points tall.
        parts.push(
          `q ${op.w.toFixed(2)} 0 0 ${op.h.toFixed(2)} ${op.x.toFixed(2)} ${op.y.toFixed(2)} cm ` +
            `/${imageName(op.image)} Do Q`,
        );
      }
    }
    return parts.join("\n");
  }

  /**
   * Serialise to PDF bytes.
   *
   * Object numbering: 1 = catalog, 2 = pages, 3 = font F1, 4 = font F2, then a page and a
   * content stream per page. The cross-reference table must carry each object's exact byte
   * offset, so the buffer is built and measured in one pass.
   */
  build(): Uint8Array {
    /*
     * LATIN-1, NOT UTF-8.
     *
     * A PDF string literal is a sequence of BYTES interpreted through the font's encoding, and
     * this file declares WinAnsiEncoding. TextEncoder would emit the em dash's 0x97 as the two
     * UTF-8 bytes 0xC2 0x97, which WinAnsi reads as "Â—" — a stray  before every typographic
     * mark, and every byte count off by one. Everything else emitted here is ASCII, where the
     * two encodings agree.
     */
    const latin1 = (s: string) => {
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
      return out;
    };
    const parts: Uint8Array[] = [];
    let length = 0;
    const push = (s: string | Uint8Array) => {
      const bytes = typeof s === "string" ? latin1(s) : s;
      parts.push(bytes);
      length += bytes.length;
    };

    // Every distinct image becomes one XObject, shared across pages — a logo repeated on a
    // three-page estimate must not be stored three times.
    const images: PdfImage[] = [];
    for (const ops of this.pages) {
      for (const op of ops) {
        if (op.kind === "image" && !images.includes(op.image)) images.push(op.image);
      }
    }
    const nameOf = (img: PdfImage) => `Im${images.indexOf(img) + 1}`;

    const pageCount = this.pages.length;
    const firstImageObj = 5;
    const firstPageObj = firstImageObj + images.length;
    const pageIds = this.pages.map((_, i) => firstPageObj + i * 2);

    /* Object bodies. A stream may be binary, so it is kept separate from its dictionary
       rather than concatenated into a string, which would corrupt any byte above 0x7F. */
    const objects: { head: string; stream?: Uint8Array }[] = [];

    objects.push({ head: `<</Type/Catalog/Pages 2 0 R>>` });
    objects.push({
      head: `<</Type/Pages/Kids[${pageIds.map((id) => `${id} 0 R`).join(" ")}]/Count ${pageCount}>>`,
    });
    objects.push({
      head: `<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>`,
    });
    objects.push({
      head: `<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>`,
    });
    images.forEach((img) => {
      objects.push({
        head:
          `<</Type/XObject/Subtype/Image/Width ${img.width}/Height ${img.height}` +
          `/ColorSpace/DeviceRGB/BitsPerComponent 8/Length ${img.rgb.length}>>`,
        stream: img.rgb,
      });
    });

    const xobjects = images.length
      ? `/XObject<<${images.map((img, i) => `/${nameOf(img)} ${firstImageObj + i} 0 R`).join("")}>>`
      : "";

    this.pages.forEach((ops, i) => {
      const contentId = pageIds[i] + 1;
      objects.push({
        head:
          `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}]` +
          `/Resources<</Font<</F1 3 0 R/F2 4 0 R>>${xobjects}>>/Contents ${contentId} 0 R>>`,
      });
      const content = latin1(this.contentFor(ops, nameOf));
      objects.push({ head: `<</Length ${content.length}>>`, stream: content });
    });

    const offsets: number[] = [];
    push("%PDF-1.4\n");
    objects.forEach((obj, i) => {
      offsets.push(length);
      push(`${i + 1} 0 obj\n${obj.head}`);
      if (obj.stream) {
        push("stream\n");
        push(obj.stream);
        push("\nendstream");
      }
      push("\nendobj\n");
    });

    const xrefAt = length;
    push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    for (const off of offsets) push(`${String(off).padStart(10, "0")} 00000 n \n`);
    push(`trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/* ------------------------------------------------------------------ layout */

/**
 * Break one word that is wider than the column, at the character.
 *
 * Word wrapping alone cannot help a token with no spaces in it, and the identifiers
 * this report prints are exactly that shape — a fingerprint reads
 * `uptimerobot:GRAFANASELISEBIZAS:availability`. Left whole it was emitted as a single
 * line and drawn straight past the right margin, off the paper. Splitting by character
 * is correct here precisely because these are identifiers rather than prose: there is
 * no hyphenation to get wrong, and a fingerprint that wraps mid-token is still readable
 * where one that runs off the page is not.
 */
function breakToken(word: string, width: number, size: number, font: PdfFont): string[] {
  const out: string[] = [];
  let piece = "";
  for (const ch of word) {
    if (piece && textWidth(piece + ch, size, font) > width) {
      out.push(piece);
      piece = ch;
    } else {
      piece += ch;
    }
  }
  if (piece) out.push(piece);
  return out;
}

export function wrap(text: string, width: number, size: number, font: PdfFont = "Helvetica"): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, font) > width && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
      // The line may now be a single over-long token; emit all but its last
      // fragment and carry the remainder, so the next word still packs onto it.
      if (textWidth(line, size, font) > width) {
        const pieces = breakToken(line, width, size, font);
        out.push(...pieces.slice(0, -1));
        line = pieces[pieces.length - 1] ?? "";
      }
    }
    if (line) out.push(line);
  }
  return out;
}

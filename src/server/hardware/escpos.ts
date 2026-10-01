/**
 * Documents d'impression thermique (58/80 mm). Le constructeur enregistre une suite d'opérations neutres,
 * encodées ensuite selon l'imprimante : ESC/POS (réseau, agent local), ePOS-Print XML (Epson Server Direct Print)
 * ou commandes Star (CloudPRNT). Pur, sans transport.
 */
export type PrintOp =
  | { t: "text"; s: string }
  | { t: "align"; a: "left" | "center" | "right" }
  | { t: "bold"; on: boolean }
  | { t: "size"; w: 1 | 2; h: 1 | 2 }
  | { t: "feed"; n: number }
  | { t: "cut" }
  | { t: "drawer"; pin: 2 | 5 };

const ESC = 0x1b, GS = 0x1d;

/** Texte imprimable sur toutes les tables de caractères : accents retirés, caractères inconnus remplacés. */
export function asciiFold(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e\n]/g, "?");
}

export class EscPosBuilder {
  private list: PrintOp[] = [];
  constructor(private cols = 42) {}
  private push(op: PrintOp) { this.list.push(op); return this; }
  line(s = "") { return this.push({ t: "text", s: s + "\n" }); }
  align(a: "left" | "center" | "right") { return this.push({ t: "align", a }); }
  bold(on: boolean) { return this.push({ t: "bold", on }); }
  size(w: 1 | 2, h: 1 | 2) { return this.push({ t: "size", w, h }); }
  feed(n = 1) { return this.push({ t: "feed", n }); }
  cut() { return this.push({ t: "cut" }); }
  drawer(pin: 2 | 5 = 2) { return this.push({ t: "drawer", pin }); }
  separator(ch = "-") { return this.line(ch.repeat(this.cols)); }
  /** Colonne gauche + colonne droite alignée. */
  row(left: string, right: string) {
    const space = Math.max(1, this.cols - left.length - right.length);
    return this.line(left.slice(0, this.cols - right.length - 1) + " ".repeat(space) + right);
  }
  ops(): PrintOp[] { return [...this.list]; }
  build(): Uint8Array { return encodeEscPos(this.list); }
}

/** ESC/POS (Epson, Bixolon, Xprinter, la plupart des imprimantes thermiques). */
export function encodeEscPos(ops: PrintOp[]): Uint8Array {
  const out: number[] = [ESC, 0x40];
  for (const op of ops) {
    if (op.t === "text") for (const ch of asciiFold(op.s)) out.push(ch.charCodeAt(0));
    else if (op.t === "align") out.push(ESC, 0x61, op.a === "left" ? 0 : op.a === "center" ? 1 : 2);
    else if (op.t === "bold") out.push(ESC, 0x45, op.on ? 1 : 0);
    else if (op.t === "size") out.push(GS, 0x21, ((op.w - 1) << 4) | (op.h - 1));
    else if (op.t === "feed") out.push(ESC, 0x64, op.n);
    else if (op.t === "cut") out.push(GS, 0x56, 0x42, 0x00);
    else if (op.t === "drawer") out.push(ESC, 0x70, op.pin === 5 ? 1 : 0, 0x19, 0xfa);
  }
  return Uint8Array.from(out);
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");

/** ePOS-Print XML (imprimantes Epson compatibles ePOS, utilisé par Server Direct Print). */
export function encodeEposXml(ops: PrintOp[]): string {
  const body = ops.map((op) => {
    if (op.t === "text") return `<text>${xml(asciiFold(op.s))}</text>`;
    if (op.t === "align") return `<text align="${op.a}"/>`;
    if (op.t === "bold") return `<text em="${op.on}"/>`;
    if (op.t === "size") return `<text width="${op.w}" height="${op.h}"/>`;
    if (op.t === "feed") return `<feed line="${op.n}"/>`;
    if (op.t === "cut") return `<cut type="feed"/>`;
    return `<pulse drawer="${op.pin === 5 ? "drawer_2" : "drawer_1"}" time="pulse_100"/>`;
  }).join("");
  return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${body}</epos-print>`;
}

/** Commandes Star (mode Star Line / StarPRNT, utilisé par CloudPRNT). */
export function encodeStar(ops: PrintOp[]): Uint8Array {
  const out: number[] = [ESC, 0x40];
  for (const op of ops) {
    if (op.t === "text") for (const ch of asciiFold(op.s)) out.push(ch.charCodeAt(0));
    else if (op.t === "align") out.push(ESC, GS, 0x61, op.a === "left" ? 0 : op.a === "center" ? 1 : 2);
    else if (op.t === "bold") out.push(ESC, op.on ? 0x45 : 0x46);
    else if (op.t === "size") out.push(ESC, 0x69, op.h - 1, op.w - 1);
    else if (op.t === "feed") out.push(ESC, 0x61, op.n);
    else if (op.t === "cut") out.push(ESC, 0x64, 0x03);
    else if (op.t === "drawer") out.push(op.pin === 5 ? 0x1a : 0x07);
  }
  return Uint8Array.from(out);
}

/** Texte brut (repli pour les imprimantes qui n'acceptent que text/plain : sans mise en forme ni tiroir). */
export function encodeText(ops: PrintOp[]): string {
  return ops.filter((op): op is Extract<PrintOp, { t: "text" }> => op.t === "text").map((op) => asciiFold(op.s)).join("");
}

/** Générateur de commandes ESC/POS (imprimantes thermiques 58/80 mm). Pur, sans transport. */
const ESC = 0x1b, GS = 0x1d;

export class EscPosBuilder {
  private chunks: number[] = [];
  constructor(private cols = 42) {
    this.chunks.push(ESC, 0x40); // init
  }
  private text(s: string) {
    // Encodage CP437 approximatif : remplace les caractères hors ASCII
    const clean = s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e\n]/g, "?");
    for (const ch of clean) this.chunks.push(ch.charCodeAt(0));
    return this;
  }
  line(s = "") { return this.text(s + "\n"); }
  align(a: "left" | "center" | "right") { this.chunks.push(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2); return this; }
  bold(on: boolean) { this.chunks.push(ESC, 0x45, on ? 1 : 0); return this; }
  size(w: 1 | 2, h: 1 | 2) { this.chunks.push(GS, 0x21, ((w - 1) << 4) | (h - 1)); return this; }
  feed(n = 1) { this.chunks.push(ESC, 0x64, n); return this; }
  cut() { this.chunks.push(GS, 0x56, 0x42, 0x00); return this; }
  drawer() { this.chunks.push(ESC, 0x70, 0x00, 0x19, 0xfa); return this; }
  separator(ch = "-") { return this.line(ch.repeat(this.cols)); }
  /** Colonne gauche + colonne droite alignée. */
  row(left: string, right: string) {
    const space = Math.max(1, this.cols - left.length - right.length);
    return this.line(left.slice(0, this.cols - right.length - 1) + " ".repeat(space) + right);
  }
  build(): Uint8Array { return Uint8Array.from(this.chunks); }
}

import { describe, expect, it } from "vitest";
import { EscPosBuilder, encodeEposXml, encodeEscPos, encodeStar, encodeText } from "@/server/hardware/escpos";

describe("documents d'impression", () => {
  const ops = new EscPosBuilder(32).align("center").bold(true).line("Café & <Thé>").bold(false).feed(2).cut().drawer(5).ops();

  it("ESC/POS : initialisation, texte sans accents, coupe, tiroir broche 5", () => {
    const b = [...encodeEscPos(ops)];
    expect(b.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(Buffer.from(encodeEscPos(ops)).toString("latin1")).toContain("Cafe & <The>");
    expect(b.join(",")).toContain([0x1d, 0x56, 0x42, 0x00].join(","));
    expect(b.slice(-5)).toEqual([0x1b, 0x70, 0x01, 0x19, 0xfa]);
  });

  it("ePOS-Print XML : caractères échappés, impulsion sur le tiroir 2", () => {
    const xml = encodeEposXml(ops);
    expect(xml.startsWith('<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">')).toBe(true);
    expect(xml).toContain("<text>Cafe &amp; &lt;The&gt;&#10;</text>");
    expect(xml).toContain('<text align="center"/><text em="true"/>');
    expect(xml).toContain('<feed line="2"/><cut type="feed"/><pulse drawer="drawer_2" time="pulse_100"/>');
  });

  it("Star : alignement, gras, coupe partielle et tiroir ; texte brut sans commandes", () => {
    const b = [...encodeStar(ops)];
    expect(b.join(",")).toContain([0x1b, 0x1d, 0x61, 1].join(","));
    expect(b.join(",")).toContain([0x1b, 0x45].join(","));
    expect(b.join(",")).toContain([0x1b, 0x64, 0x03].join(","));
    expect(b[b.length - 1]).toBe(0x1a);
    expect(encodeEscPos(new EscPosBuilder().drawer().ops()).slice(-5)).toEqual(Uint8Array.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
    expect([...encodeStar(new EscPosBuilder().drawer().ops())].pop()).toBe(0x07);
    expect(encodeText(ops)).toBe("Cafe & <The>\n");
  });
});

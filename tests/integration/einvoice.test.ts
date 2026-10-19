import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { buildFacturXml, normalizeEInvoice, FACTURX_FILENAME, type EInvoice } from "@/server/einvoice/facturx";
import { createInvoice, getInvoice, renderInvoicePdf, renderInvoiceXml, upsertAccount } from "@/server/services/accounts";
import { addItem, createOrder } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { acceptQuote, createEvent, invoiceEvent, renderEventInvoiceXml, renderEventPdf, sendQuote } from "@/server/services/catering";

let T: Awaited<ReturnType<typeof makeTenant>>;
const tag = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<ram:${name}[^>]*>([^<]*)</ram:${name}>`, "g"))].map((m) => m[1]);
const num = (xml: string, name: string) => tag(xml, name).map(Number);

/** Validateur officiel Mustang : utilisé s'il est installé (scripts/mustang.sh, variable MUSTANG_JAR ou /opt/mustang), sinon ce contrôle est sauté. */
function mustangJar(): string | null {
  const candidates = [process.env.MUSTANG_JAR, path.join(process.env.HOME ?? "", ".cache/mustang/Mustang-CLI-2.26.0.jar"), "/opt/mustang/Mustang-CLI-2.26.0.jar"].filter((p): p is string => !!p);
  const jar = candidates.find((p) => existsSync(p));
  if (!jar) return null;
  return spawnSync("java", ["-version"]).status === 0 ? jar : null;
}
function mustangValidate(jar: string, pdf: Buffer, name: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "facturx-"));
  const file = path.join(dir, name);
  writeFileSync(file, pdf);
  const r = spawnSync("java", ["-Xmx512m", "-jar", jar, "--action", "validate", "--source", file], { encoding: "utf8", timeout: 120_000 });
  const report = r.stdout + r.stderr;
  // Erreurs du rapport (hors notices XRechnung, sans objet ici) : vides quand la facture est valide
  const errors = [...report.matchAll(/<error[^>]*>([^<]*)<\/error>|ERROR [^\n]*/g)].map((m) => (m[1] ?? m[0]).replace(/criterion="[^"]*"/, "").slice(0, 300));
  const pdfCompliant = /isCompliant=true/.test(report);
  const valid = (report.match(/<summary status="valid"\/>/g) ?? []).length >= 3 && !/<summary status="invalid"\/>/.test(report);
  return { status: r.status, report, errors, pdfCompliant, valid };
}

beforeAll(async () => {
  process.env.EMAIL_TRANSPORT = "memory";
  await resetDb();
  T = await makeTenant("facturx");
  // Un vendeur identifié (raison sociale, n° Tahiti, adresse) : exigé par la norme pour une facture électronique valide
  await prisma.establishment.update({ where: { id: T.est.id }, data: { legalName: "Resto Facturx SARL", tahitiNumber: "B98765", addressLine1: "PK 12 côté montagne", postalCode: "98718", city: "Punaauia", email: "compta@resto.pf" } });
});

describe("Factures électroniques Factur-X (EN 16931)", () => {
  it("XML : lignes par taux, TVA cohérente avec la base, totaux équilibrés, vendeur et acheteur identifiés", () => {
    const inv: EInvoice = {
      number: "FA-2026-0007", issuedAt: new Date("2026-10-19T10:00:00Z"), dueAt: new Date("2026-11-18T10:00:00Z"), currency: "XPF",
      seller: { name: "Resto", legalName: "Resto SARL", addressLines: ["PK 12", null, "Tahiti"], postalCode: "98718", city: "Punaauia", taxId: "B98765", email: "compta@resto.pf" },
      buyer: { name: "Mairie", addressLines: ["BP 1"], taxId: "A12345", contactName: "Service compta" },
      // Bases et TVA cumulées depuis des arrondis par commande : volontairement incohérentes avec le taux (13 % de 10 000 = 1 300, pas 1 310)
      lines: [{ id: "1", name: "Commande 1", quantity: 1, unitPriceHt: 6000, totalHt: 6000, rateBps: 1300 }, { id: "2", name: "Commande 2", quantity: 1, unitPriceHt: 4000, totalHt: 4000, rateBps: 1300 }, { id: "3", name: "Eau", quantity: 3, unitPriceHt: 100, totalHt: 300, rateBps: 0 }],
      taxes: [{ rateBps: 1300, ht: 10000, tax: 1310 }, { rateBps: 0, ht: 300, tax: 0 }],
      totals: { ht: 10300, tax: 1310, ttc: 11610, prepaid: 5000, due: 6610 },
    };
    const n = normalizeEInvoice(inv);
    expect(n.taxes.map((t) => [t.rateBps, t.ht, t.tax])).toEqual([[0, 300, 0], [1300, 10009, 1301]]); // TTC 11 310 conservé, base recalculée
    expect(n.lines.find((l) => l.id === "2")!.totalHt).toBe(4009); // l'écart d'arrondi va sur la dernière ligne du taux
    expect(n.totals).toEqual({ ht: 10309, tax: 1301, ttc: 11610, prepaid: 5000, due: 6610 });
    const xml = buildFacturXml(inv);
    expect(xml).toContain("<ram:ID>urn:cen.eu:en16931:2017</ram:ID>");
    expect(xml).toContain("<ram:TypeCode>380</ram:TypeCode>");
    expect(xml).toContain('<udt:DateTimeString format="102">20261019</udt:DateTimeString>');
    expect(tag(xml, "LineID")).toEqual(["1", "2", "3"]);
    expect(num(xml, "LineTotalAmount")).toEqual([6000, 4009, 300, 10309]);
    expect(tag(xml, "CategoryCode")).toEqual(["S", "S", "Z", "Z", "S"]);
    expect(num(xml, "BasisAmount")).toEqual([300, 10009]);
    expect(num(xml, "CalculatedAmount")).toEqual([0, 1301]);
    expect(num(xml, "GrandTotalAmount")).toEqual([11610]);
    expect(num(xml, "TotalPrepaidAmount")).toEqual([5000]);
    expect(num(xml, "DuePayableAmount")).toEqual([6610]);
    expect(xml).toContain('<ram:ID schemeID="FC">B98765</ram:ID>');
    expect(xml).not.toContain('<ram:ID schemeID="FC">A12345</ram:ID>'); // acheteur : n° Tahiti en identifiant légal seulement
    expect(xml).toContain("<ram:SpecifiedLegalOrganization><ram:ID>A12345</ram:ID></ram:SpecifiedLegalOrganization>");
    expect(xml).toContain("<ram:CountryID>PF</ram:CountryID>");
    expect(xml).toContain('<ram:BilledQuantity unitCode="C62">3.00</ram:BilledQuantity>');
    expect(xml).toContain("<ram:PersonName>Service compta</ram:PersonName>");
    expect(xml).not.toContain("SpecifiedTradeSettlementPaymentMeans"); // sans IBAN, pas de moyen de paiement déclaré
  });

  it("facture de compte client : PDF/A-3 avec XML Factur-X incorporé, polices embarquées, XML seul téléchargeable", async () => {
    const mairie = await upsertAccount(T.managerActor, { name: "Mairie de Punaauia", tahitiNumber: "A12345", contactName: "Service compta", email: "compta@mairie.pf", address: "BP 1, Punaauia", creditLimit: 50000, paymentTermsDays: 30 });
    for (let i = 0; i < 2; i++) {
      const o = await createOrder(T.actor, { type: "COUNTER" });
      await addItem(T.actor, o.id, { productId: T.entree.id, quantity: 2 }); // TVA 13 %
      await addItem(T.actor, o.id, { productId: T.biere.id }); // TVA 16 %
      await addItem(T.actor, o.id, { productId: T.eau.id }); // TVA 0 %
      await addPayments(T.actor, o.id, [{ method: "ACCOUNT", amount: 3300, customerAccountId: mairie.id }]);
    }
    const inv = await createInvoice(T.managerActor, mairie.id, {}, new Date("2026-10-19T20:00:00Z"));
    const full = await getInvoice(T.est.id, inv.id);
    // Bases HT stockées : recalculées depuis le TTC de chaque taux, comme dans le XML
    for (const t of full.taxes) expect(Math.abs(t.tax - Math.round((t.ht * t.rateBps) / 10000))).toBeLessThanOrEqual(1);

    const { xml, number } = await renderInvoiceXml(T.est.id, inv.id);
    expect(number).toBe("FA-2026-0001");
    expect(xml).toContain("<ram:ID>FA-2026-0001</ram:ID>");
    expect(tag(xml, "LineID")).toHaveLength(6); // 2 commandes × 3 taux
    expect(num(xml, "GrandTotalAmount")).toEqual([6600]);
    expect(num(xml, "DuePayableAmount")).toEqual([6600]);
    expect(num(xml, "LineTotalAmount").at(-1)).toBe(num(xml, "BasisAmount").reduce((a, b) => a + b, 0));
    expect(xml).toContain("Resto Facturx SARL");
    expect(xml).toContain('<ram:ID schemeID="FC">B98765</ram:ID>');

    const { pdf } = await renderInvoicePdf(T.est.id, inv.id);
    const raw = pdf.toString("latin1");
    expect(raw.startsWith("%PDF-1.7")).toBe(true);
    expect(raw).toContain(FACTURX_FILENAME);
    expect(raw).toContain("/AFRelationship /Alternative");
    expect(raw).toContain("<pdfaid:part>3</pdfaid:part>");
    expect(raw).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
    expect(raw).toContain("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>");
    expect(raw).toContain("/OutputIntents");
    expect(raw).toContain("/FontFile2"); // polices embarquées
    expect(raw).not.toMatch(/\/BaseFont \/Helvetica[ \n\r\/>]/); // plus aucune police standard non embarquée

    const jar = mustangJar();
    if (!jar) { console.warn("Mustang absent : validation officielle sautée (scripts/mustang.sh pour l'installer)"); return; }
    const v = mustangValidate(jar, pdf, "facture.pdf");
    expect(v.errors, v.errors.join("\n")).toEqual([]);
    expect(v.pdfCompliant).toBe(true);
    expect(v.valid).toBe(true);
    expect(v.status).toBe(0);
  });

  it("facture d'événement traiteur : lignes avec quantités, acompte déduit, valide", async () => {
    const at = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const e = await createEvent(T.managerActor, { title: "Repas d'entreprise", kind: "CORPORATE", startsAt: at, endsAt: new Date(Date.parse(at) + 4 * 3600_000).toISOString(), guests: 25, clientName: "Teva", clientCompany: "Lagon SARL", clientTahitiNumber: "C55555", clientEmail: "teva@lagon.pf", clientAddress: "Zone industrielle, Faa'a", lines: [{ label: "Poisson cru", quantity: 25, unitPrice: 1900, taxRateBps: 1300, taxRateName: "TVA restauration" }, { label: "Eau minérale", quantity: 40, unitPrice: 350, taxRateBps: 1300, taxRateName: "TVA restauration" }, { label: "Service", quantity: 1, unitPrice: 15000, taxRateBps: 1600, taxRateName: "TVA taux normal" }] });
    await sendQuote(T.managerActor, e.id, { email: false });
    await acceptQuote(T.managerActor, e.id);
    await invoiceEvent(T.managerActor, e.id, { dueDays: 15 });
    const { xml } = await renderEventInvoiceXml(T.est.id, e.id);
    expect(tag(xml, "LineID")).toEqual(["1", "2", "3"]);
    expect(xml).toContain('<ram:BilledQuantity unitCode="C62">40.00</ram:BilledQuantity>');
    expect(xml).toContain("<ram:BuyerReference>Repas d'entreprise</ram:BuyerReference>");
    expect(xml).toContain("<ram:Name>Lagon SARL</ram:Name>");
    expect(num(xml, "GrandTotalAmount")).toEqual([25 * 1900 + 40 * 350 + 15000]);
    // Somme des lignes HT = base par taux = base totale ; quantité × prix unitaire = montant de la ligne (prix à 4 décimales)
    const lines = num(xml, "LineTotalAmount");
    expect(lines.slice(0, -1).reduce((a, b) => a + b, 0)).toBe(lines.at(-1));
    expect(num(xml, "BasisAmount").reduce((a, b) => a + b, 0)).toBe(lines.at(-1));
    const prices = num(xml, "ChargeAmount"), qty = num(xml, "BilledQuantity");
    prices.forEach((p, i) => expect(Math.abs(p * qty[i] - lines[i])).toBeLessThan(0.01));
    const { pdf } = await renderEventPdf(T.est.id, e.id, "invoice");
    expect(pdf.toString("latin1")).toContain("<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>");
    const jar = mustangJar();
    if (!jar) return;
    const v = mustangValidate(jar, pdf, "traiteur.pdf");
    expect(v.errors, v.errors.join("\n")).toEqual([]);
    expect(v.pdfCompliant).toBe(true);
    expect(v.valid).toBe(true);
    expect(v.status).toBe(0);
  });
});

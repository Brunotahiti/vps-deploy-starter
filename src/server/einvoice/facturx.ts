import { readFile } from "node:fs/promises";
import path from "node:path";
import type PDFDocument from "pdfkit";
import { splitTtc } from "@/lib/money";

/**
 * Factures électroniques Factur-X (norme européenne EN 16931, profil EN 16931) :
 *  - un fichier XML « Cross Industry Invoice » (UN/CEFACT CII D16B) qui décrit la facture (vendeur, acheteur,
 *    lignes, TVA par taux, totaux, échéance) ;
 *  - incorporé dans le PDF de la facture, lui-même au format d'archivage PDF/A-3 (polices embarquées,
 *    profil de couleur, métadonnées XMP Factur-X).
 * Le résultat passe le validateur officiel Mustang (voir scripts/mustang.sh et tests/integration/einvoice.test.ts).
 * Montants : entiers en unité de la devise (XPF sans décimale) ; le XML les écrit avec deux décimales.
 */
export const FACTURX_FILENAME = "factur-x.xml";
export const FACTURX_PROFILE = "urn:cen.eu:en16931:2017";
export const FACTURX_CONFORMANCE = "EN 16931";

/** Partie (vendeur ou acheteur). L'e-mail n'est pas écrit dans le XML : le code d'adresse électronique « EM » est refusé par le schéma Factur-X 1.0. */
export type EInvoiceParty = { name: string; legalName?: string | null; addressLines?: (string | null | undefined)[]; postalCode?: string | null; city?: string | null; countryCode?: string | null; taxId?: string | null; email?: string | null; contactName?: string | null };
export type EInvoiceLine = { id: string; name: string; quantity: number; unitPriceHt: number; totalHt: number; rateBps: number };
export type EInvoiceTax = { rateBps: number; name?: string; ht: number; tax: number };
export type EInvoice = {
  number: string; issuedAt: Date; dueAt?: Date | null; deliveredAt?: Date | null; currency: string;
  seller: EInvoiceParty; buyer: EInvoiceParty; buyerReference?: string | null;
  lines: EInvoiceLine[]; taxes: EInvoiceTax[];
  totals: { ht: number; tax: number; ttc: number; prepaid: number; due: number };
  note?: string | null; paymentTerms?: string | null;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const amount = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
/** Prix unitaire : jusqu'à 4 décimales, pour que quantité × prix retombe exactement sur le montant de la ligne. */
const price = (n: number) => { const s = (Math.round(n * 10000) / 10000).toFixed(4); return s.replace(/(\.\d{2}\d*?)0+$/, "$1"); };
const pct = (bps: number) => (bps / 100).toFixed(2);
const day102 = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
/** Catégorie de TVA EN 16931 : S (taux normal) au-dessus de zéro, Z (taux zéro) sinon. */
const category = (bps: number) => (bps > 0 ? "S" : "Z");
const clean = (s: string | null | undefined, max = 200) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Vendeur : son n° fiscal est aussi déclaré en identifiant fiscal (schéma FC, BT-32, exigé avec des lignes taxées) ; acheteur : seul le schéma « VA » (TVA européenne) est admis, le n° Tahiti reste dans l'identifiant légal. */
function party(tag: string, p: EInvoiceParty, taxRegistration: boolean) {
  const lines = (p.addressLines ?? []).map((l) => clean(l)).filter(Boolean);
  const country = (p.countryCode ?? "PF").toUpperCase();
  const taxId = clean(p.taxId, 40);
  return `<ram:${tag}>
      <ram:Name>${esc(clean(p.legalName || p.name, 120) || "—")}</ram:Name>${taxId ? `
      <ram:SpecifiedLegalOrganization><ram:ID>${esc(taxId)}</ram:ID></ram:SpecifiedLegalOrganization>` : ""}${p.contactName ? `
      <ram:DefinedTradeContact><ram:PersonName>${esc(clean(p.contactName, 100))}</ram:PersonName></ram:DefinedTradeContact>` : ""}
      <ram:PostalTradeAddress>${p.postalCode ? `
        <ram:PostcodeCode>${esc(clean(p.postalCode, 20))}</ram:PostcodeCode>` : ""}${lines[0] ? `
        <ram:LineOne>${esc(lines[0])}</ram:LineOne>` : ""}${lines[1] ? `
        <ram:LineTwo>${esc(lines[1])}</ram:LineTwo>` : ""}${lines[2] ? `
        <ram:LineThree>${esc(lines[2])}</ram:LineThree>` : ""}${p.city ? `
        <ram:CityName>${esc(clean(p.city, 80))}</ram:CityName>` : ""}
        <ram:CountryID>${esc(country)}</ram:CountryID>
      </ram:PostalTradeAddress>${taxId && taxRegistration ? `
      <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(taxId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ""}
    </ram:${tag}>`;
}

/**
 * Rend la facture arithmétiquement exacte au sens de la norme (règles BR-CO-10/15/16, BR-S-09) : pour chaque taux,
 * le TTC est conservé, la base HT est recalculée depuis le TTC (TVA = TTC − HT, à moins d'une unité de base × taux),
 * et l'écart d'arrondi est porté par la dernière ligne du taux pour que la somme des lignes fasse la base.
 * Nécessaire quand les bases et TVA ont été cumulées depuis des arrondis par commande.
 */
export function normalizeEInvoice(inv: EInvoice): EInvoice {
  const lines = inv.lines.map((l) => ({ ...l }));
  const taxes = [...inv.taxes].sort((a, b) => a.rateBps - b.rateBps).map((t) => {
    const ttc = t.ht + t.tax;
    const split = splitTtc(ttc, t.rateBps);
    const group = lines.filter((l) => l.rateBps === t.rateBps);
    const diff = split.ht - group.reduce((s, l) => s + l.totalHt, 0);
    if (group.length && diff) { const last = group[group.length - 1]; last.totalHt += diff; last.unitPriceHt = last.quantity > 0 ? last.totalHt / last.quantity : last.totalHt; }
    return { ...t, ht: split.ht, tax: split.tax };
  });
  const ht = taxes.reduce((s, t) => s + t.ht, 0), tax = taxes.reduce((s, t) => s + t.tax, 0);
  const ttc = ht + tax, prepaid = Math.max(0, Math.min(inv.totals.prepaid, ttc));
  return { ...inv, lines, taxes, totals: { ht, tax, ttc, prepaid, due: ttc - prepaid } };
}

/** XML Factur-X (CII) de la facture, profil EN 16931. */
export function buildFacturXml(input: EInvoice): string {
  const inv = normalizeEInvoice(input);
  const cur = inv.currency.toUpperCase();
  const lines = inv.lines.map((l, i) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${esc(l.id || String(i + 1))}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${esc(clean(l.name, 200) || "Article")}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${price(l.unitPriceHt)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${amount(l.quantity)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${category(l.rateBps)}</ram:CategoryCode><ram:RateApplicablePercent>${pct(l.rateBps)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(l.totalHt)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join("");
  const taxes = [...inv.taxes].sort((a, b) => a.rateBps - b.rateBps).map((t) => `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${amount(t.tax)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${amount(t.ht)}</ram:BasisAmount>
        <ram:CategoryCode>${category(t.rateBps)}</ram:CategoryCode>
        <ram:RateApplicablePercent>${pct(t.rateBps)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${FACTURX_PROFILE}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(clean(inv.number, 60))}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${day102(inv.issuedAt)}</udt:DateTimeString></ram:IssueDateTime>${inv.note ? `
    <ram:IncludedNote><ram:Content>${esc(clean(inv.note, 500))}</ram:Content></ram:IncludedNote>` : ""}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>${inv.buyerReference ? `
      <ram:BuyerReference>${esc(clean(inv.buyerReference, 60))}</ram:BuyerReference>` : ""}
      ${party("SellerTradeParty", inv.seller, true)}
      ${party("BuyerTradeParty", inv.buyer, false)}
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${day102(inv.deliveredAt ?? inv.issuedAt)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${esc(cur)}</ram:InvoiceCurrencyCode>${taxes}
      <ram:SpecifiedTradePaymentTerms>${inv.paymentTerms ? `
        <ram:Description>${esc(clean(inv.paymentTerms, 300))}</ram:Description>` : ""}${inv.dueAt ? `
        <ram:DueDateDateTime><udt:DateTimeString format="102">${day102(inv.dueAt)}</udt:DateTimeString></ram:DueDateDateTime>` : ""}
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amount(inv.totals.ht)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${amount(inv.totals.ht)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${esc(cur)}">${amount(inv.totals.tax)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amount(inv.totals.ttc)}</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>${amount(inv.totals.prepaid)}</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>${amount(inv.totals.due)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

/** Métadonnées XMP Factur-X (schéma d'extension PDF/A + description du document). */
export function facturXmp(): string {
  return `
        <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
          <pdfaExtension:schemas>
            <rdf:Bag>
              <rdf:li rdf:parseType="Resource">
                <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
                <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
                <pdfaSchema:prefix>fx</pdfaSchema:prefix>
                <pdfaSchema:property>
                  <rdf:Seq>
                    <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description></rdf:li>
                    <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>
                    <rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description></rdf:li>
                    <rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description></rdf:li>
                  </rdf:Seq>
                </pdfaSchema:property>
              </rdf:li>
            </rdf:Bag>
          </pdfaExtension:schemas>
        </rdf:Description>
        <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
          <fx:DocumentType>INVOICE</fx:DocumentType>
          <fx:DocumentFileName>${FACTURX_FILENAME}</fx:DocumentFileName>
          <fx:Version>1.0</fx:Version>
          <fx:ConformanceLevel>${FACTURX_CONFORMANCE}</fx:ConformanceLevel>
        </rdf:Description>
  `;
}

let fontCache: Promise<{ regular: Buffer; bold: Buffer }> | null = null;
const loadFonts = () => (fontCache ??= Promise.all(["PlusJakartaSans-Medium.ttf", "PlusJakartaSans-ExtraBold.ttf"].map((f) => readFile(path.join(process.cwd(), "src/server/fonts", f)))).then(([regular, bold]) => ({ regular, bold })));

type PdfDoc = InstanceType<typeof PDFDocument> & { appendXML: (xml: string, newline?: boolean) => void };

/**
 * Document PDF prêt pour une facture électronique : PDF/A-3b (version 1.7, profil de couleur sRGB, métadonnées
 * XMP) avec les polices de l'application embarquées sous les noms « Helvetica » et « Helvetica-Bold »,
 * pour que les mises en page existantes restent inchangées (un PDF/A n'accepte pas les polices non embarquées).
 */
export async function createEInvoiceDocument(opts: { title: string; author: string; subject?: string }): Promise<PdfDoc> {
  const PDFDocument = (await import("pdfkit")).default;
  const fonts = await loadFonts();
  // Police par défaut donnée en octets : « Helvetica » n'est jamais chargée comme police standard (non embarquée),
  // et les noms « Helvetica » / « Helvetica-Bold » pointent ensuite vers les polices embarquées
  const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 40, right: 40 }, pdfVersion: "1.7", subset: "PDF/A-3b", lang: "fr-FR", displayTitle: true, font: fonts.regular as unknown as string, info: { Title: opts.title, Author: opts.author, Subject: opts.subject ?? "Facture", Producer: "ManaResto", Creator: "ManaResto" } }) as PdfDoc;
  doc.registerFont("Helvetica", fonts.regular);
  doc.registerFont("Helvetica-Bold", fonts.bold);
  doc.font("Helvetica");
  return doc;
}

/** Incorpore le XML Factur-X dans le document (pièce jointe « Alternative ») et ses métadonnées XMP. À appeler avant doc.end(). */
export function attachFacturX(doc: PdfDoc, xml: string) {
  // « relationship » (AFRelationship) est pris en charge par pdfkit 0.20 mais absent de ses types
  doc.file(Buffer.from(xml, "utf8"), { name: FACTURX_FILENAME, type: "text/xml", description: "Factur-X / EN 16931", relationship: "Alternative", creationDate: new Date(), modifiedDate: new Date() } as Parameters<PdfDoc["file"]>[1]);
  doc.appendXML(facturXmp());
}

/** Lignes d'une facture « consommations sur compte » : une ligne XML par consommation et par taux de TVA. */
export function linesByRate(items: { id: string; label: string; taxes: { rateBps: number; name: string; ht: number }[] }[]): EInvoiceLine[] {
  const out: EInvoiceLine[] = [];
  for (const it of items) for (const t of it.taxes) {
    if (t.ht === 0 && it.taxes.length > 1) continue;
    out.push({ id: `${it.id}${it.taxes.length > 1 ? `-${t.rateBps}` : ""}`, name: it.taxes.length > 1 ? `${it.label} (${t.name})` : it.label, quantity: 1, unitPriceHt: t.ht, totalHt: t.ht, rateBps: t.rateBps });
  }
  return out;
}

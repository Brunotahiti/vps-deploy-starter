import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { findDrawerPrinter, listPrinters, openDrawer, openDrawerAfterPayment, printDocument, regenerateCloudToken, savedPrinterView, upsertPrinter } from "@/server/hardware/printers";
import { findCloudPrinter, handleEpson, handleStarDone, handleStarFetch, handleStarPoll } from "@/server/hardware/cloud-print";
import { renderReceiptDoc } from "@/server/receipts/receipt";
import { addItem, createOrder } from "@/server/services/orders";

let T: Awaited<ReturnType<typeof makeTenant>>;
let tcp: Server; let tcpPort = 0; const received: Buffer[] = [];

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("hardware");
  tcp = createServer((socket) => { const chunks: Buffer[] = []; socket.on("data", (c) => chunks.push(c)); socket.on("end", () => received.push(Buffer.concat(chunks))); });
  await new Promise<void>((r) => tcp.listen(0, "127.0.0.1", () => { tcpPort = (tcp.address() as { port: number }).port; r(); }));
});
afterAll(async () => { await new Promise<void>((r) => tcp.close(() => r())); });

const form = (o: Record<string, string>) => new URLSearchParams(o);
const orderWithWater = async () => { const o = await createOrder(T.actor, { type: "COUNTER" }); await addItem(T.actor, o.id, { productId: T.eau.id, quantity: 2 }); return o; };

describe("Imprimantes connectées", () => {
  it("Epson Server Direct Print : adresse secrète, file d'attente, remise unique, confirmation", async () => {
    const saved = await upsertPrinter(T.managerActor, { name: "Caisse Epson", kind: "RECEIPT", driver: "cloud-epson", hasDrawer: true });
    expect(saved.cloudToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    // Le jeton n'est jamais renvoyé ensuite, ni son empreinte
    const view = savedPrinterView(saved, "https://app.manaresto.com");
    expect(view.cloudUrl).toBe(`https://app.manaresto.com/api/hardware/cloud/${saved.cloudToken}`);
    expect(JSON.stringify(await listPrinters(T.est.id))).not.toContain(saved.cloudTokenHash!);
    expect(JSON.stringify(view)).not.toContain(saved.cloudTokenHash!);
    const edited = await upsertPrinter(T.managerActor, { id: saved.id, name: "Caisse", kind: "RECEIPT", driver: "cloud-epson", hasDrawer: true });
    expect(edited.cloudToken).toBeUndefined();

    const printer = await findCloudPrinter(saved.cloudToken!);
    expect(printer?.id).toBe(saved.id);
    expect(await findCloudPrinter("jeton-inconnu-0123456789abcdef")).toBeNull();

    const job = await printDocument(T.est.id, saved.id, { kind: "test" });
    expect(job).toMatchObject({ queued: true, delivered: false });
    expect(job.warning).toMatch(/jamais connectée/);

    const res = await handleEpson(printer!, form({ ConnectionType: "GetRequest", ID: "caisse" }));
    const xml = await res.text();
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(xml).toContain(`<printjobid>${job.jobId}</printjobid>`);
    expect(xml).toContain("Test d'impression");
    expect(xml).toContain('<pulse drawer="drawer_1" time="pulse_100"/>');
    expect(xml).toContain('<cut type="feed"/>');
    // Déjà remis : pas de second ticket à la requête suivante
    expect(await (await handleEpson(printer!, form({ ConnectionType: "GetRequest" }))).text()).toBe("");

    const response = `<PrintResponseInfo Version="2.00"><ePOSPrint><Parameter><devid>local_printer</devid><printjobid>${job.jobId}</printjobid></Parameter><PrintResponse><response success="true" code="" status="251658262" battery="0"/></PrintResponse></ePOSPrint></PrintResponseInfo>`;
    await handleEpson(printer!, form({ ConnectionType: "SetResponse", ResponseFile: response }));
    expect((await prisma.printJob.findUniqueOrThrow({ where: { id: job.jobId } })).status).toBe("DONE");
    const after = await prisma.printer.findUniqueOrThrow({ where: { id: saved.id } });
    expect(after.lastSeenAt).not.toBeNull();
    expect(after.lastStatus).toBe("Prête");
  });

  it("Star CloudPRNT : interrogation, récupération par jeton de travail, fin d'impression", async () => {
    const saved = await upsertPrinter(T.managerActor, { name: "Cuisine Star", kind: "KITCHEN", driver: "cloud-star" });
    const printer = (await findCloudPrinter(saved.cloudToken!))!;
    expect(await (await handleStarPoll(printer, { statusCode: "200%20OK" })).json()).toEqual({ jobReady: false });

    const o = await orderWithWater();
    const job = await printDocument(T.est.id, saved.id, { kind: "receipt", orderId: o.id });
    const poll = await (await handleStarPoll(printer, { statusCode: "200%20OK", printingInProgress: false })).json();
    expect(poll).toMatchObject({ jobReady: true, jobToken: job.jobId });
    expect(poll.mediaTypes).toContain("application/vnd.star.starprnt");

    const fetched = await handleStarFetch(printer, new URLSearchParams({ type: "application/vnd.star.starprnt", token: job.jobId! }));
    expect(fetched.headers.get("content-type")).toBe("application/vnd.star.starprnt");
    const bytes = Buffer.from(await fetched.arrayBuffer());
    expect(bytes[0]).toBe(0x1b);
    expect(bytes.toString("latin1")).toContain("2 x Eau");
    expect((await handleStarFetch(printer, new URLSearchParams({ token: job.jobId! }))).status).toBe(404);

    await handleStarDone(printer, new URLSearchParams({ token: job.jobId!, code: "200%20OK" }));
    expect((await prisma.printJob.findUniqueOrThrow({ where: { id: job.jobId } })).status).toBe("DONE");
  });

  it("travaux trop anciens expirés, nouvelle adresse : l'ancienne ne fonctionne plus", async () => {
    const saved = await upsertPrinter(T.managerActor, { name: "Bar", kind: "RECEIPT", driver: "cloud-epson" });
    const job = await printDocument(T.est.id, saved.id, { kind: "test" });
    await prisma.printJob.update({ where: { id: job.jobId }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    const printer = (await findCloudPrinter(saved.cloudToken!))!;
    expect(await (await handleEpson(printer, form({ ConnectionType: "GetRequest" }))).text()).toBe("");
    expect((await prisma.printJob.findUniqueOrThrow({ where: { id: job.jobId } })).status).toBe("FAILED");

    const fresh = await regenerateCloudToken(T.managerActor, saved.id);
    expect(await findCloudPrinter(saved.cloudToken!)).toBeNull();
    expect((await findCloudPrinter(fresh))?.id).toBe(saved.id);
    // Passage à un autre pilote : l'adresse est supprimée
    await upsertPrinter(T.managerActor, { id: saved.id, name: "Bar", kind: "RECEIPT", driver: "browser" });
    expect(await findCloudPrinter(fresh)).toBeNull();
  });
});

describe("Tiroir-caisse", () => {
  it("le ticket ne contient jamais l'ouverture du tiroir (réimpression sans ouverture)", async () => {
    const o = await orderWithWater();
    expect((await renderReceiptDoc(T.est.id, o.id)).some((op) => op.t === "drawer")).toBe(false);
  });

  it("refusé sans tiroir sur une imprimante navigateur ; ouverture par l'imprimante réseau, tracée dans le journal", async () => {
    await expect(upsertPrinter(T.managerActor, { name: "AirPrint", kind: "RECEIPT", driver: "browser", hasDrawer: true })).rejects.toMatchObject({ code: "DRAWER_UNSUPPORTED" });
    await prisma.printer.updateMany({ where: { establishmentId: T.est.id }, data: { hasDrawer: false } });
    await expect(openDrawer(T.actor, { trigger: "manual" })).rejects.toMatchObject({ code: "NO_DRAWER" });

    const p = await upsertPrinter(T.managerActor, { name: "Caisse réseau", kind: "RECEIPT", driver: "escpos-network", connection: { host: "127.0.0.1", port: tcpPort }, hasDrawer: true, drawerPin: 5 });
    const before = received.length;
    const r = await openDrawer(T.actor, { trigger: "manual", reason: "Faire de la monnaie" });
    expect(r.delivered).toBe(true);
    await new Promise((res) => setTimeout(res, 100));
    expect(received.length).toBe(before + 1);
    expect([...received[received.length - 1]].join(",")).toContain([0x1b, 0x70, 0x01, 0x19, 0xfa].join(","));
    const log = await prisma.auditLog.findFirst({ where: { establishmentId: T.est.id, action: "drawer.open" }, orderBy: { createdAt: "desc" } });
    expect(log?.entityId).toBe(p.id);
    expect(log?.newValue).toMatchObject({ trigger: "manual", reason: "Faire de la monnaie" });
  });

  it("préférence à l'imprimante de la caisse ; ouverture automatique pour les espèces, pas pour la carte", async () => {
    await prisma.printer.updateMany({ where: { establishmentId: T.est.id }, data: { hasDrawer: false } });
    const terminal = await prisma.terminal.create({ data: { establishmentId: T.est.id, name: "Caisse 2", kind: "POS", deviceKeyHash: `test-${Date.now()}` } });
    const shared = await upsertPrinter(T.managerActor, { name: "A commune", kind: "RECEIPT", driver: "cloud-epson", hasDrawer: true });
    const own = await upsertPrinter(T.managerActor, { name: "B caisse 2", kind: "RECEIPT", driver: "cloud-epson", hasDrawer: true, terminalId: terminal.id });
    expect((await findDrawerPrinter(T.est.id, terminal.id))?.id).toBe(own.id);
    expect((await findDrawerPrinter(T.est.id, null))?.id).toBe(shared.id);

    const actor = { ...T.actor, terminalId: terminal.id };
    expect(await openDrawerAfterPayment(actor, ["CARD"])).toBeNull();
    const cash = await openDrawerAfterPayment(actor, ["CASH"]);
    expect(cash?.queued).toBe(true);
    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: cash!.jobId } });
    expect(job.printerId).toBe(own.id);
    expect(job.kind).toBe("drawer");
    expect(job.document).toEqual([{ t: "drawer", pin: 2 }]);
  });
});

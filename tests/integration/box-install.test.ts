import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { applyMigrations, listMigrations } from "../../tools/box-gateway/migrate.mjs";
import { releaseArchive, releaseAvailable } from "@/server/box/release";
import { boxHostname, dnsConfigured, isPrivateIpv4, setBoxAddress } from "@/server/box/certificate";
import { createBox } from "@/server/box/boxes";

const MIGRATIONS = path.resolve("prisma/migrations");
const boxDbUrl = process.env.DATABASE_URL!.replace(/\/manaresto_test(\?|$)/, "/manaresto_box_install_test$1");

let T: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("box-install");
  // Base vierge, comme sur un mini-PC neuf
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL!.replace(/\/manaresto_test(\?|$)/, "/postgres$1") });
  await admin.connect();
  await admin.query("DROP DATABASE IF EXISTS manaresto_box_install_test WITH (FORCE)");
  await admin.query("CREATE DATABASE manaresto_box_install_test");
  await admin.end();
});

describe("installation du boîtier : base créée avec les migrations de la version", () => {
  it("toutes les migrations sur une base vierge, puis rien à refaire ; même empreinte que Prisma", async () => {
    const applied = await applyMigrations({ databaseUrl: boxDbUrl, dir: MIGRATIONS });
    expect(applied).toEqual(listMigrations(MIGRATIONS));
    expect(await applyMigrations({ databaseUrl: boxDbUrl, dir: MIGRATIONS })).toEqual([]);

    const box = new pg.Client({ connectionString: boxDbUrl });
    await box.connect();
    const ours = (await box.query(`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`)).rows;
    const tables = (await box.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('orders','local_boxes','platform_secrets')`)).rows[0].n;
    await box.end();
    expect(tables).toBe(3);
    // Empreintes identiques à celles de `prisma migrate deploy` (base de test) : les deux outils se comprennent
    const prismaRows = await prisma.$queryRawUnsafe<{ migration_name: string; checksum: string }[]>(`SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`);
    expect(ours).toEqual(prismaRows);
  });

  it("une migration en erreur n'est pas notée comme faite et le boîtier le dit clairement", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
    fs.mkdirSync(path.join(dir, "29990101000000_casse"));
    fs.writeFileSync(path.join(dir, "29990101000000_casse", "migration.sql"), "CREATE TABLE ok_avant (id int); SELECT * FROM table_inexistante;");
    await expect(applyMigrations({ databaseUrl: boxDbUrl, dir })).rejects.toThrow(/29990101000000_casse/);
    const box = new pg.Client({ connectionString: boxDbUrl });
    await box.connect();
    expect((await box.query(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '29990101000000_casse'`)).rows[0].n).toBe(0);
    expect((await box.query(`SELECT to_regclass('ok_avant') AS t`)).rows[0].t).toBeNull(); // annulée en entier
    await box.end();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("version du boîtier fournie par le cloud", () => {
  it("archive du dossier de l'application, faite une fois ; refusée si le dossier n'est pas une version complète", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-"));
    expect(releaseAvailable(dir)).toBe(false);
    await expect(releaseArchive(dir)).rejects.toMatchObject({ status: 503 });
    for (const f of ["server.js", "box/box.mjs", "box/gateway.mjs", "prisma/migrations/0001_init/migration.sql", ".env", ".env.production", ".next/cache/x"]) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), `// ${f}`);
    }
    const file = await releaseArchive(dir);
    const listing = execFileSync("tar", ["-tzf", file]).toString();
    expect(listing).toContain("./server.js");
    expect(listing).toContain("./box/box.mjs");
    expect(listing).not.toMatch(/\.env|\.next\/cache/); // configuration jamais envoyée aux boîtiers
    expect(await releaseArchive(dir)).toBe(file);
    fs.rmSync(file, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("adresse HTTPS du boîtier sur le réseau du restaurant", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; vi.unstubAllGlobals(); });
  afterAll(() => { process.env = env; });

  it("seules les adresses d'un réseau local sont acceptées", () => {
    for (const ip of ["192.168.1.20", "10.0.0.5", "172.16.3.4", "172.31.255.1"]) expect(isPrivateIpv4(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "127.0.0.1", "192.168.1.300", "fe80::1", "", "192.168.1"]) expect(isPrivateIpv4(ip)).toBe(false);
  });

  it("sans configuration DNS sur le cloud : refus explicite, rien n'est appelé", async () => {
    delete process.env.BOX_DNS_ZONE;
    const box = await createBox(T.managerActor, { name: "Boîtier" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(dnsConfigured()).toBe(false);
    await expect(setBoxAddress(box, "192.168.1.20")).rejects.toMatchObject({ status: 503, code: "DNS_NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("avec Cloudflare : l'adresse du boîtier pointe vers le mini-PC (créée, puis mise à jour)", async () => {
    Object.assign(process.env, { BOX_DNS_ZONE: "box.manaresto.test", CLOUDFLARE_API_TOKEN: "cf-test", CLOUDFLARE_ZONE_ID: "zone1" });
    const box = await createBox(T.managerActor, { name: "Boîtier DNS" });
    const host = boxHostname(box.id)!;
    expect(host).toMatch(/^[0-9a-f]{8}\.box\.manaresto\.test$/);
    const records: { id: string; type: string; name: string; content: string }[] = [];
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const u = new URL(url);
      calls.push(`${init.method} ${u.pathname.replace("/client/v4/zones/zone1", "")}`);
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer cf-test");
      if (init.method === "GET") return Response.json({ success: true, result: records.filter((r) => r.name === u.searchParams.get("name")) });
      const body = JSON.parse(String(init.body));
      expect(body.proxied).toBe(false);
      if (init.method === "POST") records.push({ id: "r1", ...body });
      if (init.method === "PUT") Object.assign(records[0], body);
      return Response.json({ success: true, result: records[0] });
    }));
    expect(await setBoxAddress(box, "192.168.1.20")).toBe(host);
    expect(records).toEqual([expect.objectContaining({ type: "A", name: host, content: "192.168.1.20" })]);
    await setBoxAddress(box, "192.168.1.20"); // inchangée : aucune écriture
    await setBoxAddress(box, "192.168.1.42");
    expect(records[0].content).toBe("192.168.1.42");
    expect(calls).toEqual(["GET /dns_records", "POST /dns_records", "GET /dns_records", "GET /dns_records", "PUT /dns_records/r1"]);
    expect((await prisma.localBox.findUniqueOrThrow({ where: { id: box.id } })).lanIp).toBe("192.168.1.42");
    await expect(setBoxAddress(box, "8.8.8.8")).rejects.toMatchObject({ status: 400 });
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { escapeHtml, printableHtml } from "@/server/html";
import { isPrivateAddress, publicOnlyLookup } from "@/server/net/public-url";
import { assertLanPrinter, lanPrintingEnabled } from "@/server/hardware/printers";

describe("pages imprimables (ticket, bon cuisine, rapport de caisse)", () => {
  it("un texte saisi n'est jamais interprété comme du balisage", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">'&`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;");
    expect(escapeHtml(null)).toBe("");
  });

  it("seuls les scripts de la page s'exécutent : politique stricte avec nonce, plus de onclick en ligne", async () => {
    const res = printableHtml(`<html><body><button onclick="window.print()">Imprimer</button><script>window.print()</script></body></html>`);
    const csp = res.headers.get("content-security-policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("unsafe-inline'; script");
    const body = await res.text();
    expect(body).not.toContain("onclick");
    expect(body).toContain("data-print");
    expect(body.match(/<script nonce="([^"]+)">/g)).toHaveLength(2);
    expect(body).toContain(`<script nonce="${nonce}">`);
  });
});

describe("requêtes sortantes (webhooks) : jamais vers une adresse interne", () => {
  it("adresses internes et passerelles IPv6 vers l'IPv4 refusées", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1", "::10.0.0.1", "64:ff9b::a00:1", "2002:a00:1::1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });

  it("la résolution utilisée pour la connexion refuse un nom qui pointe vers la machine", async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => publicOnlyLookup("localhost", {}, (e) => resolve(e)));
    expect(err?.code).toBe("EPRIVATE");
  });
});

describe("imprimante réseau directe : jamais depuis le serveur en ligne", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it("serveur en ligne : désactivée ; boîtier ou installation locale : activée", () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.BOX_MODE; delete process.env.LAN_PRINTING;
    expect(lanPrintingEnabled()).toBe(false);
    process.env.BOX_MODE = "1";
    expect(lanPrintingEnabled()).toBe(true);
  });

  it("seulement une imprimante du réseau du restaurant, sur un port d'impression", () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    expect(() => assertLanPrinter("192.168.1.50", 9100)).not.toThrow();
    expect(() => assertLanPrinter("127.0.0.1", 9100)).toThrow(expect.objectContaining({ code: "BAD_PRINTER_HOST" }));
    expect(() => assertLanPrinter("169.254.169.254", 80)).toThrow(expect.objectContaining({ code: "BAD_PRINTER_HOST" }));
    expect(() => assertLanPrinter("imprimante.exemple.com", 9100)).toThrow(expect.objectContaining({ code: "BAD_PRINTER_HOST" }));
    expect(() => assertLanPrinter("192.168.1.50", 22)).toThrow(expect.objectContaining({ code: "BAD_PRINTER_PORT" }));
  });
});

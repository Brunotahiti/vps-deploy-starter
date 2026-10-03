import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { prisma } from "@/server/db";
import { resolveShareSlug } from "@/server/services/share";
import { restaurantSite } from "@/server/services/public";
import { shareLabel, shareUrl } from "@/lib/share";

export const dynamic = "force-dynamic";

/** Polices (lues une fois) : Plus Jakarta Sans, la police de ManaResto, avec les lettres à macron (ā, ē…). */
let fonts: Promise<{ name: string; data: Buffer; weight: 500 | 800; style: "normal" }[]> | null = null;
const loadFonts = () => (fonts ??= Promise.all(
  ([["ExtraBold", 800], ["ExtraBold-ext", 800], ["Medium", 500], ["Medium-ext", 500]] as const).map(async ([file, weight]) => ({
    name: "Jakarta", weight, style: "normal" as const, data: await readFile(path.join(process.cwd(), "src/server/fonts", `PlusJakartaSans-${file}.ttf`)),
  })),
));

/**
 * Photo du restaurant en data URI JPEG (le générateur d'image ne lit pas le WebP) : photo envoyée (lue en base),
 * fichier de l'application (/demo/…) ou adresse externe (3 s au plus), recadrée à la taille voulue.
 */
async function photo(url: string, w: number, h: number): Promise<string | null> {
  if (!url) return null;
  try {
    let bytes: Buffer | null = null;
    const m = url.match(/^\/api\/uploads\/([0-9a-f-]{36})$/);
    if (m) bytes = await prisma.upload.findUnique({ where: { id: m[1] }, select: { data: true } }).then((u) => (u ? Buffer.from(u.data) : null));
    else if (/^\/[a-z0-9/_.-]+\.(webp|png|jpe?g)$/i.test(url) && !url.includes("..")) bytes = await readFile(path.join(process.cwd(), "public", url));
    else if (/^https:\/\//.test(url)) {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok && (r.headers.get("content-type") ?? "").startsWith("image/") && Number(r.headers.get("content-length") ?? 0) <= 8_000_000) bytes = Buffer.from(await r.arrayBuffer());
    }
    if (!bytes) return null;
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp(bytes).rotate().resize(w, h, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch { return null; }
}

/**
 * Image d'aperçu (1200 × 630) quand l'adresse du site est partagée sur WhatsApp, Facebook, Messenger… :
 * photo de couverture, nom, accroche, ville et adresse de partage.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const est = await resolveShareSlug(slug);
  const data = est ? await restaurantSite(est.organization.slug, est.slug).catch(() => null) : null;
  if (!data) return new Response("Introuvable", { status: 404 });
  const e = data.establishment, s = data.site;
  const [cover, logo] = await Promise.all([photo(s.coverUrl, 1200, 630), photo(s.logoUrl, 192, 192)]);
  const accent = /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : "#14aaa3";
  const place = [e.city, e.island].filter(Boolean).join(" · ") || "Polynésie française";
  const tagline = (s.tagline || s.description).slice(0, 110);
  const chips = [data.online.enabled ? "Commander" : null, "Réserver", data.menu ? "Voir la carte" : null].filter(Boolean) as string[];
  const nameSize = e.name.length > 28 ? 64 : e.name.length > 18 ? 80 : 96;

  const png = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", fontFamily: "Jakarta", color: "#fff", background: `linear-gradient(135deg, ${accent}, #0b1222)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- image générée (satori), pas une page */}
        {cover ? <img src={cover} width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover" }} alt="" /> : null}
        <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex", backgroundImage: cover ? "linear-gradient(180deg, rgba(8,15,31,0.30) 0%, rgba(8,15,31,0.62) 42%, rgba(8,15,31,0.92) 100%)" : "radial-gradient(900px 500px at 85% 0%, rgba(255,255,255,0.18), transparent)" }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: "56px 64px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- image générée (satori), pas une page */}
            {logo ? <img src={logo} width={96} height={96} style={{ width: 96, height: 96, borderRadius: 24, objectFit: "cover", border: "4px solid rgba(255,255,255,0.85)" }} alt="" /> : <div style={{ display: "flex" }} />}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 22px", borderRadius: 999, background: "rgba(8,15,31,0.55)", fontSize: 26, fontWeight: 500 }}>{shareLabel(shareUrl(e.shareSlug ?? slug))}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 500, color: "rgba(255,255,255,0.85)", letterSpacing: 1 }}>{place.toUpperCase()}</div>
            <div style={{ display: "flex", fontSize: nameSize, fontWeight: 800, lineHeight: 1.05, marginTop: 8, letterSpacing: -2 }}>{e.name}</div>
            {tagline ? <div style={{ display: "flex", fontSize: 32, fontWeight: 500, marginTop: 14, color: "rgba(255,255,255,0.92)", maxWidth: 1000 }}>{tagline}</div> : null}
            <div style={{ display: "flex", gap: 14, marginTop: 30 }}>
              {chips.map((c, i) => <div key={c} style={{ display: "flex", padding: "14px 28px", borderRadius: 999, fontSize: 28, fontWeight: 800, background: i === 0 ? accent : "rgba(255,255,255,0.18)", border: i === 0 ? "none" : "2px solid rgba(255,255,255,0.5)" }}>{c}</div>)}
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts: await loadFonts() },
  );
  // JPEG léger (≈ 150 Ko au lieu de ≈ 2 Mo en PNG) : WhatsApp n'affiche pas les aperçus trop lourds
  const raw = Buffer.from(await png.arrayBuffer());
  const jpeg = await import("sharp").then((m) => m.default(raw).jpeg({ quality: 84, mozjpeg: true }).toBuffer()).catch(() => null);
  return new Response(new Uint8Array(jpeg ?? raw), { headers: { "Content-Type": jpeg ? "image/jpeg" : "image/png", "Cache-Control": "public, max-age=3600, s-maxage=3600" } });
}

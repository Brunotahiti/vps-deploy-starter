import { route, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { isDemoEstablishment } from "@/server/services/demo";

const MAX = 4 * 1024 * 1024; // 4 Mo (les photos sont réduites côté navigateur avant envoi)
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Envoi d'une photo (multipart, champ `file`) : stockée en base, renvoie l'URL à enregistrer dans imageUrl. */
/** Signature réelle du fichier (le type annoncé par le navigateur ne suffit pas). */
function sniff(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export const POST = route(async (req) => {
  const ctx = await requirePermission("catalog.manage");
  // Corps trop lourd refusé avant d'être lu
  if (Number(req.headers.get("content-length") ?? 0) > MAX + 64 * 1024) throw new ApiError(413, "TOO_LARGE", "Photo trop lourde (4 Mo maximum)");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "NO_FILE", "Aucun fichier reçu");
  if (!TYPES.has(file.type)) throw new ApiError(415, "BAD_TYPE", "Format accepté : JPEG, PNG, WebP ou GIF");
  if (file.size > MAX) throw new ApiError(413, "TOO_LARGE", "Photo trop lourde (4 Mo maximum)");
  const dim = (v: FormDataEntryValue | null) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 && n <= 20_000 ? n : null; };
  const width = dim(form!.get("width")), height = dim(form!.get("height"));
  // Compte de démonstration (identifiants publics) : nombre de photos limité
  if (await isDemoEstablishment(ctx.establishment.id) && (await prisma.upload.count({ where: { establishmentId: ctx.establishment.id } })) >= 40) throw new ApiError(403, "DEMO_LIMIT", "Limite de photos atteinte sur le compte de démonstration");
  const data = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(data);
  if (!mime) throw new ApiError(415, "BAD_TYPE", "Format accepté : JPEG, PNG, WebP ou GIF");
  const up = await prisma.upload.create({ data: { establishmentId: ctx.establishment.id, mime, size: data.byteLength, width, height, data }, select: { id: true, mime: true, size: true } });
  return created({ ...up, url: `/api/uploads/${up.id}` });
});

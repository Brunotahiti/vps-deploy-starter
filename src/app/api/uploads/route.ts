import { route, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";

const MAX = 4 * 1024 * 1024; // 4 Mo (les photos sont réduites côté navigateur avant envoi)
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Envoi d'une photo (multipart, champ `file`) : stockée en base, renvoie l'URL à enregistrer dans imageUrl. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("catalog.manage");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "NO_FILE", "Aucun fichier reçu");
  if (!TYPES.has(file.type)) throw new ApiError(415, "BAD_TYPE", "Format accepté : JPEG, PNG, WebP ou GIF");
  if (file.size > MAX) throw new ApiError(413, "TOO_LARGE", "Photo trop lourde (4 Mo maximum)");
  const width = Number(form!.get("width")) || null, height = Number(form!.get("height")) || null;
  const data = new Uint8Array(await file.arrayBuffer());
  const up = await prisma.upload.create({ data: { establishmentId: ctx.establishment.id, mime: file.type, size: data.byteLength, width, height, data }, select: { id: true, mime: true, size: true } });
  return created({ ...up, url: `/api/uploads/${up.id}` });
});

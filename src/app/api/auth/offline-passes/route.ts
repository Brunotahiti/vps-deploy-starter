import { route, ok } from "@/server/http";
import { prisma } from "@/server/db";
import { getTerminalFromCookie } from "@/server/auth/session";
import { ApiError } from "@/server/errors";
import { issueOfflinePasses } from "@/server/services/offline-pass";
import { publicEstablishment } from "@/server/services/establishments";

/**
 * Laissez-passer hors ligne des employés, pour ce terminal enregistré (chiffrés : seul le PIN de chacun les ouvre),
 * avec ce dont la tablette a besoin pour fonctionner sans internet (établissement, terminal).
 */
export const GET = route(async () => {
  const terminal = await getTerminalFromCookie();
  if (!terminal) throw new ApiError(400, "NO_TERMINAL", "Cet appareil n'est pas enregistré comme terminal");
  const establishment = await prisma.establishment.findUniqueOrThrow({ where: { id: terminal.establishmentId }, include: { organization: { select: { options: true } } } });
  // Connexion sans internet : option Continuité de service
  if (!establishment.organization.options.includes("continuity")) throw new ApiError(403, "OPTION_REQUIRED", "Option « Continuité de service » à débloquer dans Gestion → Options");
  const issued = await issueOfflinePasses(terminal);
  return ok({
    ...issued,
    establishment: publicEstablishment((({ organization: _o, ...e }) => { void _o; return e; })(establishment)),
    terminal: { id: terminal.id, name: terminal.name, kind: terminal.kind, establishmentId: terminal.establishmentId, establishmentName: terminal.establishmentName },
  });
});

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { ApiError } from "@/server/errors";

/**
 * Assistant IA : Claude rédige les analyses à partir des chiffres calculés par le programme.
 * Clé : ANTHROPIC_API_KEY. En test (AI_TRANSPORT=fake), une réponse d'exemple tient lieu d'appel.
 * Repli automatique activé (`fallbacks: "default"`) : si le modèle décline, un autre modèle reprend la demande.
 */
export const AI_MODEL = "claude-opus-5-5";

export const isAiConfigured = () => process.env.AI_TRANSPORT === "fake" || !!process.env.ANTHROPIC_API_KEY;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ timeout: 180_000, maxRetries: 2 }));

/** Réponse structurée (validée par le schéma) ; `fake` fournit la réponse d'exemple des tests. */
export async function aiStructured<S extends z.ZodType>(input: { schema: S; system: string; prompt: string; fake: () => z.infer<S>; effort?: "low" | "medium" | "high" }): Promise<{ data: z.infer<S>; model: string }> {
  if (process.env.AI_TRANSPORT === "fake") return { data: input.fake(), model: "exemple" };
  if (!process.env.ANTHROPIC_API_KEY) throw new ApiError(503, "AI_NOT_CONFIGURED", "L'Assistant IA n'est pas encore branché sur ce serveur (clé ANTHROPIC_API_KEY manquante)");
  try {
    const response = await getClient().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: input.effort ?? "medium", format: betaZodOutputFormat(input.schema) },
      system: input.system,
      messages: [{ role: "user", content: input.prompt }],
    });
    if (response.stop_reason === "refusal") throw new ApiError(422, "AI_REFUSED", "L'Assistant IA n'a pas pu produire cette analyse : réessayez plus tard");
    if (response.stop_reason === "max_tokens" || !response.parsed_output) throw new ApiError(502, "AI_INCOMPLETE", "Analyse incomplète : réessayez");
    return { data: response.parsed_output as z.infer<S>, model: response.model };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new ApiError(503, "AI_KEY_INVALID", "Clé de l'Assistant IA refusée : vérifiez ANTHROPIC_API_KEY");
    if (e instanceof Anthropic.RateLimitError) throw new ApiError(503, "AI_BUSY", "L'Assistant IA est très demandé : réessayez dans une minute");
    if (e instanceof Anthropic.APIError) throw new ApiError(502, "AI_ERROR", `Assistant IA indisponible (${e.status ?? "réseau"}) : réessayez`);
    throw e;
  }
}

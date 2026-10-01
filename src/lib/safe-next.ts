/** Destination après connexion : uniquement un chemin interne (« /… »), jamais une adresse externe (hameçonnage). */
export function safeNext(raw: string | null | undefined, fallback: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || /[\u0000-\u001f]/.test(raw)) return fallback;
  return raw;
}

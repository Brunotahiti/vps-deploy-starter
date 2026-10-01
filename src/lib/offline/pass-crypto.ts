/** Ouverture d'un laissez-passer hors ligne avec le PIN (WebCrypto : navigateur et Node). Aucune dépendance. */
export type SealedPass = { userId: string; iv: string; data: string };
export type PassKdf = { iterations: number; hash: string; salt: string };

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Retourne le contenu du laissez-passer que ce PIN ouvre (chiffrement authentifié : un mauvais PIN n'ouvre rien), sinon null. */
export async function openSealedPass<T>(pin: string, kdf: PassKdf, passes: SealedPass[]): Promise<T | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || passes.length === 0) return null;
  const enc = new TextEncoder();
  const base = await subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "PBKDF2", salt: enc.encode(kdf.salt), iterations: kdf.iterations, hash: kdf.hash }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  for (const p of passes) {
    try {
      const plain = await subtle.decrypt({ name: "AES-GCM", iv: b64(p.iv) }, key, b64(p.data));
      return JSON.parse(new TextDecoder().decode(plain)) as T;
    } catch { /* pas ce laissez-passer */ }
  }
  return null;
}

"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/** Erreur fatale du rendu racine : envoyée à Sentry, écran de secours minimal avec rechargement. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", textAlign: "center", background: "#f5f7fa", color: "#0f172a" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>Une erreur est survenue</h1>
        <p style={{ color: "#5b6b82", marginTop: "0.5rem" }}>Nous avons été prévenus. Rechargez la page pour continuer.</p>
        <button onClick={() => window.location.reload()} style={{ marginTop: "1.5rem", height: 48, padding: "0 24px", borderRadius: 14, border: 0, background: "#14aaa3", color: "#fff", fontWeight: 800, fontSize: 16 }}>Recharger</button>
      </body>
    </html>
  );
}

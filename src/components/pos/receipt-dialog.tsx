"use client";

import { useState } from "react";
import { Mail, Printer, FileDown, Check } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/hooks/use-session";

/**
 * Choix du reçu après paiement (ou depuis le bouton Ticket) :
 * imprimer, télécharger le PDF, ou l'envoyer par e-mail au client.
 */
export function ReceiptDialog({ orderId, orderNumber, open, onClose, title = "Reçu", afterPayment = false }: { orderId: string; orderNumber?: string; open: boolean; onClose: () => void; title?: string; afterPayment?: boolean }) {
  const { toast } = useToast();
  const { me } = useSession();
  const emailEnabled = me?.features?.email ?? false;
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    try {
      const r = await api.post<{ to: string }>(`/api/orders/${orderId}/email`, { email });
      setSentTo(r.to);
      toast(`Reçu envoyé à ${r.to}`, "success");
      setEmail("");
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Envoi impossible", "error");
    } finally {
      setSending(false);
    }
  };
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  return (
    <Modal open={open} onClose={onClose} title={afterPayment ? "Commande soldée" : title} size="sm">
      {afterPayment ? <div className="mb-4 flex items-center gap-3 rounded-2xl bg-lagon-500/10 p-3 text-sm"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white"><Check className="h-5 w-5" /></span><span><strong>Paiement enregistré.</strong> Que faire du reçu{orderNumber ? ` n° ${orderNumber.split("-")[1]}` : ""} ?</span></div> : null}
      <div className="grid grid-cols-2 gap-2">
        <a href={`/api/orders/${orderId}/receipt?print=1`} target="_blank" rel="noreferrer" className="touch card flex h-20 flex-col items-center justify-center gap-1 text-sm font-bold shadow-none hover:surface-2"><Printer className="h-5 w-5 text-muted" />Imprimer</a>
        <a href={`/api/orders/${orderId}/receipt?format=pdf`} target="_blank" rel="noreferrer" className="touch card flex h-20 flex-col items-center justify-center gap-1 text-sm font-bold shadow-none hover:surface-2"><FileDown className="h-5 w-5 text-muted" />PDF</a>
      </div>
      <div className="mt-3 rounded-2xl surface-2 p-3">
        <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted"><Mail className="h-4 w-4" /> Envoyer le reçu PDF par e-mail</p>
        {emailEnabled ? (
          <div className="flex gap-2">
            <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && valid && send()} placeholder="client@exemple.pf" className="h-12 min-w-0 flex-1 rounded-xl border border-line surface px-3 text-base outline-none focus:border-lagon-500 focus:ring-4 focus:ring-lagon-500/15" />
            <Button size="lg" loading={sending} disabled={!valid} onClick={send}><Mail className="h-4 w-4" /> Envoyer</Button>
          </div>
        ) : (
          <p className="text-xs text-muted">Non configuré : renseignez les variables SMTP du serveur (voir Paramètres) pour activer l&apos;envoi.</p>
        )}
        {sentTo ? <p className="mt-2 text-xs font-semibold text-lagon-700 dark:text-lagon-300">✓ Envoyé à {sentTo}</p> : null}
      </div>
      <Button variant={afterPayment ? "primary" : "secondary"} size="lg" className="mt-4 w-full" onClick={onClose}>{afterPayment ? "Terminer" : "Fermer"}</Button>
    </Modal>
  );
}

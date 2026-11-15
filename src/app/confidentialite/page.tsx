import type { Metadata } from "next";
import Link from "next/link";
import { OFFER } from "@/lib/plan";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Quelles données ManaResto traite, pourquoi, combien de temps, avec qui, et comment exercer vos droits.",
};

/** Date de la dernière mise à jour du texte : à changer à chaque modification. */
const UPDATED = "15 novembre 2026";
const CONTACT = OFFER.contactEmail;
/** Société qui édite ManaResto */
const COMPANY = { name: "ManaProcess", address: "Faa'a, Tahiti, Polynésie française" };

/**
 * Politique de confidentialité de ManaResto (site, caisse, gestion, app iOS).
 * Page publique, sans connexion : son adresse est demandée par l'App Store.
 * Le texte décrit ce que fait réellement le programme : à tenir à jour avec lui.
 */
export default function PrivacyPage() {
  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      <article className="mx-auto max-w-3xl px-5 py-10 text-[15px] leading-relaxed sm:py-14">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-lagon-600">ManaResto</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Politique de confidentialité</h1>
        <p className="mt-3 text-muted">Dernière mise à jour : {UPDATED}</p>

        <p className="mt-6">
          ManaResto est un logiciel de caisse et de gestion pour les restaurants, utilisable sur le site app.manaresto.com et dans l&apos;application iOS ManaResto. Cette page explique quelles données sont traitées, pourquoi, combien de temps elles sont gardées, avec qui elles sont partagées et comment exercer vos droits. ManaResto ne vend aucune donnée, n&apos;affiche aucune publicité et ne fait aucun pistage publicitaire.
        </p>

        <Section title="1. Qui est responsable de vos données">
          <p>ManaResto est édité par la société <b>{COMPANY.name}</b>, {COMPANY.address}. Deux situations sont à distinguer.</p>
          <ul>
            <li><b>Les comptes des restaurants</b> (le restaurateur, ses utilisateurs, l&apos;abonnement) : {COMPANY.name} en est responsable.</li>
            <li><b>Les données que le restaurant saisit sur ses clients et son personnel</b> (commandes, réservations, fiches clients, plannings, pointage) : le restaurant en est responsable. ManaResto les traite pour son compte, uniquement pour faire fonctionner le logiciel, et sur ses instructions.</li>
          </ul>
          <p>Pour toute question : <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
        </Section>

        <Section title="2. Les données traitées">
          <ul>
            <li><b>Utilisateurs du logiciel</b> : prénom, nom, adresse e-mail, rôle, mot de passe et code PIN. Le mot de passe et le PIN sont enregistrés sous une forme chiffrée, illisible, même par ManaResto.</li>
            <li><b>Restaurant</b> : nom, raison sociale, adresse, téléphone, e-mail, numéro Tahiti, horaires, carte et prix.</li>
            <li><b>Personnel</b>, si le restaurant utilise la gestion d&apos;équipe : nom, poste, coût horaire, plannings, congés, heures de pointage et code PIN de pointage, chiffré.</li>
            <li><b>Clients du restaurant</b> : nom, téléphone, e-mail, adresse de livraison, date d&apos;anniversaire, réservations, commandes, points de fidélité, accord ou refus de recevoir des e-mails. Des allergies peuvent être notées à la demande du client, pour sa sécurité.</li>
            <li><b>Ventes</b> : articles commandés, montants, taxes, moyens de paiement, factures. ManaResto n&apos;enregistre jamais de numéro de carte bancaire : le paiement par carte se fait sur le terminal du restaurant.</li>
            <li><b>Données techniques</b> : adresse IP, type d&apos;appareil et de navigateur, liées aux sessions de connexion et au journal de sécurité. Elles servent à protéger les comptes.</li>
            <li><b>Pages publiques des restaurants</b> : les visites sont comptées avec une empreinte du jour, non réversible. Elle permet de compter un visiteur une fois par jour sans pouvoir le suivre d&apos;un jour à l&apos;autre.</li>
          </ul>
        </Section>

        <Section title="3. Pourquoi ces données sont utilisées">
          <ul>
            <li><b>Faire fonctionner le service souscrit</b> : prise de commande, cuisine, encaissement, tickets et reçus, réservations, stock, planning, rapports, factures. C&apos;est l&apos;exécution du contrat avec le restaurant.</li>
            <li><b>Respecter les obligations légales</b> : conservation des ventes, des tickets et des factures pour la comptabilité et les contrôles fiscaux.</li>
            <li><b>Sécuriser les comptes</b> : sessions, limitation des tentatives de connexion, journal des actions sensibles. C&apos;est l&apos;intérêt légitime de ManaResto et des restaurants.</li>
            <li><b>Envoyer des e-mails aux clients</b> (reçus, confirmations de réservation, campagnes du restaurant) : les campagnes ne partent qu&apos;aux clients qui l&apos;ont accepté, avec un lien de désabonnement dans chaque message.</li>
            <li><b>Envoyer des notifications</b> sur l&apos;appareil d&apos;un serveur, par exemple « plat prêt », seulement s&apos;il les a activées.</li>
          </ul>
        </Section>

        <Section title="4. Avec qui elles sont partagées">
          <p>Les données ne sont transmises qu&apos;aux prestataires nécessaires au service, et seulement pour ce service :</p>
          <ul>
            <li><b>Hébergement</b> : les serveurs et la base de données sont loués chez l&apos;hébergeur Hostinger.</li>
            <li><b>Envoi des e-mails</b> : un service d&apos;envoi d&apos;e-mails transmet les reçus, confirmations et campagnes.</li>
            <li><b>Assistant IA</b>, option facultative : les analyses sont rédigées par le modèle Claude d&apos;Anthropic. Il ne reçoit que le nom de l&apos;établissement et des chiffres agrégés, comme la fréquentation, les ventes ou le stock. Il ne reçoit aucune donnée de client ni de salarié.</li>
            <li><b>Suivi des erreurs techniques</b> : quand il est activé, le service Sentry reçoit les rapports d&apos;erreur du programme pour aider à les corriger.</li>
            <li><b>Notifications</b> : les notifications passent par le service du fabricant de l&apos;appareil ou du navigateur (Apple, Google ou Mozilla).</li>
          </ul>
          <p>Certains de ces prestataires peuvent traiter des données hors de la Polynésie française, notamment aux États-Unis ou dans l&apos;Union européenne, avec des garanties contractuelles de protection.</p>
          <p>Le restaurant voit les données de son propre établissement. Un restaurant ne voit jamais les données d&apos;un autre.</p>
        </Section>

        <Section title="5. Combien de temps elles sont gardées">
          <ul>
            <li><b>Compte du restaurant et données de gestion</b> : pendant toute la durée de l&apos;abonnement. Elles sont supprimées à la demande du restaurant après la fin du contrat, sauf ce que la loi impose de garder.</li>
            <li><b>Ventes, tickets et factures</b> : pendant la durée imposée par les obligations comptables et fiscales.</li>
            <li><b>Session de connexion</b> : quelques heures, 12 heures par défaut, puis il faut se reconnecter.</li>
            <li><b>Enregistrement d&apos;un appareil comme caisse</b> : 1 an, ou jusqu&apos;à ce que l&apos;appareil soit retiré.</li>
            <li><b>Statistiques de visite des pages publiques</b> : 13 mois, puis suppression automatique.</li>
          </ul>
        </Section>

        <Section title="6. Cookies et stockage sur l'appareil">
          <p>ManaResto n&apos;utilise aucun cookie publicitaire ni de mesure d&apos;audience tiers. Les seuls cookies servent au fonctionnement :</p>
          <ul>
            <li><b>Connexion</b> : il garde la personne connectée pendant sa session.</li>
            <li><b>Appareil caisse</b> : il reconnaît une tablette ou un téléphone enregistré, pour la connexion de l&apos;équipe par code PIN.</li>
            <li><b>Démonstration</b> : il permet de revenir à son compte après avoir visité le restaurant exemple.</li>
          </ul>
          <p>Pour fonctionner sans Internet, la caisse garde aussi sur l&apos;appareil une copie de la carte et des commandes en attente d&apos;envoi. Elle est envoyée au serveur dès le retour du réseau.</p>
        </Section>

        <Section title="7. Application iOS">
          <p>L&apos;application iOS ManaResto utilise les mêmes comptes et les mêmes données que le site. Elle ne contient aucun outil de publicité, de statistiques ou de pistage. Elle garde seulement sur l&apos;iPhone ou l&apos;iPad la session de connexion et l&apos;adresse du serveur. Une adresse e-mail saisie pour envoyer un reçu sert uniquement à cet envoi.</p>
        </Section>

        <Section title="8. Sécurité">
          <p>Toutes les connexions sont chiffrées (HTTPS). Les mots de passe et codes PIN sont enregistrés sous une forme irréversible, et les tentatives de connexion sont limitées. Chaque restaurant est cloisonné. Chaque utilisateur n&apos;accède qu&apos;à ce que son rôle permet, et les actions sensibles sont inscrites dans un journal.</p>
        </Section>

        <Section title="9. Vos droits">
          <p>Vous pouvez demander à accéder à vos données, à les corriger, à les supprimer ou à les récupérer. Vous pouvez aussi vous opposer à un traitement ou demander à le limiter. Le désabonnement des e-mails du restaurant se fait d&apos;un clic, par le lien en bas de chaque message.</p>
          <ul>
            <li><b>Utilisateur ou restaurateur</b> : écrivez à <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</li>
            <li><b>Client d&apos;un restaurant</b> : adressez-vous d&apos;abord au restaurant, qui gère vos données. Vous pouvez aussi nous écrire et nous transmettrons votre demande.</li>
          </ul>
          <p>Une réponse vous est apportée dans un délai d&apos;un mois. Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la CNIL (cnil.fr).</p>
        </Section>

        <Section title="10. Modifications">
          <p>Cette politique peut évoluer avec le logiciel. La date de mise à jour figure en haut de la page. En cas de changement important, les restaurants en sont informés.</p>
        </Section>

        <p className="mt-10 border-t border-line pt-6 text-sm text-muted">
          {COMPANY.name} · {COMPANY.address} · <a href={`mailto:${CONTACT}`}>{CONTACT}</a> · <Link href="/login">Retour à ManaResto</Link>
        </p>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9 space-y-3 [&_a]:font-semibold [&_a]:text-lagon-600 [&_a]:underline [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
      <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

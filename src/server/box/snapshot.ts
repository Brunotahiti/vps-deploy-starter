/**
 * Copie du restaurant pour le boîtier local (relais de secours pendant les coupures d'internet).
 *
 * Le cloud exporte, table par table, tout ce qu'il faut pour assurer le service d'un établissement : équipe
 * (comptes, rôles, sessions en cours), carte, salle, imprimantes, caisse, commandes en cours et du jour.
 * Le boîtier remplace sa base par cette copie. Export et import passent par du SQL générique
 * (json_agg / json_populate_recordset) : tous les types de colonnes sont repris tels quels, sans liste de champs.
 *
 * Ne sont pas copiés : journaux (audit, e-mails, limites), achats et stocks détaillés, intégrations (clés API,
 * webhooks), fichiers. Le boîtier ne fait que tenir le service ; tout ce qu'il enregistre pendant une coupure
 * est renvoyé au cloud au retour d'internet, qui reste la référence.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { BUILD_ID } from "@/lib/build";

/** $1 = établissement, $2 = entreprise. Ordre = ordre d'insertion (clés étrangères). */
const ORDERS = `(establishment_id = $1 AND (status IN ('OPEN','SENT','BILL_REQUESTED') OR opened_at > now() - interval '36 hours'))`;
const ORDER_IDS = `SELECT id FROM orders WHERE ${ORDERS}`;
const MEMBERS = `SELECT user_id FROM user_establishments WHERE establishment_id = $1`;
/**
 * `set` : colonnes réécrites à l'export (expression SQL sur la ligne `t`).
 * - Liens vers une ligne non copiée vidés (ex. mouvement de caisse d'une vente ancienne) : le montant reste juste.
 * - Données d'authentification réduites au strict nécessaire : seuls les membres de l'établissement (et le PIN du
 *   propriétaire) peuvent se connecter sur le boîtier ; jamais le mot de passe du propriétaire ni une invitation.
 */
export const BOX_TABLES: { table: string; where: string; set?: Record<string, string> }[] = [
  { table: "organizations", where: "id = $2" },
  { table: "establishments", where: "id = $1" },
  { table: "permissions", where: "true" },
  { table: "roles", where: "organization_id = $2" },
  { table: "role_permissions", where: "role_id IN (SELECT id FROM roles WHERE organization_id = $2)" },
  {
    table: "users", where: "organization_id = $2",
    set: {
      password_hash: `CASE WHEN NOT t.is_owner AND t.id IN (${MEMBERS}) THEN t.password_hash ELSE '!' END`,
      pin_hash: `CASE WHEN t.is_owner OR t.id IN (${MEMBERS}) THEN t.pin_hash END`,
      email: `CASE WHEN t.is_owner OR t.id IN (${MEMBERS}) THEN t.email ELSE t.id || '@absent.invalid' END`,
      invite_token: "NULL", invite_expires_at: "NULL",
    },
  },
  { table: "user_establishments", where: "establishment_id = $1" },
  { table: "terminals", where: "establishment_id = $1" },
  { table: "sessions", where: `expires_at > now() AND impersonator_id IS NULL AND (establishment_id = $1 OR (establishment_id IS NULL AND user_id IN (SELECT id FROM users WHERE organization_id = $2 AND is_owner)))` },
  { table: "offline_passes", where: "establishment_id = $1 AND revoked_at IS NULL AND expires_at > now()" },
  { table: "rooms", where: "establishment_id = $1" },
  { table: "tables", where: "establishment_id = $1" },
  { table: "tax_rates", where: "establishment_id = $1" },
  { table: "kitchen_stations", where: "establishment_id = $1" },
  { table: "printers", where: "establishment_id = $1" },
  { table: "categories", where: "establishment_id = $1" },
  // Ingrédients puis fiches vins (option Cave à vin) avant les produits : un format de vente renvoie à son vin
  { table: "ingredients", where: "establishment_id = $1" },
  { table: "wines", where: "establishment_id = $1" },
  { table: "products", where: "establishment_id = $1" },
  { table: "product_variants", where: "product_id IN (SELECT id FROM products WHERE establishment_id = $1)" },
  { table: "modifier_groups", where: "establishment_id = $1" },
  { table: "modifiers", where: "group_id IN (SELECT id FROM modifier_groups WHERE establishment_id = $1)" },
  { table: "product_modifier_groups", where: "product_id IN (SELECT id FROM products WHERE establishment_id = $1)" },
  { table: "menus", where: "establishment_id = $1" },
  { table: "menu_sections", where: "menu_id IN (SELECT id FROM menus WHERE establishment_id = $1)" },
  { table: "menu_items", where: "section_id IN (SELECT s.id FROM menu_sections s JOIN menus m ON m.id = s.menu_id WHERE m.establishment_id = $1)" },
  { table: "recipes", where: "product_id IN (SELECT id FROM products WHERE establishment_id = $1)" },
  { table: "payment_method_configs", where: "establishment_id = $1" },
  { table: "order_counters", where: "establishment_id = $1" },
  // Clients de l'entreprise : seulement ceux de cet établissement (fidélité, commandes et réservations en cours)
  { table: "customers", where: `organization_id = $2 AND (id IN (SELECT customer_id FROM loyalty_accounts WHERE establishment_id = $1) OR id IN (SELECT customer_id FROM orders WHERE ${ORDERS}) OR id IN (SELECT customer_id FROM reservations WHERE establishment_id = $1 AND starts_at > now() - interval '1 day'))` },
  { table: "loyalty_accounts", where: "establishment_id = $1" },
  // Options Comptes clients et Marketing : les paiements « Sur compte » et par carte cadeau y renvoient,
  // et la caisse du boîtier en a besoin pour encaisser pendant une coupure
  { table: "customer_accounts", where: "establishment_id = $1" },
  { table: "account_invoices", where: "establishment_id = $1" },
  { table: "gift_cards", where: "establishment_id = $1" },
  { table: "employees", where: "establishment_id = $1" },
  { table: "shifts", where: "establishment_id = $1 AND starts_at > now() - interval '2 days'" },
  { table: "time_entries", where: "establishment_id = $1 AND at > now() - interval '2 days'" },
  { table: "reservations", where: "establishment_id = $1 AND starts_at > now() - interval '1 day'" },
  { table: "cash_sessions", where: `establishment_id = $1 AND (status = 'OPEN' OR opened_at > now() - interval '2 days' OR id IN (SELECT cash_session_id FROM payments WHERE order_id IN (${ORDER_IDS})))` },
  { table: "orders", where: ORDERS },
  { table: "courses", where: `order_id IN (${ORDER_IDS})` },
  { table: "kitchen_tickets", where: `order_id IN (${ORDER_IDS})` },
  { table: "order_items", where: `order_id IN (${ORDER_IDS})` },
  { table: "order_item_modifiers", where: `order_item_id IN (SELECT i.id FROM order_items i WHERE i.order_id IN (${ORDER_IDS}))` },
  { table: "payments", where: `order_id IN (${ORDER_IDS})` },
  { table: "refunds", where: `payment_id IN (SELECT p.id FROM payments p WHERE p.order_id IN (${ORDER_IDS}))` },
  {
    table: "cash_movements", where: `cash_session_id IN (SELECT id FROM cash_sessions WHERE establishment_id = $1 AND (status = 'OPEN' OR opened_at > now() - interval '2 days'))`,
    set: { payment_id: `CASE WHEN t.payment_id IN (SELECT id FROM payments WHERE order_id IN (${ORDER_IDS})) THEN t.payment_id END`, order_id: `CASE WHEN t.order_id IN (${ORDER_IDS}) THEN t.order_id END` },
  },
  { table: "table_service_steps", where: `order_id IN (${ORDER_IDS})` },
  { table: "service_reminders", where: `order_id IN (${ORDER_IDS})` },
];

export type BoxSnapshot = {
  format: 1;
  /** Dernière migration appliquée : le boîtier refuse une copie d'un schéma différent du sien (mise à jour nécessaire) */
  schema: string;
  generatedAt: string;
  /** Version de l'application du cloud : le boîtier se met à jour quand elle change */
  release?: string;
  establishmentId: string;
  organizationId: string;
  tables: Record<string, unknown[]>;
};

const ident = (t: string) => {
  if (!/^[a-z_]+$/.test(t)) throw new Error(`Table invalide : ${t}`);
  return `"${t}"`;
};

export async function schemaVersion(db: PrismaClient) {
  const rows = await db.$queryRawUnsafe<{ migration_name: string }[]>(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`);
  return rows[0]?.migration_name ?? "none";
}

/** Copie d'un établissement, prête à être envoyée au boîtier. */
export async function exportSnapshot(db: PrismaClient, establishmentId: string): Promise<BoxSnapshot> {
  const est = await db.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { organizationId: true } });
  const tables: Record<string, unknown[]> = {};
  await db.$transaction(async (tx) => {
    // Une seule vue cohérente de la base pour toutes les tables
    await tx.$executeRawUnsafe(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    for (const { table, where, set } of BOX_TABLES) {
      const row = set ? `to_jsonb(t) || jsonb_build_object(${Object.entries(set).map(([col, expr]) => `'${col}', ${expr}`).join(", ")})` : "to_jsonb(t)";
      // Paramètres typés même quand la table ne s'en sert pas (sinon PostgreSQL refuse la requête)
      const rows = await tx.$queryRawUnsafe<{ rows: unknown[] }[]>(`SELECT coalesce(jsonb_agg(${row}), '[]'::jsonb) AS rows FROM ${ident(table)} t, (SELECT $1::uuid AS est, $2::uuid AS org) _p WHERE ${where}`, establishmentId, est.organizationId);
      tables[table] = rows[0]?.rows ?? [];
    }
  }, { timeout: 60_000 });
  return { format: 1, schema: await schemaVersion(db), generatedAt: new Date().toISOString(), release: BUILD_ID, establishmentId, organizationId: est.organizationId, tables };
}

/**
 * Boîtier : remplace sa base par la copie (une transaction : en cas d'erreur, rien ne change).
 * Les tables du service qui ne figurent pas dans la copie (journaux, idempotence…) sont vidées avec elles.
 */
export async function importSnapshot(db: PrismaClient, snap: BoxSnapshot) {
  if (snap.format !== 1) throw new Error("Format de copie inconnu");
  const local = await schemaVersion(db);
  if (local !== snap.schema) throw new Error(`Version différente du cloud (${snap.schema}, boîtier : ${local}) : mettez le boîtier à jour`);
  const counts: Record<string, number> = {};
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE ${BOX_TABLES.map((t) => ident(t.table)).join(", ")} CASCADE`);
    for (const { table } of BOX_TABLES) {
      const rows = snap.tables[table] ?? [];
      counts[table] = rows.length;
      if (!rows.length) continue;
      await tx.$executeRawUnsafe(`INSERT INTO ${ident(table)} SELECT * FROM json_populate_recordset(NULL::${ident(table)}, $1::json)`, JSON.stringify(rows));
    }
  }, { timeout: 120_000 });
  return counts;
}

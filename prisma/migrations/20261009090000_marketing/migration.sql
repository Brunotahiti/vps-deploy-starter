-- Marketing & cartes cadeaux (option payante « marketing ») : cartes cadeaux, campagnes, consentement des clients

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'GIFT_CARD';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "birthday" TEXT,
ADD COLUMN     "consent_at" TIMESTAMP(3),
ADD COLUMN     "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unsubscribed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "gift_card_id" UUID;

-- CreateTable
CREATE TABLE "gift_cards" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "initial_amount" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "buyer_name" TEXT,
    "recipient_name" TEXT,
    "message" TEXT,
    "expires_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sale_method" TEXT NOT NULL,
    "sale_reference" TEXT,
    "cash_session_id" UUID,
    "sold_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_campaigns" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_code_key" ON "gift_cards"("code");

-- CreateIndex
CREATE INDEX "gift_cards_establishment_id_created_at_idx" ON "gift_cards"("establishment_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_campaigns_establishment_id_created_at_idx" ON "marketing_campaigns"("establishment_id", "created_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_gift_card_id_fkey" FOREIGN KEY ("gift_card_id") REFERENCES "gift_cards"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Droits : vendre des cartes cadeaux (caisse) et gérer le marketing (campagnes, avis, cartes)
INSERT INTO "permissions" ("key", "group", "description") VALUES
  ('giftcards.sell', 'Marketing', 'Vendre une carte cadeau'),
  ('marketing.manage', 'Marketing', 'Gérer le marketing : campagnes, cartes cadeaux, avis clients')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", k.key FROM "roles" r
CROSS JOIN (VALUES ('giftcards.sell'), ('marketing.manage')) AS k(key)
WHERE r."is_system" AND r."key" IN ('admin', 'manager')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", 'giftcards.sell' FROM "roles" r
WHERE r."is_system" AND r."key" = 'cashier'
ON CONFLICT DO NOTHING;

-- Écrans en salle (option payante « screens ») : menu affiché sur une télévision, mis à jour tout seul

-- CreateTable
CREATE TABLE "screens" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "category_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "show_prices" BOOLEAN NOT NULL DEFAULT true,
    "hide_sold_out" BOOLEAN NOT NULL DEFAULT false,
    "show_images" BOOLEAN NOT NULL DEFAULT true,
    "rotate_seconds" INTEGER NOT NULL DEFAULT 12,
    "theme" TEXT NOT NULL DEFAULT 'lagoon',
    "headline" TEXT,
    "headline_text" TEXT,
    "headline_price" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "screens_token_key" ON "screens"("token");

-- CreateIndex
CREATE INDEX "screens_establishment_id_idx" ON "screens"("establishment_id");

-- AddForeignKey
ALTER TABLE "screens" ADD CONSTRAINT "screens_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


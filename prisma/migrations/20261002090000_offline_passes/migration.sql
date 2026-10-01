-- Connexion par PIN sans internet : clés dérivées des PIN et laissez-passer hors ligne par terminal
CREATE TABLE "offline_pin_keys" (
  "user_id" UUID NOT NULL,
  "establishment_id" UUID NOT NULL,
  "key" BYTEA NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "offline_pin_keys_pkey" PRIMARY KEY ("user_id", "establishment_id")
);
ALTER TABLE "offline_pin_keys" ADD CONSTRAINT "offline_pin_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offline_pin_keys" ADD CONSTRAINT "offline_pin_keys_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "offline_passes" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "establishment_id" UUID NOT NULL,
  "terminal_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "offline_passes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "offline_passes_token_hash_key" ON "offline_passes"("token_hash");
CREATE INDEX "offline_passes_user_id_terminal_id_idx" ON "offline_passes"("user_id", "terminal_id");
ALTER TABLE "offline_passes" ADD CONSTRAINT "offline_passes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offline_passes" ADD CONSTRAINT "offline_passes_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offline_passes" ADD CONSTRAINT "offline_passes_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

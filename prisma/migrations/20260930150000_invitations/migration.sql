-- Invitations par e-mail : jeton, expiration, date d'envoi
ALTER TABLE "users" ADD COLUMN "invite_token" TEXT;
ALTER TABLE "users" ADD COLUMN "invite_expires_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "invited_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "users_invite_token_key" ON "users"("invite_token");

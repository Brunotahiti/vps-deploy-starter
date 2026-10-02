-- Secrets de la plateforme (compte Let's Encrypt des boîtiers de secours)
CREATE TABLE "platform_secrets" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_secrets_pkey" PRIMARY KEY ("key")
);

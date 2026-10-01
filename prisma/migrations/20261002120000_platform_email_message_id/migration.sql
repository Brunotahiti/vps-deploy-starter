-- Trace des e-mails plateforme : référence de l'envoi chez le prestataire SMTP (Brevo)
ALTER TABLE "platform_emails" ADD COLUMN "message_id" TEXT;

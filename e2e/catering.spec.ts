import { test, expect } from "@playwright/test";

/** Traiteur : événement créé, devis composé, accepté en ligne par le client, acompte, facture. */
test("événement traiteur : devis, acceptation en ligne, acompte, facture", async ({ page, context }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  context.on("page", (p) => { if (p.url().includes("/pdf")) p.close().catch(() => null); }); // PDF ouvert dans un onglet

  await page.goto("/admin/catering");
  await expect(page.getByTestId("catering-calendar")).toBeVisible();
  await page.getByTestId("event-new").click();
  await page.getByLabel("Nom de l'événement").fill("Baptême e2e");
  await page.getByLabel("Nombre de personnes").fill("20");
  const day = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Date de l'événement").fill(day);
  await page.getByLabel("Nom du client").fill("Famille Test");
  await page.getByTestId("event-save").click();
  await page.waitForURL(/\/admin\/catering\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;

  // Devis : un plat de la carte (20 personnes) et une ligne libre
  const pick = page.getByLabel("Ajouter un plat de la carte");
  await pick.selectOption({ index: 1 });
  await page.getByTestId("line-add").click();
  await page.getByLabel("Désignation ligne 2").fill("Location de vaisselle");
  await page.getByLabel("Prix unitaire TTC ligne 2").fill("15000");
  await page.getByRole("button", { name: "30 %" }).click();
  await page.getByTestId("quote-save").click();
  await expect(page.getByTestId("quote-save")).toBeDisabled();
  const ev = (await (await page.request.get(`/api/catering/${id}`)).json()).data;
  expect(ev.lines).toHaveLength(2);
  expect(ev.depositAmount).toBeGreaterThan(0);

  await page.getByTestId("quote-handed").click();
  await expect(page.getByTestId("event-status")).toHaveAttribute("aria-label", "Devis envoyé");

  // Le client ouvre le lien et accepte
  const client = await context.newPage();
  await client.goto(`/devis/${ev.publicToken}`);
  await expect(client.getByTestId("quote-total")).toBeVisible();
  await client.getByLabel("Votre nom").fill("Hina Test");
  await client.getByLabel("J'accepte le devis").check();
  await client.getByTestId("quote-accept-public").click();
  await expect(client.getByRole("heading", { name: "Devis accepté" })).toBeVisible();
  await client.close();

  await page.reload();
  await expect(page.getByTestId("event-status")).toHaveAttribute("aria-label", "Confirmé");
  await expect(page.getByText("Accepté en ligne par Hina Test")).toBeVisible();

  // Acompte par virement, puis facture
  await page.getByTestId("event-pay").click();
  await page.getByLabel("Référence du paiement").fill("VIR e2e");
  await page.getByTestId("payment-save").click();
  await expect(page.getByTestId("event-paid")).not.toHaveText(/^0/);
  await page.getByTestId("event-invoice").click();
  await page.getByTestId("invoice-confirm").click();
  await expect(page.getByTestId("event-status")).toHaveAttribute("aria-label", "Facturé");
  await expect(page.getByTestId("invoice-pdf")).toContainText(/FT-\d{4}-\d{4}/);
  const pdf = await page.request.get(`/api/catering/${id}/pdf?doc=invoice`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});

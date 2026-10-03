import { test, expect } from "@playwright/test";

/** Option Bar : ardoise au comptoir, happy hour appliqué, verre offert, clôture ; cave du bar et rapport. */
test("bar : ardoise, happy hour, verre offert, cave et rapport", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "manager@manaresto.pf", password: "demo1234" } });
  const before = (await (await page.request.get("/api/bar/settings")).json()).data;
  // Happy hour sur le seul Mojito : les autres tests (eau, sodas…) ne sont pas touchés
  const cocktails = (await (await page.request.get("/api/bar/cocktails")).json()).data as { id: string; name: string }[];
  const mojito = cocktails.find((c) => c.name === "Mojito")!;
  // Happy hour qui couvre l'heure locale actuelle (± 1 h)
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Pacific/Tahiti", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":").map(Number);
  const fmt = (x: number) => { const v = ((x % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`; };
  expect((await page.request.put("/api/bar/settings", { data: { happyHours: [{ id: "e2e", name: "Happy hour", days: [0, 1, 2, 3, 4, 5, 6], start: fmt(h * 60 + m - 60), end: fmt(h * 60 + m + 60), discountBps: 3000, categoryIds: [], productIds: [mojito.id], enabled: true }] } })).ok()).toBeTruthy();
  try {
    await page.goto("/pos/bar");
    if (await page.getByTestId("pending-later").count()) await page.getByTestId("pending-later").click();
    await expect(page.getByTestId("happy-hour-live")).toBeVisible();
    const name = `Client e2e ${Date.now().toString().slice(-4)}`;
    await page.getByTestId("tab-new").click();
    await page.getByTestId("tab-name").fill(name);
    await page.getByTestId("tab-open").click();
    await page.waitForURL(/\/pos\/order\//);
    await expect(page.getByTestId("ticket").getByText(`Ardoise · ${name}`)).toBeVisible();
    await page.getByRole("button", { name: "Boissons" }).click();
    await page.getByRole("button", { name: "Ajouter Mojito" }).click();
    await expect(page.getByTestId("ticket").getByTestId("line-discount")).toHaveText("Happy hour −30 %");
    await expect(page.getByTestId("ticket").getByText("910 F").first()).toBeVisible();

    // Verre offert (motif tracé) puis clôture sans encaissement
    await page.getByTestId("ticket").getByText("Mojito").first().click();
    await page.getByTestId("offer-box").getByRole("button", { name: "Anniversaire" }).click();
    await page.getByTestId("offer-send").click();
    await expect(page.getByTestId("offer-box")).toContainText("Offert : Anniversaire");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ticket").getByTestId("line-discount")).toHaveText("Offert : Anniversaire");
    await page.getByTestId("close-offered").click();
    await expect(page.getByRole("button", { name: "Retour au bar" })).toBeVisible();

    // L'ardoise n'est plus ouverte
    await page.getByRole("button", { name: "Retour au bar" }).click();
    await expect(page.getByTestId("tab-card").filter({ hasText: name })).toHaveCount(0);

    // Gestion → Bar : une bouteille ajoutée à la cave, puis reçue
    await page.goto("/admin/bar");
    await page.getByRole("tab", { name: "Cave du bar" }).click();
    const bottle = `Rhum e2e ${Date.now().toString().slice(-4)}`;
    await page.getByTestId("bottle-add").click();
    await page.getByTestId("bottle-name").fill(bottle);
    await page.getByTestId("bottle-save").click();
    const row = page.getByTestId("bottle-row").filter({ hasText: bottle });
    await expect(row).toContainText("Vide");
    await row.getByRole("button", { name: `Réception : ${bottle}` }).click();
    await page.getByTestId("receive-save").click();
    await expect(row).toContainText("6 bout.");

    // Rapport du bar : l'offert y figure
    await page.getByRole("tab", { name: "Rapport du bar" }).click();
    await expect(page.getByTestId("kpi-offered")).toBeVisible();
    await expect(page.getByText("Anniversaire").first()).toBeVisible();
  } finally {
    await page.request.put("/api/bar/settings", { data: { happyHours: before.happyHours } });
  }
});

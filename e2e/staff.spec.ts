import { test, expect } from "@playwright/test";

/** Phase 5 : pointeuse (PIN employé), synthèse des heures et exports. */
test("pointage : arrivée, pause, reprise, départ depuis la caisse", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  // L'extra « Tehani » a le PIN 7777 ; on la remet hors service si besoin
  const st = await (await page.request.post("/api/staff/clock/identify", { data: { pin: "7777" } })).json();
  if (st.data.state !== "OUT") await page.request.post("/api/staff/clock", { data: { pin: "7777", kind: "CLOCK_OUT" } });

  await page.goto("/pos/clock");
  for (const d of "7777") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByText("Tehani Extra")).toBeVisible();
  await page.getByRole("button", { name: /Arrivée/ }).click();
  await expect(page.getByText(/Arrivée enregistrée/)).toBeVisible();
  for (const d of "7777") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByText(/En service/)).toBeVisible();
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.getByText(/Pause enregistré/)).toBeVisible();
  for (const d of "7777") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "Valider" }).click();
  await page.getByRole("button", { name: /Départ/ }).click();
  await expect(page.getByText(/Départ enregistré/)).toBeVisible();
  const after = await (await page.request.post("/api/staff/clock/identify", { data: { pin: "7777" } })).json();
  expect(after.data.state).toBe("OUT");

  // Synthèse et exports
  await page.goto("/admin/staff/summary");
  await expect(page.getByText("Tehani Extra")).toBeVisible();
  const csv = await page.request.get("/api/reports/export?type=staff&format=csv&from=2026-01-01&to=2026-12-31");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const xlsx = await page.request.get("/api/reports/export?type=period&format=xlsx&from=2026-01-01&to=2026-12-31");
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  const pdf = await page.request.get("/api/reports/export?type=products&format=pdf&from=2026-01-01&to=2026-12-31");
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
});

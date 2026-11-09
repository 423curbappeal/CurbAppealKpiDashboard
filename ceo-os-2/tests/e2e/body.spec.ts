import { expect, test } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;

test("body map, recovery suggestion and Apple Health import", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Fit Tester");
  await page.getByLabel("Email").fill(`fit.${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Welcome to CEO OS")).toBeVisible();

  // No history yet: an honest starting suggestion, not an invented plan.
  await expect(page.getByText("Start with Push")).toBeVisible();

  // Log Push → it becomes recovering and something else is suggested.
  await page.getByRole("button", { name: "Log Push workout" }).click();
  await expect(page.getByText("Push logged")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Strength done today")).toBeVisible();

  // Body page: muscle list reflects the session.
  await page.goto("/you/body");
  await expect(page.getByRole("heading", { name: "Body" })).toBeVisible();
  await expect(page.getByText("Chest", { exact: true })).toBeVisible();

  // Create a sync token in the app and use it exactly as the iPhone exporter would.
  await page.getByRole("button", { name: "Create sync token" }).click();
  const token = (await page.locator("code").filter({ hasText: /^ceo_/ }).innerText()).trim();
  expect(token).toMatch(/^ceo_/);
  if (shots) await page.screenshot({ path: `${shots}/body-page.png`, fullPage: true });

  const start = new Date(Date.now() - 26 * 3600_000);
  const end = new Date(start.getTime() + 48 * 60_000);
  const res = await page.request.post("/api/ingest/apple-health", {
    headers: { authorization: `Bearer ${token}` },
    data: { data: { workouts: [{ id: "watch-1", name: "Traditional Strength Training", start: start.toISOString(), end: end.toISOString() }] } },
  });
  expect(await res.json()).toEqual({ imported: 1, duplicates: 0, skipped: 0 });

  // Home asks what was trained; one tap tags it.
  await page.goto("/");
  await expect(page.getByText("What did you train?")).toBeVisible();
  await expect(page.getByText(/Traditional Strength Training · 48 min/)).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/home-training.png`, fullPage: true });
  await page.getByRole("button", { name: "Pull", exact: true }).first().click();
  await expect(page.getByText("Saved as Pull")).toBeVisible();
  await page.reload();
  await expect(page.getByText("What did you train?")).toHaveCount(0);

  // A wrong token is rejected.
  const bad = await page.request.post("/api/ingest/apple-health", { headers: { authorization: "Bearer ceo_wrong_wrong_wrong_wrong_wrong_wrong_wrong" }, data: {} });
  expect(bad.status()).toBe(401);
});

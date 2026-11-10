import { expect, test, type Page } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;
const snap = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

test("Depop goal, faster logging, one-tap sold, shortcut", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Ro Tester");
  await page.getByLabel("Email").fill(`ro.up.${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Welcome to CEO OS")).toBeVisible();

  // Home-screen shortcut opens the Add sheet directly.
  await page.goto("/depop?add=1");
  await expect(page.getByRole("dialog", { name: "New item" })).toBeVisible();

  // A link that isn't a Depop listing is refused inline, and the form stays usable.
  await page.getByLabel("Depop listing link").fill("https://example.com/item/1");
  await page.getByRole("button", { name: "Fill in" }).click();
  await expect(page.getByText("That doesn't look like a Depop listing link")).toBeVisible();

  // Save and add another keeps the sheet open, clears the form, remembers the category.
  await page.getByRole("textbox", { name: "Item" }).fill("Band tee");
  await page.getByRole("button", { name: "Tops", exact: true }).click();
  await page.getByLabel("You paid").fill("3");
  await page.getByLabel("List price").fill("28");
  await page.getByRole("button", { name: "Save and add another" }).click();
  await expect(page.getByText("1 added. Next item.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Item" })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Tops", exact: true })).toHaveAttribute("aria-pressed", "true");
  await snap(page, "up-01-add-another");

  await page.getByRole("textbox", { name: "Item" }).fill("Carhartt beanie");
  await page.getByRole("button", { name: "Accessories", exact: true }).click();
  await page.getByLabel("You paid").fill("2");
  await page.getByLabel("List price").fill("20");
  await page.getByRole("button", { name: "Add listing" }).click();
  await expect(page.getByText("Active · 2")).toBeVisible();
  await expect(page).toHaveURL(/\/depop$/);

  // Next time, the last category is preselected.
  await page.getByRole("button", { name: "Add a Depop item" }).click();
  await expect(page.getByRole("button", { name: "Accessories", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // One-tap sold at list price.
  await page.getByRole("button", { name: /Band tee/ }).click();
  await page.getByRole("button", { name: /Sold at \$28\.00 today/ }).click();
  await expect(page.getByText("Marked sold")).toBeVisible();
  await expect(page.getByText("Sold · 1")).toBeVisible();

  // Depop profit goal on Growth, auto-tracked.
  await page.getByRole("link", { name: "Growth" }).click();
  await page.getByRole("button", { name: "Add" }).first().click();
  await page.getByRole("button", { name: /Depop profit/ }).click();
  await page.getByRole("radio", { name: "Month" }).click();
  await page.getByLabel(/Target per month/).fill("100");
  await page.getByRole("button", { name: "Add goal" }).click();
  // 28 − 3 − (0.92 + 0.45) = 23.63 → $24 of $100
  await expect(page.getByText("$24 of $100 this month")).toBeVisible();
  await expect(page.getByText("From your Depop sales (some fees estimated)")).toBeVisible();
  await snap(page, "up-02-growth-goal");

  // The goal also shows on the Shop screen.
  await page.getByRole("link", { name: "Shop" }).click();
  await expect(page.getByText("Depop profit")).toBeVisible();
  await expect(page.getByText(/of \$100 this month/)).toBeVisible();
  await snap(page, "up-03-shop-goal");

  // Install help on You (not installed in the test browser).
  await page.getByRole("link", { name: "You" }).click();
  await expect(page.getByText("Put CEO OS on your home screen")).toBeVisible();
});

test("app shell files are public and well-formed", async ({ request }) => {
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain("offline.html");
  const offline = await request.get("/offline.html");
  expect(offline.status()).toBe(200);
  expect(await offline.text()).toContain("You're offline");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toContain("/depop?add=1");
});

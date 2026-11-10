import { expect, test, type Page } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;
const snap = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

async function addListing(page: Page, o: { title: string; category: string; paid: string; list: string; listedOn?: string }) {
  await page.getByRole("button", { name: "Add a Depop item" }).click();
  await page.getByRole("textbox", { name: "Item" }).fill(o.title);
  await page.getByRole("button", { name: o.category, exact: true }).click();
  await page.getByLabel("You paid").fill(o.paid);
  await page.getByLabel("List price").fill(o.list);
  if (o.listedOn) await page.getByLabel("Listed on").fill(o.listedOn);
  await page.getByRole("button", { name: "Add listing" }).click();
  await expect(page.getByText("Listing added")).toBeVisible();
}

test("Depop: list → mark sold → KPIs → Home briefing → Growth", async ({ page }) => {
  const email = `ro.${Date.now()}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Ro Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Welcome to CEO OS")).toBeVisible();

  // Shop tab
  await page.getByRole("link", { name: "Shop" }).click();
  await expect(page.getByText("Log your first item")).toBeVisible();
  await snap(page, "depop-01-empty");

  await addListing(page, { title: "Vintage Carhartt jacket", category: "Outerwear", paid: "12", list: "65" });
  await addListing(page, { title: "Levi's 501", category: "Bottoms", paid: "8", list: "40", listedOn: "2026-08-01" });

  await expect(page.getByText("Active · 2")).toBeVisible();
  await expect(page.getByText(/listing has been up more than 60 days/)).toBeVisible();

  // Mark the jacket sold, with live profit preview (fees left blank → estimated)
  await page.getByRole("button", { name: /Vintage Carhartt jacket/ }).click();
  await page.getByRole("button", { name: /Mark sold/ }).click();
  await page.getByLabel("Sold for").fill("60");
  await page.getByLabel("Shipping you paid").fill("0");
  // 60 − 12 − (1.98 + 0.45) = 45.57
  await expect(page.getByText("$45.57")).toBeVisible();
  await snap(page, "depop-02-mark-sold");
  await page.getByRole("button", { name: "Mark sold", exact: true }).click();
  await expect(page.getByText("Marked sold")).toBeVisible();

  await expect(page.getByText("Active · 1")).toBeVisible();
  await expect(page.getByText("Sold · 1")).toBeVisible();
  await expect(page.getByText("some fees estimated")).toBeVisible();
  await snap(page, "depop-03-dashboard");

  // Sold tab shows the profit
  await page.getByRole("tab", { name: "Sold · 1" }).click();
  await expect(page.getByText("$45.57 profit")).toBeVisible();

  // Home briefing picks it up
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByText("Depop: 1 sale in the last 7 days, $46 profit (fees estimated). 1 listing active.")).toBeVisible();
  await expect(page.getByText(/1 Depop listing up more than 60 days/)).toBeVisible();
  await snap(page, "depop-04-home");

  // Growth card
  await page.getByRole("link", { name: "Growth" }).click();
  await expect(page.getByText("Depop shop")).toBeVisible();
  await expect(page.getByText("Profit, 30d")).toBeVisible();

  // Undo a removal
  await page.getByRole("link", { name: "Shop" }).click();
  await page.getByRole("button", { name: /Levi's 501/ }).click();
  await page.getByRole("button", { name: "Remove item" }).click();
  await expect(page.getByText("Item removed")).toBeVisible();
  await expect(page.getByText("Active · 0")).toBeVisible();
  await page.getByRole("status").filter({ hasText: "Item removed" }).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Active · 1")).toBeVisible();
});

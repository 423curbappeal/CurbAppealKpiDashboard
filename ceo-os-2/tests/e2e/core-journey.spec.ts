import { expect, test, type Page } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;
const snap = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

async function signUp(page: Page, name: string) {
  const email = `${name.toLowerCase().replace(/\s/g, ".")}.${Date.now()}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Welcome to CEO OS")).toBeVisible();
  return email;
}

async function capture(page: Page, text: string) {
  await page.getByRole("button", { name: "Capture a task" }).click();
  await page.getByLabel("What's on your mind?").fill(text);
  await page.getByRole("button", { name: "Interpret" }).click();
  await expect(page.getByText("Confirm")).toBeVisible();
}

test("core journey: capture → prioritize → execute → grow → review", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/sign-in/);
  await snap(page, "01-sign-in");

  const email = await signUp(page, "Alex Rivera");
  await snap(page, "02-home-empty");

  // Natural-language capture with confirmation
  await capture(page, "Remind me to call John tomorrow afternoon");
  await expect(page.getByLabel("Task title")).toHaveValue("Call John");
  await expect(page.getByText("Follow-up with John")).toBeVisible();
  await snap(page, "03-capture-confirm");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Added")).toBeVisible();

  await capture(page, "urgent: send the Miller estimate today");
  await expect(page.getByRole("button", { name: "High priority" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Business" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Add task" }).click();

  await capture(page, "Read Atomic Habits");
  await page.getByRole("button", { name: "Add task" }).click();

  // Home briefing derived from real data
  await page.reload();
  await expect(page.getByText("Briefing")).toBeVisible();
  await expect(page.getByText("1 task due today.")).toBeVisible();
  const top = page.locator("section", { has: page.getByText("Send the Miller estimate") });
  await expect(top.getByText("Due today")).toBeVisible();

  // One-tap workout with duplicate protection and undo
  await page.getByRole("button", { name: "Log Push workout" }).click();
  await expect(page.getByText("Push logged")).toBeVisible();
  await page.getByRole("button", { name: /Log Push workout/ }).click();
  await expect(page.getByText("Push already logged in the last 30 min")).toBeVisible();
  await snap(page, "04-home-briefing");

  // Execute: complete with undo
  await page.getByRole("link", { name: "Execute" }).click();
  await expect(page.getByRole("heading", { name: "Execute" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Complete Read Atomic Habits" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("checkbox", { name: "Complete Read Atomic Habits" })).toHaveAttribute("aria-checked", "false");

  // Follow-up action sheet: "I contacted them"
  await page.getByRole("button", { name: "Options for Call John" }).click();
  await expect(page.getByText("Snooze until tomorrow")).toBeVisible();
  await snap(page, "05-task-actions");
  await page.getByRole("button", { name: /I contacted them/ }).click();
  await expect(page.getByText("Logged as contacted")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Done today · 1")).toBeVisible();
  await snap(page, "06-execute");

  // Routines
  await page.getByRole("link", { name: "You" }).click();
  await page.getByRole("button", { name: "Add routine" }).click();
  await page.getByLabel("Routine name").fill("Plan tomorrow");
  await page.getByRole("button", { name: "Add routine" }).last().click();
  await expect(page.getByText("Routine added")).toBeVisible();
  await snap(page, "07-you");
  await page.getByRole("link", { name: "Home" }).click();
  const routine = page.getByRole("checkbox", { name: "Plan tomorrow" });
  await routine.click();
  await expect(routine).toHaveAttribute("aria-checked", "true");

  // Growth: auto-tracked goal + honest revenue goal
  await page.getByRole("link", { name: "Growth" }).click();
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: /Workouts per week/ }).click();
  await page.getByRole("button", { name: "Add goal" }).click();
  await expect(page.getByText("1 of 4 this week")).toBeVisible();
  await expect(page.getByText("Actual").first()).toBeVisible();
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: /Business revenue/ }).click();
  await page.getByRole("button", { name: "Add goal" }).click();
  await expect(page.getByText("No revenue source connected")).toBeVisible();
  await expect(page.getByText("Not tracked")).toBeVisible();
  await snap(page, "08-growth");

  // Weekly review
  await page.getByRole("link", { name: /Weekly review/ }).click();
  await expect(page.getByRole("heading", { name: "Weekly review" })).toBeVisible();
  await snap(page, "09-review");
  await page.getByRole("button", { name: "Approve & plan next week" }).click();
  await expect(page.getByRole("button", { name: "Week reviewed" })).toBeVisible();

  // Connections page is honest about configuration
  await page.goto("/you/connections");
  await expect(page.getByText("Google Calendar").first()).toBeVisible();
  await snap(page, "10-connections");

  // Data export
  const exported = await page.request.get("/api/export");
  expect(exported.ok()).toBeTruthy();
  const body = await exported.json();
  expect(body.account.email).toBe(email);
  expect(body.tasks.length).toBe(3);
  expect(JSON.stringify(body)).not.toMatch(/encrypted_?tokens|password/i);

  // A second user sees none of the first user's data
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signUp(otherPage, "Sam Other");
  await otherPage.goto("/execute");
  await expect(otherPage.getByText("Nothing open")).toBeVisible();
  const otherExport = await (await otherPage.request.get("/api/export")).json();
  expect(otherExport.tasks).toEqual([]);
  await other.close();
});

test("unauthenticated API access is rejected", async ({ request }) => {
  const res = await request.get("/api/export", { maxRedirects: 0 });
  expect([307, 308, 401]).toContain(res.status());
  const cron = await request.post("/api/cron/sync");
  expect(cron.status()).toBe(401);
});

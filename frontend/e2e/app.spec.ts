import { expect, Page, test } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.fill("input[type=email]", "admin@example.com");
  await page.fill("input[type=password]", "admin");
  await page.click("button[type=submit]");
  await expect(page.getByRole("grid", { name: "Load timeline" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("S1: log in, expand a team member and enter load from the keyboard", async ({ page }) => {
  await login(page);
  await page.getByTitle("Expand by project").first().click();

  const cells = page.getByRole("gridcell");
  await expect(cells.first()).toBeVisible();
  await cells.first().click();
  await page.keyboard.press("1");
  await expect(cells.first()).toHaveText("█");
  await expect(cells.first()).toHaveAccessibleName("Full day");
  await expect(page.getByText("Saved")).toBeVisible();

  // category picker: Enter opens it, choosing sets the category
  await cells.first().click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "Load category" })).toBeVisible();
  await page.getByRole("option", { name: /Half day/ }).click();
  await expect(cells.first()).toHaveText("▄");

  // clear with zero
  await cells.first().click();
  await page.keyboard.press("0");
  await expect(cells.first()).toHaveText(/^$|⚠/);
});

test("S2: the “Enough people?” panel answers with a verdict and candidates", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Enough people?" }).click();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText(/^Enough$|^Not enough/)).toBeVisible();
  await expect(page.getByText(/free of .* required/)).toBeVisible();
});

test("S3: closing a week creates a snapshot and can be reopened", async ({ page }) => {
  await login(page);
  const closeBtn = page.getByRole("button", { name: /Close week/ });
  await expect(closeBtn).toBeVisible();
  await closeBtn.click();
  await expect(page.getByText("Week closed, snapshot saved.")).toBeVisible();

  const undoBtn = page.getByRole("button", { name: "Reopen week" });
  await expect(undoBtn).toBeVisible();
  await undoBtn.click();
  await expect(page.getByRole("button", { name: /Close week/ })).toBeVisible();
});

test("Iteration 2: sign-up, own workspace, default role", async ({ page, context }) => {
  // the landing page is available without login
  await page.goto("/");
  await expect(page.getByText("Who is working on what")).toBeVisible();

  // sign up a new account
  await page.getByRole("link", { name: "Create one" }).click();
  await page.getByLabel(/First name/).first().fill("Eve");
  await page.getByLabel(/Last name/).fill("Tester");
  await page.fill("input[type=email]", `eva-${Date.now()}@example.com`);
  await page.fill("input[type=password]", "password-123");
  await page.getByRole("button", { name: "Create account" }).click();

  // no access yet — the workspaces page with the create form
  await expect(page.getByText("You have no access yet")).toBeVisible();
  await page.getByPlaceholder("ML Platform team").fill("Test team");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/test-team\//);
  await expect(page.getByText("The workspace has no team members yet")).toBeVisible();
});

test("S4: a read-only link works and dies after revocation", async ({ page, context }) => {
  await login(page);
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("button", { name: "Create link" }).click();

  const urlText = await page.locator(".break-all").first().textContent();
  expect(urlText).toBeTruthy();
  const shareUrl = urlText!.trim();

  const viewer = await context.newPage();
  await viewer.goto(shareUrl);
  await expect(viewer.getByText("Read only")).toBeVisible();
  // the grid is there, but no editing buttons
  await expect(viewer.getByRole("grid", { name: "Load timeline" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Enough people?" })).toHaveCount(0);

  await page.getByRole("button", { name: "Revoke" }).first().click();
  // revocation goes through the styled confirmation dialog
  await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await viewer.reload();
  await expect(viewer.getByText("This link is no longer valid")).toBeVisible();
});

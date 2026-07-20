import { expect, Page, test } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.fill("input[type=email]", "admin@example.com");
  await page.fill("input[type=password]", "admin");
  await page.click("button[type=submit]");
  await expect(page.getByRole("grid", { name: "Таймлайн загрузки" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("S1: логин, разворот сотрудника и ввод загрузки с клавиатуры", async ({ page }) => {
  await login(page);
  await page.getByTitle("Развернуть по проектам").first().click();

  const cells = page.getByRole("gridcell");
  await expect(cells.first()).toBeVisible();
  await cells.first().click();
  await page.keyboard.press("1");
  await expect(cells.first()).toHaveText(/1/);
  await expect(page.getByText("Сохранено")).toBeVisible();

  // очистка нулём
  await page.keyboard.press("0");
  await expect(cells.first()).toHaveText(/^$|⚠/);
});

test("S2: панель «Хватит ли людей?» отвечает вердиктом и кандидатами", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Хватит ли людей?" }).click();
  await page.getByRole("button", { name: "Проверить" }).click();
  await expect(page.getByText(/Хватает|Не хватает/)).toBeVisible();
  await expect(page.getByText(/Свободно .* из требуемых/)).toBeVisible();
});

test("S3: закрытие недели создаёт снимок и откатывается", async ({ page }) => {
  await login(page);
  const closeBtn = page.getByRole("button", { name: /Закрыть неделю/ });
  await expect(closeBtn).toBeVisible();
  await closeBtn.click();
  await expect(page.getByText("Неделя закрыта, снимок сохранён.")).toBeVisible();

  const undoBtn = page.getByRole("button", { name: "Откатить закрытие" });
  await expect(undoBtn).toBeVisible();
  await undoBtn.click();
  await expect(page.getByRole("button", { name: /Закрыть неделю/ })).toBeVisible();
});

test("S4: read-only ссылка работает и умирает после отзыва", async ({ page, context }) => {
  await login(page);
  await page.getByRole("button", { name: "Поделиться" }).click();
  await page.getByRole("button", { name: "Создать ссылку" }).click();

  const urlText = await page.locator(".break-all").first().textContent();
  expect(urlText).toBeTruthy();
  const shareUrl = urlText!.trim();

  const viewer = await context.newPage();
  await viewer.goto(shareUrl);
  await expect(viewer.getByText("только чтение")).toBeVisible();
  // сетка есть, а редактирующих кнопок нет
  await expect(viewer.getByRole("grid", { name: "Таймлайн загрузки" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Хватит ли людей?" })).toHaveCount(0);

  await page.getByRole("button", { name: "Отозвать" }).first().click();
  await viewer.reload();
  await expect(viewer.getByText("Ссылка не действует")).toBeVisible();
});

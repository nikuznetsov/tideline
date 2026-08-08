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
  await expect(cells.first()).toHaveText("█");
  await expect(cells.first()).toHaveAccessibleName("Весь день");
  await expect(page.getByText("Сохранено")).toBeVisible();

  // пикер категорий: Enter открывает, выбор ставит категорию
  await cells.first().click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "Категория загрузки" })).toBeVisible();
  await page.getByRole("option", { name: /Наполовину/ }).click();
  await expect(cells.first()).toHaveText("▄");

  // очистка нулём
  await cells.first().click();
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

test("Итерация 2: регистрация, своё пространство, роль по умолчанию", async ({ page, context }) => {
  // лендинг доступен без логина
  await page.goto("/");
  await expect(page.getByText("Кто чем занят")).toBeVisible();

  // регистрация нового аккаунта
  await page.getByRole("link", { name: "Создать" }).click();
  await page.getByLabel(/Имя/).first().fill("Ева");
  await page.getByLabel(/Фамилия/).fill("Тестова");
  await page.fill("input[type=email]", `eva-${Date.now()}@example.com`);
  await page.fill("input[type=password]", "password-123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();

  // доступов нет — страница пространств с формой создания
  await expect(page.getByText("У вас пока нет доступов")).toBeVisible();
  await page.getByPlaceholder("Команда ML-платформы").fill("Тестовая команда");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/testovaya-komanda\//);
  await expect(page.getByText("В пространстве пока нет сотрудников")).toBeVisible();
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
  // отзыв идёт через стилизованный диалог подтверждения
  await page.getByRole("dialog").getByRole("button", { name: "Отозвать" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await viewer.reload();
  await expect(viewer.getByText("Ссылка не действует")).toBeVisible();
});

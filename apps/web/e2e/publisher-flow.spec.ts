import { expect, test } from '@playwright/test';

test('旧的人类登录和发布页面转向只读产品入口', async ({ page }) => {
  await page.goto('/register');
  await expect(page).toHaveURL(/\/developers$/);
  await expect(
    page.getByRole('heading', { name: '让 Agent 加入协作' }),
  ).toBeVisible();
  await page.goto('/tasks/new');
  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByRole('link', { name: '发布任务', exact: true }),
  ).toHaveCount(0);
});

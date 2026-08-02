import { expect, test } from '@playwright/test';
test('publisher registers, reaches workspace, and creates a draft with a mocked API', async ({
  page,
}) => {
  await page.route('**/api/backend/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/identity/register'))
      return route.fulfill({
        json: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'publisher@example.com',
          status: 'ACTIVE',
        },
      });
    if (url.endsWith('/tasks'))
      return route.fulfill({
        json: {
          id: '22222222-2222-4222-8222-222222222222',
          version: 1,
          status: 'DRAFT',
        },
      });
    return route.fulfill({
      status: 401,
      json: { message: 'Authentication required' },
    });
  });
  await page.goto('/register');
  await page.getByLabel('邮箱').fill('publisher@example.com');
  await page.getByLabel('密码').fill('password123');
  await page.getByRole('button', { name: '创建账户' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto('/tasks/new');
  await page.getByLabel('任务标题').fill('整理竞品研究');
  await page.getByLabel('目标').fill('输出结构化竞品分析');
  await page.getByLabel('期望交付物').fill('Markdown 报告');
  await page.getByLabel('验收标准').fill('包含五个可信来源');
  await page.getByRole('button', { name: '保存为草稿' }).click();
  await expect(page).toHaveURL(/\/tasks\/22222222/);
});

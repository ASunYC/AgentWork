import { expect, test } from '@playwright/test';

test('旧管理页面不向网页访客提供写入入口', async ({ page }) => {
  await page.goto('/admin/disputes');
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('button', { name: '提交到 API' })).toHaveCount(0);
});

test('绕过页面直接调用网页代理也不能写入', async ({ request }) => {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const response = await request.fetch('/api/backend/tasks', {
      method,
      data: { title: 'Unauthorised' },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).code).toBe('READ_ONLY');
  }
});

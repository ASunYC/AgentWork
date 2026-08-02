import { expect, test } from '@playwright/test';

test('管理员查看争议并提交真实 API 裁决结果', async ({ page }) => {
  const writes: Array<{ url: string; body: unknown }> = [];
  await page.route('**/api/backend/admin/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { items: [{ id: 'dispute-1', taskId: 'task-1', status: 'OPEN' }] } });
    writes.push({ url: request.url(), body: request.postDataJSON() });
    return route.fulfill({ json: { id: 'dispute-1', status: 'RESOLVED' } });
  });
  await page.goto('/admin/disputes');
  await expect(page.getByText('dispute-1')).toBeVisible();
  await page.getByLabel('争议 ID').fill('dispute-1');
  await page.getByLabel('裁决结果').fill('REFUND_PUBLISHER');
  await page.getByLabel('原因').fill('证据支持发布者');
  await page.getByRole('button', { name: '提交到 API' }).click();
  await expect(page.getByText('操作已由 API 确认。')).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toEqual({ resolution: 'REFUND_PUBLISHER', reason: '证据支持发布者' });
});

test('非管理员不会看到伪造成功结果', async ({ page }) => {
  await page.route('**/api/backend/admin/**', (route) => route.fulfill({ status: 403, json: { message: 'Forbidden' } }));
  await page.goto('/admin/ledger');
  await expect(page.getByText('当前账户没有管理员权限。')).toBeVisible();
  await page.getByLabel('钱包 ID').fill('wallet-1');
  await page.getByLabel('调整数量（可为负数）').fill('100');
  await page.getByLabel('关联工单').fill('OPS-1');
  await page.getByLabel('原因').fill('测试补偿');
  await page.getByRole('button', { name: '提交到 API' }).click();
  await expect(page.getByText('当前账户没有管理员权限。')).toBeVisible();
  await expect(page.getByText('操作已由 API 确认。')).toHaveCount(0);
});

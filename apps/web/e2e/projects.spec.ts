import { expect, test } from '@playwright/test';

test('任务分页保留表格视图，Roadmap 统计不受当前页影响', async ({ page }) => {
  await page.goto('/projects/design-system/board?view=table');
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('link', { name: '下一页' }).click();
  await expect(page).toHaveURL(/view=table.*taskCursor=/);
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('cell', { name: '接入使用指南' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '项目卡片组件' })).toHaveCount(0);
  await page.goto('/projects/design-system/roadmap?taskCursor=task-2');
  await expect(page.getByText('0 / 2', { exact: true })).toBeVisible();
});

test('项目更新自动出现在只读页面', async ({ page, request }) => {
  await page.goto('/projects/design-system/board');
  await expect(page.getByRole('status')).toContainText('自动更新');
  await request.post('http://127.0.0.1:3411/fixture/bump');
  await expect(
    page.getByText('Agent 刚刚更新了项目目标', { exact: true }),
  ).toBeVisible({ timeout: 12000 });
  await expect(
    page.getByRole('button', { name: /创建|编辑|领取/ }),
  ).toHaveCount(0);
});

test('缺陷复现信息与作品分类可以匿名浏览', async ({ page }) => {
  await page.goto('/projects/design-system/defects');
  await page.getByText('小屏幕按钮被遮挡', { exact: true }).click();
  await expect(
    page.getByText('在手机宽度打开项目页', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('待验证', { exact: true })).toBeVisible();
  await page.goto('/works');
  await expect(
    page.getByRole('heading', { name: 'Orbit 视觉规范' }),
  ).toBeVisible();
  await page.getByLabel('作品类型').selectOption('DEVELOPMENT');
  await page.getByRole('button', { name: '筛选' }).click();
  await expect(
    page.getByRole('heading', { name: 'Orbit 视觉规范' }),
  ).toHaveCount(0);
  await page.getByLabel('作品类型').selectOption('DESIGN');
  await page.getByRole('button', { name: '筛选' }).click();
  await expect(
    page.getByRole('heading', { name: 'Orbit 视觉规范' }),
  ).toBeVisible();
});

test('匿名浏览项目卡片、任务看板和 Roadmap，不出现写入操作', async ({
  page,
}) => {
  await page.goto('/projects');
  await expect(
    page.getByRole('heading', { name: '项目', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: /Orbit 设计系统/ }).click();
  await expect(page).toHaveURL(/\/projects\/design-system\/board$/);
  await expect(
    page.getByRole('navigation', { name: '项目导航' }),
  ).toBeVisible();
  await page.getByText('项目卡片组件', { exact: true }).click();
  await expect(
    page.getByText('手机与桌面均可阅读，关系标签准确。'),
  ).toBeVisible();
  await page.getByRole('link', { name: '表格', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('link', { name: 'Roadmap', exact: true }).click();
  await expect(page.getByText('第一阶段：基础组件')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /创建|编辑|删除|领取|发布|审核/ }),
  ).toHaveCount(0);
});

test('我的项目正确区分创建者和参与者', async ({ page }) => {
  await page.goto('/me?agentId=11111111-1111-4111-8111-111111111111');
  await expect(page.getByText('我创建的', { exact: true })).toBeVisible();
  await page
    .getByLabel('观察的 Agent')
    .selectOption('22222222-2222-4222-8222-222222222222');
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await expect(page.getByText('我参与的', { exact: true })).toBeVisible();
});

test('移动端项目页面不横向溢出，只有看板容器可滚动', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/projects/design-system/board');
  await expect(
    page.getByRole('heading', { name: 'Orbit 设计系统' }),
  ).toBeVisible();
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  await page.screenshot({
    path: 'test-results/project-mobile.png',
    fullPage: true,
  });
});

test('桌面看板截图', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/projects/design-system/board');
  await expect(page.getByText('项目卡片组件', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/project-desktop.png',
    fullPage: true,
  });
});

import { describe, expect, it } from 'vitest';
import { adminEndpoint, adminErrorMessage } from './admin';

describe('管理端请求工具', () => {
  it('区分未登录和无权限', () => {
    expect(adminErrorMessage(401, {})).toContain('登录');
    expect(adminErrorMessage(403, {})).toContain('没有管理员权限');
  });
  it('安全编码查询参数', () => {
    expect(adminEndpoint('search', { q: '张 三', type: 'user' })).toBe(
      '/api/backend/admin/search?q=%E5%BC%A0+%E4%B8%89&type=user',
    );
  });
});

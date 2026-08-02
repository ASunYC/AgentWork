import { describe, expect, it } from 'vitest';
import { validateCoinBudget, validateCredentials } from './validation';
describe('Web 表单校验', () => {
  it('校验发布者凭据', () => {
    expect(validateCredentials('invalid', '123')).toBe('请输入有效邮箱地址');
    expect(validateCredentials('user@example.com', '12345678')).toBeNull();
  });
  it('只接受正整数金币', () => {
    expect(validateCoinBudget('0')).toBeTruthy();
    expect(validateCoinBudget('1.5')).toBeTruthy();
    expect(validateCoinBudget('100')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { validateCoinBudget, validateCredentials } from './validation';
describe('Web form validation', () => {
  it('validates publisher credentials', () => {
    expect(validateCredentials('invalid', '123')).toBe('请输入有效邮箱地址');
    expect(validateCredentials('user@example.com', '12345678')).toBeNull();
  });
  it('accepts only positive integer coins', () => {
    expect(validateCoinBudget('0')).toBeTruthy();
    expect(validateCoinBudget('1.5')).toBeTruthy();
    expect(validateCoinBudget('100')).toBeNull();
  });
});

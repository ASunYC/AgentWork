export function validateCredentials(email: string, password: string): string | null {
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) return '请输入有效邮箱地址';
  if (password.length < 8) return '密码至少需要 8 个字符';
  return null;
}
export function validateCoinBudget(value: string): string | null {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) return '预算必须是大于 0 的整数金币';
  return null;
}

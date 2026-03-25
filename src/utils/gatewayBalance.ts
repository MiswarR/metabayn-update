export function resolveGatewayBalanceAfter(payload: any, previousTokens: number): number | null {
  const balanceAfter = Number(payload?.app_balance_after ?? payload?.user_balance_after)
  if (Number.isFinite(balanceAfter)) {
    return Math.max(0, balanceAfter)
  }
  const deducted = Number(payload?.app_tokens_deducted ?? payload?.tokens_deducted)
  if (Number.isFinite(deducted) && deducted > 0) {
    return Math.max(0, previousTokens - deducted)
  }
  return null
}

export function formatTokenBalance(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return '0'
  return n.toLocaleString('id-ID')
}

import { describe, expect, it } from 'vitest'
import { formatTokenBalance, resolveGatewayBalanceAfter } from './gatewayBalance'

describe('resolveGatewayBalanceAfter', () => {
  it('menghasilkan 0 saat payload balance_after = 0', () => {
    const next = resolveGatewayBalanceAfter({ app_balance_after: 0 }, 25)
    expect(next).toBe(0)
  })

  it('menghasilkan 1 saat pemotongan satu token dari dua token', () => {
    const next = resolveGatewayBalanceAfter({ app_tokens_deducted: 1 }, 2)
    expect(next).toBe(1)
  })

  it('menghasilkan N saat payload balance_after disediakan', () => {
    const next = resolveGatewayBalanceAfter({ app_balance_after: 123.4 }, 500)
    expect(next).toBe(123.4)
  })

  it('menghasilkan null saat payload tidak punya data saldo', () => {
    const next = resolveGatewayBalanceAfter({}, 500)
    expect(next).toBeNull()
  })

  it('tetap cepat diproses di bawah 300ms', () => {
    const started = Date.now()
    let value = 0
    for (let i = 0; i < 10000; i++) {
      value = resolveGatewayBalanceAfter({ app_tokens_deducted: 0.1 }, 1000) || 0
    }
    const elapsed = Date.now() - started
    expect(value).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(300)
  })
})

describe('formatTokenBalance', () => {
  it('menghasilkan 0 saat value kosong atau invalid', () => {
    expect(formatTokenBalance(undefined)).toBe('0')
    expect(formatTokenBalance(null)).toBe('0')
    expect(formatTokenBalance('')).toBe('0')
    expect(formatTokenBalance('abc')).toBe('0')
    expect(formatTokenBalance(NaN)).toBe('0')
  })

  it('menghasilkan 0 saat value <= 0', () => {
    expect(formatTokenBalance(0)).toBe('0')
    expect(formatTokenBalance(-1)).toBe('0')
  })

  it('format angka dengan pemisah ribuan', () => {
    expect(formatTokenBalance(50000)).toBe('50.000')
    expect(formatTokenBalance('150000')).toBe('150.000')
  })
})

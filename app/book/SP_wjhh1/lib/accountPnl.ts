export interface PnlAmounts {
  realized: number;
  unrealized: number;
  total: number;
}

export type AccountPnlMatrix = Record<string, Record<string, PnlAmounts>>;

export interface AccountPnlRow {
  market: string;
  account: string;
  realized: number;
  unrealized: number;
}

export function buildAccountPnl(rows: AccountPnlRow[]) {
  const accountRawMatrix: AccountPnlMatrix = {};
  const accounts = new Set<string>();
  for (const row of rows) {
    if (!row.market) continue;
    const account = row.account || '未指定账户';
    accounts.add(account);
    accountRawMatrix[row.market] ??= {};
    const cell = accountRawMatrix[row.market][account] ??= { realized: 0, unrealized: 0, total: 0 };
    cell.realized += row.realized;
    cell.unrealized += row.unrealized;
    cell.total = cell.realized + cell.unrealized;
  }
  return { accounts: Array.from(accounts).sort(), accountRawMatrix };
}

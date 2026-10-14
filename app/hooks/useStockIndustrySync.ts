'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import { db, APP_ID } from '@/app/lib/stockService';
import { classifyStocks } from '@/app/lib/stockClassificationClient';
import {
  getStockSymbolKey,
  isMissingClassification,
  isSupportedClassificationMarket,
  toYahooSymbol,
} from '@/app/lib/stockClassification';

export type IndustrySyncItem = {
  symbol: string;
  market: string;
  name?: string;
};

type StockPoolItem = {
  symbol?: string;
  currency?: string;
  name?: string;
  sector_level_1?: string;
  sector_level_2?: string;
  [key: string]: any;
};

type UseStockIndustrySyncOptions = {
  items: IndustrySyncItem[];
  stockPool: StockPoolItem[];
  stockPoolLoading: boolean;
  refreshStockPool: () => Promise<void> | void;
  enabled?: boolean;
  sourceLabel?: string;
};

export function useStockIndustrySync({
  items,
  stockPool,
  stockPoolLoading,
  refreshStockPool,
  enabled = true,
  sourceLabel = '风控标的',
}: UseStockIndustrySyncOptions) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const autoSyncSignatureRef = useRef('');

  const missingItems = useMemo(() => {
    const stockMap = new Map<string, StockPoolItem>();
    stockPool.forEach((stock) => {
      if (!stock.symbol) return;
      stockMap.set(getStockSymbolKey(stock.symbol, stock.currency), stock);
    });

    const unique = new Map<string, IndustrySyncItem>();
    items.forEach((item) => {
      if (!item.symbol || !isSupportedClassificationMarket({ symbol: item.symbol, currency: item.market })) return;
      const key = getStockSymbolKey(item.symbol, item.market);
      const existing = stockMap.get(key);
      if (!existing || isMissingClassification(existing.sector_level_1) || isMissingClassification(existing.sector_level_2)) {
        unique.set(key, item);
      }
    });
    return Array.from(unique.values());
  }, [items, stockPool]);

  const syncIndustries = useCallback(async (silent = false) => {
    if (!enabled || stockPoolLoading || isSyncing) return;
    if (!missingItems.length) {
      if (!silent) setMessage(`${sourceLabel}行业已与系统股票池同步。`);
      return;
    }

    setIsSyncing(true);
    setMessage(`正在同步 ${missingItems.length} 只${sourceLabel}的行业分类...`);
    try {
      const results = await classifyStocks(missingItems.map((item) => ({
        symbol: item.symbol,
        currency: item.market,
        name: item.name,
      })));
      const resultMap = new Map(results.map((result) => [result.symbol.toUpperCase(), result]));
      const batch = writeBatch(db);
      let updateCount = 0;

      missingItems.forEach((item) => {
        const result = resultMap.get(item.symbol.toUpperCase());
        if (!result) return;
        const key = getStockSymbolKey(item.symbol, item.market);
        const existing = stockPool.find((stock) => (
          !!stock.symbol && getStockSymbolKey(stock.symbol, stock.currency) === key
        ));
        const needsLevel1 = !existing || isMissingClassification(existing.sector_level_1);
        const needsLevel2 = !existing || isMissingClassification(existing.sector_level_2);
        if (!needsLevel1 && !needsLevel2) return;

        const documentSymbol = String(existing?.symbol || toYahooSymbol(item.symbol, item.market)).trim().toUpperCase();
        const itemName = item.name && item.name !== item.symbol ? item.name : result.name;
        batch.set(doc(db, 'artifacts', APP_ID, 'public', 'data', 'stock_pool', documentSymbol), {
          symbol: documentSymbol,
          currency: existing?.currency || item.market || result.currency,
          name: existing?.name || itemName || result.name,
          ...(needsLevel1 ? { sector_level_1: result.sector_level_1 } : {}),
          ...(needsLevel2 ? { sector_level_2: result.sector_level_2 } : {}),
          classification_source: result.source,
          classification_confidence: result.confidence,
          classification_reason: result.reason,
          source_sector: result.source_sector,
          source_industry: result.source_industry,
          classifiedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        updateCount += 1;
      });

      if (updateCount > 0) await batch.commit();
      await refreshStockPool();
      setMessage(updateCount > 0
        ? `行业同步完成：已补齐 ${updateCount} 只${sourceLabel}并写回系统股票池。`
        : '已重新读取系统股票池，当前没有可写入的分类结果。');
    } catch (error) {
      console.error(`${sourceLabel} industry sync failed:`, error);
      setMessage('行业同步暂时未完成，请稍后手动重试；风控与持仓数据未受影响。');
    } finally {
      setIsSyncing(false);
    }
  }, [enabled, isSyncing, missingItems, refreshStockPool, sourceLabel, stockPool, stockPoolLoading]);

  useEffect(() => {
    if (!enabled || stockPoolLoading || isSyncing || !missingItems.length) return;
    const signature = missingItems
      .map((item) => `${getStockSymbolKey(item.symbol, item.market)}:${item.market}`)
      .sort()
      .join('|');
    if (!signature || autoSyncSignatureRef.current === signature) return;
    autoSyncSignatureRef.current = signature;
    void syncIndustries(true);
  }, [enabled, isSyncing, missingItems, stockPoolLoading, syncIndustries]);

  return {
    missingCount: missingItems.length,
    isSyncing,
    message,
    syncIndustries,
  };
}

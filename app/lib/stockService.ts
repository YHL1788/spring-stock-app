import { stockPoolData } from '@/app/data/stock_pool';

export interface StockInfo {
  symbol: string;
  name: string;
  sector_level_1: string;
  sector_level_2: string;
}

// 增加兜底：如果导入失败，默认为空数组
const stockPool: StockInfo[] = (stockPoolData || []) as StockInfo[];

/**
 * 获取完整的股票池列表
 */
export const getStockPool = (): StockInfo[] => {
  return stockPool;
};

/**
 * 检查某个代码是否在我们的股票池中
 */
export const isInStockPool = (symbol: string): boolean => {
  if (!symbol) return false;
  return stockPool.some(s => s.symbol && s.symbol.toUpperCase() === String(symbol).toUpperCase());
};

/**
 * 获取单个股票的详细信息
 */
export const getStockDetail = (symbol: string): StockInfo | undefined => {
  if (!symbol) return undefined;
  return stockPool.find(s => s.symbol && s.symbol.toUpperCase() === String(symbol).toUpperCase());
};

/**
 * 获取所有的一级行业分类列表 (用于筛选器)
 */
export const getLevel1Sectors = (): string[] => {
  if (!stockPool) return [];
  const sectors = new Set(stockPool.map(s => s.sector_level_1));
  return Array.from(sectors).filter(Boolean).sort();
};
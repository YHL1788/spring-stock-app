import { stockPoolData } from '@/app/data/stock_pool';

/**
 * 获取股票的基础数据 (包含财报、分红等信息)
 * 调用 /api/fundamentals
 * 如果请求失败或数据不完整，返回 null，不抛出异常
 */
export async function getStockFundamentals(symbol: string) {
  // 1. 修复作用域问题：将变量定义移到 try 块外部，确保 catch 块可以访问
  const cleanSymbol = symbol ? symbol.trim() : '';
  
  try {
    if (!cleanSymbol) return null;

    const response = await fetch(`/api/fundamentals?symbol=${cleanSymbol}`);
    
    if (!response.ok) {
      // 这里的错误可能是 404 或 API 限制，我们选择静默跳过
      return null;
    }

    const data = await response.json();
    
    // 简单校验数据有效性，必须包含 General 信息才算有效
    if (!data || !data.General) {
      return null;
    }

    return data;
  } catch (error) {
    // 网络错误等也静默处理，现在这里可以安全访问 cleanSymbol 了
    console.error(`Error in getStockFundamentals for ${cleanSymbol}:`, error);
    return null;
  }
}

/**
 * 从本地股票池获取单只股票的详细信息
 * 用于获取中文名称、行业分类等本地维护的静态数据
 * * 修改说明：显式声明返回类型为 any，以避免 TS 提示空对象缺少属性
 */
export function getStockDetail(symbol: string): any {
  if (!stockPoolData || !Array.isArray(stockPoolData)) return {};
  
  const target = symbol.trim().toUpperCase();
  
  // 在股票池中查找匹配的代码
  // 兼容 stock.symbol 或 stock.code 字段
  return stockPoolData.find((stock: any) => {
    const s = (stock.symbol || stock.code || '').toUpperCase();
    return s === target;
  }) || {};
}

/**
 * 获取所有可用的一级行业列表 (用于筛选)
 */
export function getLevel1Sectors(): string[] {
  if (!stockPoolData || !Array.isArray(stockPoolData)) return [];
  
  const sectors = new Set<string>();
  
  stockPoolData.forEach((stock: any) => {
    if (stock.sector_level_1) {
      sectors.add(stock.sector_level_1);
    }
  });
  
  return Array.from(sectors);
}
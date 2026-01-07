import { useState, useEffect } from 'react';
import { fetchStockPoolFromDB } from '@/app/lib/stockService';

export function useStockPool() {
  const [stocks, setStocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // 定义获取数据的逻辑
  const refreshStocks = async () => {
    setLoading(true);
    try {
      const data = await fetchStockPoolFromDB();
      
      // 简单排序：按代码字母顺序
      if (Array.isArray(data)) {
        data.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''));
        setStocks(data);
      } else {
        setStocks([]);
      }
      
      setError(null);
    } catch (err: any) {
      setError(err);
      console.error("Hook fetch error:", err);
      // 出错时设为空数组防止崩溃
      setStocks([]);
    } finally {
      setLoading(false);
    }
  };

  // 组件加载时自动执行一次
  useEffect(() => {
    refreshStocks();
  }, []);

  return { 
    stocks,      // 数据数组 (只读)
    loading,     // 是否正在加载
    error,       // 报错信息
    refresh: refreshStocks // 暴露给外部的手动刷新函数 (例如添加完股票后调用)
  };
}
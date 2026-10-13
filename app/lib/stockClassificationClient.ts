import type { StockClassificationInput, StockClassificationResult } from './stockClassification';

export async function classifyStocks(inputs: StockClassificationInput[]): Promise<StockClassificationResult[]> {
  if (!inputs.length) return [];
  const response = await fetch('/api/stock-classification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stocks: inputs }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`自动分类服务返回 ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.results) ? payload.results : [];
}

export async function classifyStock(input: StockClassificationInput): Promise<StockClassificationResult> {
  const results = await classifyStocks([input]);
  if (!results[0]) throw new Error('没有取得自动分类结果');
  return results[0];
}

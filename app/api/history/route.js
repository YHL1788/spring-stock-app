import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const fromDate = searchParams.get('from'); // 格式: YYYY-MM-DD
  const toDate = searchParams.get('to');     // 格式: YYYY-MM-DD

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  }

  try {
    // 1. 处理时间参数
    // 默认结束时间为现在
    const period2 = toDate 
      ? Math.floor(new Date(toDate).getTime() / 1000) 
      : Math.floor(Date.now() / 1000);
    
    // 默认开始时间为 1 年前 (如果未提供 from)
    const period1 = fromDate 
      ? Math.floor(new Date(fromDate).getTime() / 1000) 
      : period2 - 31536000; // 365 days in seconds

    // 2. 构建 Yahoo Finance Chart API URL
    // 使用 v8 chart 接口，这是获取历史数据最常用的端点
    const interval = '1d'; // 固定为日线数据
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?symbol=${symbol}&period1=${period1}&period2=${period2}&interval=${interval}`;

    // 3. 发起请求
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Yahoo API History error: ${response.statusText}`);
    }

    const json = await response.json();
    const result = json.chart.result?.[0];

    if (!result) {
      return NextResponse.json({ error: 'No data found' }, { status: 404 });
    }

    // 4. 数据解析与格式化
    // Yahoo 返回的数据是将 timestamp 和 open/close 等字段分开存储的数组
    const timestamps = result.timestamp || [];
    const quote = result.indicators.quote[0];
    const adjClose = result.indicators.adjclose?.[0].adjclose || [];

    const formattedData = timestamps.map((ts, index) => {
      return {
        date: new Date(ts * 1000).toISOString().split('T')[0], // YYYY-MM-DD
        timestamp: ts,
        open: quote.open[index],
        high: quote.high[index],
        low: quote.low[index],
        close: quote.close[index],
        volume: quote.volume[index],
        adjClose: adjClose[index] || quote.close[index] // 优先使用调整后收盘价
      };
    }).filter(item => item.close !== null && item.close !== undefined); // 过滤掉无效数据点(休市等情况可能产生null)

    // 5. 返回结果
    return NextResponse.json({
      symbol: result.meta.symbol,
      currency: result.meta.currency,
      data: formattedData
    });

  } catch (error) {
    console.error(`Failed to fetch history for ${symbol}:`, error);
    return NextResponse.json({ error: 'Failed to fetch history data' }, { status: 500 });
  }
}
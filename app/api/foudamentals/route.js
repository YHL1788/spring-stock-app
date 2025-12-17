import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  
  // 使用环境变量中的 Key，如果没有则回退到 demo (demo 只能查 AAPL.US, VTI.US 等)
  const apiToken = process.env.NEXT_PUBLIC_FINANCIAL_API_KEY || 'demo';

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  }

  // EODHD Fundamentals Endpoint
  // 文档参考: https://eodhd.com/financial-apis/stock-etfs-fundamental-data-api/
  const url = `https://eodhd.com/api/fundamentals/${symbol}?api_token=${apiToken}`;

  try {
    // 设置适当的超时，避免长时间挂起
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时

    const res = await fetch(url, {
      next: { revalidate: 3600 }, // 缓存 1 小时
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!res.ok) {
      // 如果是 404 或其他错误，不要抛出严重异常导致崩溃，而是返回特定错误结构
      console.warn(`EOD API error for ${symbol}: ${res.status}`);
      return NextResponse.json({ error: 'Data not found or API error' }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(`Error fetching fundamentals for ${symbol}:`, error);
    return NextResponse.json({ error: 'Failed to fetch fundamental data' }, { status: 500 });
  }
}
import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  
  // category: 请求类型 ('calendar', 'fundamental', 'historical', etc.)
  const category = searchParams.get('category') || 'calendar';
  const apiKey = process.env.EOD_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: '服务端未配置 EOD_API_KEY' }, { status: 500 });
  }

  const BASE_URL = 'https://eodhd.com/api';
  let endpoint = '';
  // 基础查询参数，所有请求都带上 token 和 fmt
  let queryString = `api_token=${apiKey}&fmt=json`;

  // ★ 路由分发逻辑
  switch (category) {
    case 'calendar':
      // 1. 宏观经济日历
      // Docs: https://eodhd.com/api/economic-events
      endpoint = '/economic-events';
      if (searchParams.has('from')) queryString += `&from=${searchParams.get('from')}`;
      if (searchParams.has('to')) queryString += `&to=${searchParams.get('to')}`;
      const country = searchParams.get('country');
      if (country && country !== 'ALL') queryString += `&country=${country}`;
      break;

    case 'fundamental':
      // 2. 个股基本面数据 (包含财务、分红、拆股、主要持有者等海量数据)
      // Docs: https://eodhd.com/api/fundamentals/AAPL.US
      const symbol = searchParams.get('symbol');
      if (!symbol) {
        return NextResponse.json({ error: '获取基本面数据必须提供 symbol 参数' }, { status: 400 });
      }
      endpoint = `/fundamentals/${symbol}`;
      
      // 过滤字段 (可选)：EOD 基本面数据非常大，可以用 filter 只取一部分
      // 例如前端传 ?filter=Financials::Balance_Sheet::quarterly
      if (searchParams.has('filter')) {
        queryString += `&filter=${searchParams.get('filter')}`;
      }
      break;

    case 'historical':
      // 3. 历史股价数据 (如果未来 Yahoo 不稳定，可以用这个备用)
      // Docs: https://eodhd.com/api/eod/AAPL.US
      const histSymbol = searchParams.get('symbol');
      if (!histSymbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
      endpoint = `/eod/${histSymbol}`;
      if (searchParams.has('from')) queryString += `&from=${searchParams.get('from')}`;
      if (searchParams.has('to')) queryString += `&to=${searchParams.get('to')}`;
      if (searchParams.has('period')) queryString += `&period=${searchParams.get('period')}`; // d, w, m
      break;

    default:
      return NextResponse.json({ error: '无效的 category 参数' }, { status: 400 });
  }

  // 发起请求
  try {
    // 这里的 revalidate 可以根据 category 动态调整
    // 日历/历史数据可以缓存久一点(1小时)，基本面数据如果是盘中可能要短一点，但通常基本面一天一更即可
    const revalidateTime = 3600; 

    const res = await fetch(`${BASE_URL}${endpoint}?${queryString}`, { 
      next: { revalidate: revalidateTime } 
    });

    if (!res.ok) {
      throw new Error(`EOD API Error: ${res.statusText}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(`EOD Fetch Error [${category}]:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
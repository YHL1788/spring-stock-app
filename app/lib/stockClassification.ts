import { stockPoolData } from '@/app/data/stock_pool';

export type StockClassificationInput = {
  symbol: string;
  currency?: string;
  name?: string;
};

const supportedCurrencies = new Set(['USD', 'HKD', 'CNY', 'JPY']);

export type ExternalStockProfile = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
};

export type StockClassificationResult = {
  symbol: string;
  yahooSymbol: string;
  currency: string;
  name: string;
  sector_level_1: string;
  sector_level_2: string;
  source: 'sip_curated' | 'yahoo_finance' | 'fallback';
  confidence: number;
  source_sector: string;
  source_industry: string;
  reason: string;
};

const missingValues = new Set(['', '-', '未知', 'unknown', 'n/a', 'na', '待分类', '未分类']);

export const isMissingClassification = (value: unknown) => (
  missingValues.has(String(value ?? '').trim().toLowerCase())
);

export const getStockSymbolKey = (symbol: string, currency?: string) => {
  let upper = String(symbol || '').trim().toUpperCase();
  const normalizedCurrency = String(currency || '').trim().toUpperCase();
  if (upper.endsWith('.US')) return upper.slice(0, -3);
  if (upper.endsWith('.SH')) upper = `${upper.slice(0, -3)}.SS`;
  if (upper.endsWith('.JP')) upper = `${upper.slice(0, -3)}.T`;
  if (upper.endsWith('.HK')) {
    const base = upper.slice(0, -3);
    return /^\d+$/.test(base) ? `${Number(base)}.HK` : upper;
  }
  if (/\.((SS)|(SZ)|(BJ))$/.test(upper)) {
    const [base, suffix] = upper.split('.');
    return /^\d+$/.test(base) ? `${base.padStart(6, '0')}.${suffix}` : upper;
  }
  if (upper.endsWith('.T')) return upper;
  if (normalizedCurrency === 'CNY' || normalizedCurrency === 'JPY') {
    return toYahooSymbol(upper, normalizedCurrency);
  }
  return upper;
};

export const toYahooSymbol = (symbol: string, currency?: string) => {
  let upper = String(symbol || '').trim().toUpperCase();
  const normalizedCurrency = String(currency || '').trim().toUpperCase();
  if (upper.endsWith('.US')) return upper.slice(0, -3);
  if (upper.endsWith('.SH')) upper = `${upper.slice(0, -3)}.SS`;
  if (upper.endsWith('.JP')) upper = `${upper.slice(0, -3)}.T`;
  if (/\.((SS)|(SZ)|(BJ))$/.test(upper)) {
    const [base, suffix] = upper.split('.');
    return /^\d+$/.test(base) ? `${base.padStart(6, '0')}.${suffix}` : upper;
  }
  if (upper.endsWith('.T')) return upper;
  if (upper.endsWith('.HK') || normalizedCurrency === 'HKD') {
    const base = upper.replace(/\.HK$/, '');
    return /^\d+$/.test(base) ? `${base.padStart(4, '0')}.HK` : upper;
  }
  if (normalizedCurrency === 'CNY') {
    const base = upper.replace(/\.(CN|CH)$/, '');
    if (!/^\d+$/.test(base)) return upper;
    const padded = base.padStart(6, '0');
    if (/^[468]/.test(padded)) return `${padded}.${padded.startsWith('6') ? 'SS' : 'BJ'}`;
    if (/^[59]/.test(padded)) return `${padded}.SS`;
    return `${padded}.SZ`;
  }
  if (normalizedCurrency === 'JPY') {
    const base = upper.replace(/\.(JP|T)$/, '');
    return base ? `${base}.T` : upper;
  }
  return upper;
};

export const isSupportedClassificationMarket = (input: StockClassificationInput) => {
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const currency = String(input.currency || '').trim().toUpperCase();
  return supportedCurrencies.has(currency)
    || /\.(US|HK|SS|SH|SZ|BJ|T|JP)$/.test(symbol);
};

const curatedMap = new Map(stockPoolData.map((item) => [getStockSymbolKey(item.symbol), item]));

export const getCuratedClassification = (input: StockClassificationInput): StockClassificationResult | null => {
  const match = curatedMap.get(getStockSymbolKey(input.symbol));
  if (!match) return null;
  const yahooSymbol = toYahooSymbol(input.symbol, input.currency);
  return {
    symbol: String(input.symbol || '').trim().toUpperCase(),
    yahooSymbol,
    currency: String(input.currency || (yahooSymbol.endsWith('.HK') ? 'HKD' : 'USD')).toUpperCase(),
    name: input.name || match.name || input.symbol,
    sector_level_1: match.sector_level_1,
    sector_level_2: match.sector_level_2,
    source: 'sip_curated',
    confidence: 1,
    source_sector: '',
    source_industry: '',
    reason: '命中 SIP 现有人工分类样本',
  };
};

type SipCategory = { level1: string; level2: string; confidence: number; reason: string };

const matchesAny = (text: string, keywords: string[]) => keywords.some((keyword) => text.includes(keyword));

const classifyEtf = (text: string): SipCategory => {
  if (matchesAny(text, ['inverse', 'short', 'bear', '-1x', '-2x', '-3x'])) {
    return { level1: '指数', level2: '空头', confidence: 0.92, reason: '识别为反向/空头 ETF' };
  }
  if (matchesAny(text, ['dividend', 'income', 'yield'])) {
    return { level1: '指数', level2: '红利ETF', confidence: 0.9, reason: '识别为红利/收益型 ETF' };
  }
  return { level1: '指数', level2: '多头', confidence: 0.84, reason: '识别为指数或 ETF' };
};

const mapExternalIndustry = (profile: ExternalStockProfile, input: StockClassificationInput): SipCategory => {
  const quoteType = String(profile.quoteType || '').toLowerCase();
  const sector = String(profile.sector || '').toLowerCase();
  const industry = String(profile.industry || '').toLowerCase();
  const name = `${input.name || ''} ${profile.longname || ''} ${profile.shortname || ''}`.toLowerCase();
  const text = `${sector} ${industry} ${name}`;
  const isHongKong = toYahooSymbol(input.symbol, input.currency).endsWith('.HK');

  if (quoteType.includes('etf') || quoteType.includes('fund') || quoteType.includes('index')) return classifyEtf(text);
  if (matchesAny(text, ['crypto', 'bitcoin', 'blockchain', 'digital asset'])) return { level1: '金融', level2: '加密货币', confidence: 0.94, reason: '外部行业关键词：加密资产' };
  if (matchesAny(industry, ['semiconductor'])) return { level1: '科技', level2: '半导体', confidence: 0.96, reason: '外部行业：半导体' };
  if (matchesAny(text, ['quantum computing'])) return { level1: '科技', level2: '量子计算', confidence: 0.94, reason: '外部行业关键词：量子计算' };
  if (matchesAny(text, ['robot', 'automation'])) return { level1: '科技', level2: '机器人', confidence: 0.9, reason: '外部行业关键词：机器人/自动化' };
  if (matchesAny(text, ['space', 'satellite'])) return { level1: '科技', level2: '太空技术', confidence: 0.9, reason: '外部行业关键词：太空/卫星' };
  if (matchesAny(industry, ['consumer electronics', 'electronic components', 'computer hardware', 'communication equipment'])) return { level1: '科技', level2: '消费电子', confidence: 0.9, reason: '外部行业：电子设备/硬件' };
  if (matchesAny(industry, ['internet content', 'internet retail', 'electronic gaming']) && isHongKong) return { level1: '科技', level2: '中概互联', confidence: 0.88, reason: '港股互联网企业映射至 SIP 中概互联' };
  if (matchesAny(industry, ['software', 'information technology', 'internet content', 'data processing', 'cloud computing'])) return { level1: '科技', level2: 'AI应用', confidence: 0.84, reason: '外部行业：软件/互联网/数据服务' };
  if (matchesAny(sector, ['communication services']) || matchesAny(industry, ['telecom', 'advertising agencies', 'publishing'])) return { level1: '科技', level2: '信息服务', confidence: 0.76, reason: '外部行业：通信或信息服务' };

  if (matchesAny(industry, ['biotechnology', 'drug manufacturers', 'pharmaceutical'])) return { level1: '医药', level2: '创新药', confidence: 0.93, reason: '外部行业：生物科技/制药' };
  if (matchesAny(industry, ['diagnostics & research', 'medical instruments', 'medical devices'])) return { level1: '医药', level2: 'CXO', confidence: 0.82, reason: '外部行业：医药研发/器械' };
  if (matchesAny(industry, ['healthcare plans', 'medical care facilities', 'health information services'])) return { level1: '医药', level2: '医疗保险', confidence: 0.84, reason: '外部行业：医疗服务/健康保险' };
  if (matchesAny(text, ['neuro', 'brain'])) return { level1: '医药', level2: '脑科学', confidence: 0.82, reason: '公司名称或行业包含脑科学关键词' };

  if (matchesAny(industry, ['banks', 'insurance', 'credit services', 'mortgage finance'])) return { level1: '金融', level2: '银行保险', confidence: 0.92, reason: '外部行业：银行/保险/信贷' };
  if (matchesAny(industry, ['capital markets', 'financial exchanges', 'asset management'])) return { level1: '金融', level2: '券商交易所', confidence: 0.9, reason: '外部行业：资本市场/交易所/资管' };
  if (matchesAny(industry, ['financial conglomerates'])) return { level1: '金融', level2: '财团', confidence: 0.86, reason: '外部行业：综合金融集团' };

  if (matchesAny(industry, ['real estate services', 'property management'])) return { level1: '房地产', level2: '物业服务', confidence: 0.9, reason: '外部行业：物业服务' };
  if (matchesAny(sector, ['real estate']) || matchesAny(industry, ['reit', 'real estate'])) return { level1: '房地产', level2: '房屋租售', confidence: 0.86, reason: '外部行业：房地产/REIT' };

  if (matchesAny(industry, ['auto manufacturers', 'auto parts'])) return { level1: '工业', level2: '汽车及部件', confidence: 0.93, reason: '外部行业：汽车及零部件' };
  if (matchesAny(industry, ['aerospace & defense', 'specialty chemicals', 'chemicals'])) return { level1: '工业', level2: '化工军工', confidence: 0.84, reason: '外部行业：航空防务/化工' };
  if (matchesAny(industry, ['aluminum', 'copper', 'gold', 'silver', 'other industrial metals', 'steel'])) return { level1: '工业', level2: '有色金属', confidence: 0.9, reason: '外部行业：金属矿产' };
  if (matchesAny(sector, ['energy', 'basic materials']) || matchesAny(industry, ['oil & gas', 'thermal coal', 'uranium'])) return { level1: '工业', level2: '能源材料', confidence: 0.84, reason: '外部行业：能源/基础材料' };
  if (matchesAny(sector, ['utilities', 'industrials']) || matchesAny(industry, ['engineering & construction', 'infrastructure operations', 'electrical equipment'])) return { level1: '工业', level2: '基建电力', confidence: 0.68, reason: '外部行业：工业/公用事业/基建' };

  if (matchesAny(industry, ['internet retail', 'integrated freight & logistics'])) return { level1: '消费', level2: '电商物流', confidence: 0.9, reason: '外部行业：电商/物流' };
  if (matchesAny(industry, ['travel services', 'airlines', 'lodging', 'resorts & casinos', 'rental & leasing services'])) return { level1: '消费', level2: '出行服务', confidence: 0.88, reason: '外部行业：出行/旅游/酒店' };
  if (matchesAny(industry, ['apparel', 'footwear', 'luxury goods', 'leisure', 'entertainment', 'toys'])) return { level1: '消费', level2: '服饰潮玩', confidence: 0.86, reason: '外部行业：服饰/文娱/潮玩' };
  if (matchesAny(industry, ['restaurants', 'packaged foods', 'beverages', 'grocery stores', 'farm products'])) return { level1: '消费', level2: '餐饮食品', confidence: 0.9, reason: '外部行业：餐饮/食品/饮料' };
  if (matchesAny(industry, ['furnishings', 'household', 'home improvement'])) return { level1: '消费', level2: '家电', confidence: 0.84, reason: '外部行业：家居/家电' };
  if (matchesAny(text, ['baby', 'infant'])) return { level1: '消费', level2: '婴儿用品', confidence: 0.84, reason: '公司名称或行业包含婴儿用品关键词' };

  const sectorFallbacks: Record<string, [string, string]> = {
    technology: ['科技', 'AI应用'],
    'communication services': ['科技', isHongKong ? '中概互联' : '信息服务'],
    healthcare: ['医药', '创新药'],
    'financial services': ['金融', '银行保险'],
    'real estate': ['房地产', '房屋租售'],
    industrials: ['工业', '基建电力'],
    energy: ['工业', '能源材料'],
    'basic materials': ['工业', '能源材料'],
    utilities: ['工业', '基建电力'],
    'consumer cyclical': ['消费', '服饰潮玩'],
    'consumer defensive': ['消费', '餐饮食品'],
  };
  const fallback = sectorFallbacks[sector];
  if (fallback) return { level1: fallback[0], level2: fallback[1], confidence: 0.58, reason: `按外部一级行业 ${profile.sector} 兜底映射` };
  return { level1: '其它', level2: '信息服务', confidence: 0.32, reason: '外部行业资料不足，使用低置信度兜底分类' };
};

export const classifyExternalProfile = (input: StockClassificationInput, profile: ExternalStockProfile | null): StockClassificationResult => {
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const yahooSymbol = toYahooSymbol(symbol, input.currency);
  const currency = String(input.currency || (yahooSymbol.endsWith('.HK') ? 'HKD' : 'USD')).toUpperCase();
  if (!profile) {
    return {
      symbol,
      yahooSymbol,
      currency,
      name: input.name || symbol,
      sector_level_1: '其它',
      sector_level_2: '信息服务',
      source: 'fallback',
      confidence: 0.2,
      source_sector: '',
      source_industry: '',
      reason: '未取得外部行业资料，需人工复核',
    };
  }
  const mapped = mapExternalIndustry(profile, input);
  return {
    symbol,
    yahooSymbol,
    currency,
    name: input.name || profile.longname || profile.shortname || symbol,
    sector_level_1: mapped.level1,
    sector_level_2: mapped.level2,
    source: 'yahoo_finance',
    confidence: mapped.confidence,
    source_sector: profile.sector || '',
    source_industry: profile.industry || '',
    reason: mapped.reason,
  };
};

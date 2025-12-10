"use client";

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignedIn, SignedOut, SignInButton, useUser } from '@clerk/nextjs';

// --- 类型定义 ---
interface DashboardData {
  symbol: string;
  name: string; 
  exchange: string;
  currency: string;
  price: number;
  priceInHKD: number;
  change: number;
  changePercent: number;
  high52: number; 
  low52: number;
  marketCap: string;
  history?: any[]; // K线/分时数据
  news: { 
    uuid: string; 
    title: string; 
    publisher: string; 
    link: string; 
    publishTime: number; 
    thumbnail?: string 
  }[];
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

// --- 技术指标计算辅助函数 ---
const calcSMA = (data: number[], period: number) => {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    result.push(sum / period);
  }
  return result;
};

const calcBOLL = (data: number[], period: number = 20, multiplier: number = 2) => {
  const sma = calcSMA(data, period);
  return data.map((val, i) => {
    const ma = sma[i];
    if (ma === null) return { upper: null, mid: null, lower: null };
    const slice = data.slice(i - period + 1, i + 1);
    const sumSqDiff = slice.reduce((sum, val) => sum + Math.pow(val - ma, 2), 0);
    const stdDev = Math.sqrt(sumSqDiff / period);
    return {
      mid: ma,
      upper: ma + multiplier * stdDev,
      lower: ma - multiplier * stdDev
    };
  });
};

const calcRSI = (data: number[], period: number = 14) => {
  const result = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(null);
      continue;
    }
    const change = data[i] - data[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    if (i < period) {
      avgGain += gain;
      avgLoss += loss;
      result.push(null);
    } else if (i === period) {
      avgGain /= period;
      avgLoss /= period;
      const rs = avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }
  }
  return result;
};

const calcEMA = (data: number[], period: number) => {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(ema);
      continue;
    }
    ema = data[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
};

const calcMACD = (data: number[], fast: number = 12, slow: number = 26, signal: number = 9) => {
  const emaFast = calcEMA(data, fast);
  const emaSlow = calcEMA(data, slow);
  const dif = data.map((_, i) => (emaFast[i] !== null && emaSlow[i] !== null) ? emaFast[i]! - emaSlow[i]! : null);
  
  const validDifStartIndex = dif.findIndex(v => v !== null);
  if (validDifStartIndex === -1) return { dif, dea: dif.map(() => null), bar: dif.map(() => null) };

  const validDifs = dif.slice(validDifStartIndex) as number[];
  const validDea = calcEMA(validDifs, signal);
  
  const dea = [...Array(validDifStartIndex).fill(null), ...validDea];
  const bar = dif.map((v, i) => (v !== null && dea[i] !== null) ? (v - dea[i]!) * 2 : null);

  return { dif, dea, bar };
};


// --- 组件：静态全览股票图表 ---
const StockChart = ({ data, range, onChangeRange }: { data: any[], range: string, onChangeRange: (r: string) => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 交互状态
  const [hoverData, setHoverData] = useState<any>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [mouseY, setMouseY] = useState<number | null>(null); // 鼠标在 SVG 内的 Y 坐标

  // 指标配置
  const [mainInd, setMainInd] = useState<'MA' | 'BOLL' | 'NONE'>('MA');
  const [subInd, setSubInd] = useState<'MACD' | 'RSI' | 'NONE'>('MACD');

  // 计算所有指标
  const indicators = useMemo(() => {
    if (!data || data.length === 0) return null;
    const closes = data.map(d => d.close);
    return {
      ma5: calcSMA(closes, 5),
      ma10: calcSMA(closes, 10),
      ma20: calcSMA(closes, 20),
      boll: calcBOLL(closes),
      rsi: calcRSI(closes),
      macd: calcMACD(closes)
    };
  }, [data]);

  if (!data || data.length === 0) return (
    <div className="h-[600px] flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
      <span className="text-2xl mb-2">📊</span>
      <span>暂无图表数据</span>
    </div>
  );

  const isCandle = ['1mo', '6mo', '1y', '2y', '5y'].includes(range); 
  
  // --- 布局常量 ---
  const width = 1000;
  const mainHeight = 400; 
  const xAxisHeight = 30; 
  const gap = 40; // 增加间距防止重叠
  const volHeight = 100; // 增加成交量图高度
  const subHeight = 120; // 增加副图高度
  
  // 计算区域起始 Y 坐标
  const volYStart = mainHeight + xAxisHeight + gap;
  const subYStart = volYStart + volHeight + gap;
  
  // 动态总高度
  const hasSub = subInd !== 'NONE';
  const totalHeight = hasSub ? subYStart + subHeight + 20 : volYStart + volHeight + 20;

  // --- 坐标计算 ---
  
  // 1. 主图 Y 轴
  let mainMin = Math.min(...data.map(d => isCandle ? d.low : d.close));
  let mainMax = Math.max(...data.map(d => isCandle ? d.high : d.close));
  
  if (mainInd === 'MA' && indicators) {
    const validMas = [...indicators.ma5, ...indicators.ma10, ...indicators.ma20].filter(v => v !== null) as number[];
    if (validMas.length) {
        mainMin = Math.min(mainMin, ...validMas);
        mainMax = Math.max(mainMax, ...validMas);
    }
  } else if (mainInd === 'BOLL' && indicators) {
     const validBoll = indicators.boll.flatMap(b => [b.upper, b.lower]).filter(v => v !== null) as number[];
     if (validBoll.length) {
        mainMin = Math.min(mainMin, ...validBoll);
        mainMax = Math.max(mainMax, ...validBoll);
     }
  }
  const mainPadding = (mainMax - mainMin) * 0.05;
  mainMin -= mainPadding;
  mainMax += mainPadding;
  const mainRange = mainMax - mainMin || 1;
  
  const mainY = (val: number) => mainHeight - ((val - mainMin) / mainRange) * mainHeight;
  const invertMainY = (y: number) => {
    if (y < 0 || y > mainHeight) return null;
    const ratio = (mainHeight - y) / mainHeight;
    return mainMin + ratio * mainRange;
  };

  // 2. 成交量 Y 轴
  const maxVol = Math.max(...data.map(d => d.volume || 0));
  const volY = (val: number) => (volYStart + volHeight) - ((val || 0) / (maxVol || 1)) * volHeight;
  const invertVolY = (y: number) => {
    if (y < volYStart || y > volYStart + volHeight) return null;
    const ratio = 1 - (y - volYStart) / volHeight;
    return ratio * maxVol;
  };

  // 3. 副图 Y 轴
  let subMin = 0, subMax = 100;
  if (subInd === 'MACD' && indicators) {
    const vals = [...indicators.macd.dif, ...indicators.macd.dea, ...indicators.macd.bar].filter(v => v !== null) as number[];
    if (vals.length) {
      subMin = Math.min(...vals);
      subMax = Math.max(...vals);
    }
    // 对称扩展 MACD 范围，0 轴居中（可选，这里保持自动缩放）
    // 为了美观，增加一点 padding
    const p = (subMax - subMin) * 0.1;
    subMin -= p;
    subMax += p;
  } else if (subInd === 'RSI') {
    subMin = 0; subMax = 100;
  }
  const subRange = subMax - subMin || 1;
  const subY = (val: number) => (subYStart + subHeight) - ((val - subMin) / subRange) * subHeight;
  const invertSubY = (y: number) => {
      if (y < subYStart || y > subYStart + subHeight) return null;
      const ratio = 1 - (y - subYStart) / subHeight;
      return subMin + ratio * subRange;
  };

  // X 轴坐标
  const getX = (i: number) => (i / (data.length)) * width;
  const candleWidth = Math.max(1, (width / data.length) * 0.7);

  // 辅助函数：生成路径
  const linePoints = !isCandle ? data.map((d, i) => `${getX(i) + candleWidth/2},${mainY(d.close)}`).join(' ') : '';
  const getLinePath = (vals: (number | null)[], yFunc: (v: number) => number) => {
    return vals.map((v, i) => v === null ? null : `${getX(i) + candleWidth/2},${yFunc(v)}`).filter(v => v).join(' ');
  };

  // 生成 X 轴时间刻度
  const xTicks = [];
  const tickCount = 6;
  for (let i = 0; i < tickCount; i++) {
    const idx = Math.floor((data.length - 1) * (i / (tickCount - 1)));
    if (data[idx]) {
      xTicks.push({ x: getX(idx) + candleWidth/2, time: data[idx].time });
    }
  }
  const formatXAxis = (ts: number) => {
    const date = new Date(ts);
    if (range === '1d') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (['5d', '1mo'].includes(range)) return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
    return date.toLocaleDateString([], { year: '2-digit', month: 'numeric' });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      setMouseY(y); // 保持像素坐标，用于 UI 计算
      const index = Math.max(0, Math.min(data.length - 1, Math.floor((x / rect.width) * data.length)));
      setHoverData(data[index]);
      setHoverIndex(index);
    }
  };

  // 计算准线相关数据
  const getSvgY = (pixelY: number) => {
      if(!containerRef.current) return 0;
      // 假设 SVG 填满容器高度
      return (pixelY / containerRef.current.clientHeight) * totalHeight;
  };
  const svgMouseY = mouseY !== null ? getSvgY(mouseY) : null;
  
  // 判断鼠标在哪个区域
  let activeZone: 'MAIN' | 'VOL' | 'SUB' | null = null;
  let hoverValue: number | null = null;
  
  if (svgMouseY !== null) {
      if (svgMouseY <= mainHeight) {
          activeZone = 'MAIN';
          hoverValue = invertMainY(svgMouseY);
      } else if (svgMouseY >= volYStart && svgMouseY <= volYStart + volHeight) {
          activeZone = 'VOL';
          hoverValue = invertVolY(svgMouseY);
      } else if (hasSub && svgMouseY >= subYStart && svgMouseY <= subYStart + subHeight) {
          activeZone = 'SUB';
          hoverValue = invertSubY(svgMouseY);
      }
  }

  return (
    <div className="w-full select-none">
      {/* 顶部控制栏 */}
      <div className="flex flex-wrap justify-between items-center mb-4 gap-2">
        <div className="flex gap-2 items-center flex-wrap">
            <div className="flex bg-gray-100 p-1 rounded-lg">
            {['1d', '5d', '1mo', '6mo', '1y', '2y', '5y'].map(r => (
                <button
                key={r}
                onClick={() => onChangeRange(r)}
                className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${range === r ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                >
                {r.toUpperCase()}
                </button>
            ))}
            </div>
            <div className="flex bg-gray-100 p-1 rounded-lg">
                {(['MA', 'BOLL', 'NONE'] as const).map(t => (
                    <button key={t} onClick={() => setMainInd(t)} className={`px-2 py-1 text-[10px] font-bold rounded transition-all ${mainInd === t ? 'bg-blue-100 text-blue-700' : 'text-gray-400'}`}>{t}</button>
                ))}
            </div>
            <div className="flex bg-gray-100 p-1 rounded-lg">
                {(['MACD', 'RSI', 'NONE'] as const).map(t => (
                    <button key={t} onClick={() => setSubInd(t)} className={`px-2 py-1 text-[10px] font-bold rounded transition-all ${subInd === t ? 'bg-purple-100 text-purple-700' : 'text-gray-400'}`}>{t}</button>
                ))}
            </div>
        </div>
        
        {/* 顶部悬停数据展示 */}
        <div className="text-[10px] font-mono text-gray-500 hidden xl:flex gap-3 items-center bg-gray-50 px-3 py-1 rounded-lg">
          {hoverData ? (
            <>
              <span className="font-bold text-gray-800">{new Date(hoverData.time).toLocaleString()}</span>
              <span>O:<span className="text-gray-900">{hoverData.open?.toFixed(2)}</span></span>
              <span>H:<span className="text-gray-900">{hoverData.high?.toFixed(2)}</span></span>
              <span>L:<span className="text-gray-900">{hoverData.low?.toFixed(2)}</span></span>
              <span>C:<span className={hoverData.close >= hoverData.open ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{hoverData.close?.toFixed(2)}</span></span>
              {hoverData.volume > 0 && <span>Vol:{(hoverData.volume/1000000).toFixed(2)}M</span>}
              {mainInd === 'MA' && hoverIndex !== null && indicators && (
                  <>
                    <span className="text-orange-500">MA5:{indicators.ma5[hoverIndex]?.toFixed(2)}</span>
                    <span className="text-blue-500">MA10:{indicators.ma10[hoverIndex]?.toFixed(2)}</span>
                    <span className="text-purple-500">MA20:{indicators.ma20[hoverIndex]?.toFixed(2)}</span>
                  </>
              )}
            </>
          ) : <span>移动鼠标查看详情</span>}
        </div>
      </div>

      {/* SVG 绘图区 */}
      <div 
        ref={containerRef}
        className="relative w-full border border-gray-100 rounded-xl overflow-hidden bg-white cursor-crosshair"
        style={{ height: totalHeight }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { setHoverData(null); setHoverIndex(null); setMouseY(null); }}
      >
        <svg viewBox={`0 0 ${width} ${totalHeight}`} className="w-full h-full" preserveAspectRatio="none">
          
          {/* ================= 主图区域 ================= */}
          {/* Grid Lines */}
          {[0.2, 0.4, 0.6, 0.8].map(p => (
            <line key={p} x1="0" y1={mainHeight * p} x2={width} y2={mainHeight * p} stroke="#f3f4f6" strokeWidth="1" strokeDasharray="4 4" />
          ))}

          {/* Candles / Line */}
          {isCandle ? (
            data.map((d, i) => {
              const xCenter = getX(i) + candleWidth/2;
              const isUp = d.close >= d.open;
              const color = isUp ? '#10b981' : '#ef4444';
              return (
                <g key={i}>
                  <line x1={xCenter} y1={mainY(d.high)} x2={xCenter} y2={mainY(d.low)} stroke={color} strokeWidth="1" />
                  <rect 
                    x={xCenter - candleWidth/2} 
                    y={Math.min(mainY(d.open), mainY(d.close))} 
                    width={candleWidth} 
                    height={Math.max(1, Math.abs(mainY(d.open) - mainY(d.close)))} 
                    fill={color} 
                  />
                </g>
              );
            })
          ) : (
            <>
              <defs>
                <linearGradient id="mainGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.1" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={`M0,${mainHeight} ${linePoints} ${width},${mainHeight} Z`} fill="url(#mainGradient)" />
              <polyline points={linePoints} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}

          {/* Main Indicators: MA */}
          {mainInd === 'MA' && indicators && (
            <>
              <polyline points={getLinePath(indicators.ma5, mainY)} fill="none" stroke="#f97316" strokeWidth="1" />
              <polyline points={getLinePath(indicators.ma10, mainY)} fill="none" stroke="#3b82f6" strokeWidth="1" />
              <polyline points={getLinePath(indicators.ma20, mainY)} fill="none" stroke="#a855f7" strokeWidth="1" />
            </>
          )}

          {/* Main Indicators: BOLL */}
          {mainInd === 'BOLL' && indicators && (
             <>
                <polyline points={getLinePath(indicators.boll.map(b => b.upper), mainY)} fill="none" stroke="#9ca3af" strokeWidth="1" strokeDasharray="2 2" />
                <polyline points={getLinePath(indicators.boll.map(b => b.mid), mainY)} fill="none" stroke="#f59e0b" strokeWidth="1" />
                <polyline points={getLinePath(indicators.boll.map(b => b.lower), mainY)} fill="none" stroke="#9ca3af" strokeWidth="1" strokeDasharray="2 2" />
             </>
          )}
          
          <line x1="0" y1={mainHeight} x2={width} y2={mainHeight} stroke="#e5e7eb" strokeWidth="1" />
          
          {/* X Axis Ticks */}
          <g transform={`translate(0, ${mainHeight + 15})`}>
              {xTicks.map((tick, i) => (
                  <text key={i} x={tick.x} y="0" fontSize="10" fill="#9ca3af" textAnchor="middle">
                      {formatXAxis(tick.time)}
                  </text>
              ))}
          </g>


          {/* ================= 成交量区域 (VOL) ================= */}
          <text x="4" y={volYStart + 12} fontSize="10" fontWeight="bold" fill="#6b7280">VOL ({maxVol > 1000000 ? (maxVol/1000000).toFixed(1) + 'M' : maxVol})</text>
          
          {/* VOL Y Axis Grid/Labels */}
          <line x1="0" y1={volYStart} x2={width} y2={volYStart} stroke="#f3f4f6" strokeWidth="1" />
          <line x1="0" y1={volYStart + volHeight} x2={width} y2={volYStart + volHeight} stroke="#e5e7eb" strokeWidth="1" />
          
          {data.map((d, i) => {
             const xCenter = getX(i) + candleWidth/2;
             const isUp = d.close >= d.open;
             const color = isUp ? '#10b981' : '#ef4444';
             const y = volY(d.volume);
             const h = (volYStart + volHeight) - y;
             return <rect key={i} x={xCenter - candleWidth/2} y={y} width={candleWidth} height={h} fill={color} opacity="0.5" />;
          })}


          {/* ================= 副图区域 (MACD/RSI) ================= */}
          {hasSub && indicators && (
            <g>
               <text x="4" y={subYStart + 12} fontSize="10" fontWeight="bold" fill="#6b7280">{subInd}</text>
               
               {/* Top Border */}
               <line x1="0" y1={subYStart} x2={width} y2={subYStart} stroke="#f3f4f6" strokeWidth="1" />
               <line x1="0" y1={subYStart + subHeight} x2={width} y2={subYStart + subHeight} stroke="#e5e7eb" strokeWidth="1" />

               {subInd === 'RSI' && (
                 <>
                   {/* RSI Levels */}
                   <line x1="0" y1={subY(70)} x2={width} y2={subY(70)} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="2 2" />
                   <line x1="0" y1={subY(30)} x2={width} y2={subY(30)} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="2 2" />
                   <polyline 
                      points={getLinePath(indicators.rsi, subY)} 
                      fill="none" stroke="#7c3aed" strokeWidth="1.5" 
                   />
                 </>
               )}

               {subInd === 'MACD' && (
                 <>
                   {/* Zero Line */}
                   <line x1="0" y1={subY(0)} x2={width} y2={subY(0)} stroke="#e5e7eb" strokeWidth="1" />
                   
                   {/* MACD Bars */}
                   {indicators.macd.bar.map((v, i) => {
                      if(v === null) return null;
                      const xCenter = getX(i) + candleWidth/2;
                      const yZero = subY(0);
                      const yVal = subY(v);
                      return <line key={i} x1={xCenter} y1={yZero} x2={xCenter} y2={yVal} stroke={v >= 0 ? '#ef4444' : '#10b981'} strokeWidth={candleWidth} opacity="0.8" />;
                   })}
                   
                   {/* DIF & DEA */}
                   <polyline points={getLinePath(indicators.macd.dif, subY)} fill="none" stroke="#3b82f6" strokeWidth="1" />
                   <polyline points={getLinePath(indicators.macd.dea, subY)} fill="none" stroke="#f59e0b" strokeWidth="1" />
                 </>
               )}
            </g>
          )}


          {/* ================= 交互准线 & 标签 ================= */}
          {hoverIndex !== null && svgMouseY !== null && activeZone && hoverValue !== null && (
             <g pointerEvents="none">
                 {/* 1. 垂直准线 (贯穿所有图表) */}
                 <line 
                    x1={getX(hoverIndex) + candleWidth/2} y1="0" 
                    x2={getX(hoverIndex) + candleWidth/2} y2={totalHeight} 
                    stroke="#6b7280" strokeWidth="1" strokeDasharray="4 4" 
                 />
                 
                 {/* 2. 水平准线 (仅在当前激活区域显示) */}
                 <line 
                    x1="0" y1={svgMouseY} 
                    x2={width} y2={svgMouseY} 
                    stroke="#6b7280" strokeWidth="1" strokeDasharray="4 4" 
                 />

                 {/* 3. 右侧数值标签 */}
                 <g transform={`translate(${width - 60}, ${svgMouseY})`}>
                     <rect x="-5" y="-14" width="65" height="28" fill="#1f2937" rx="4" />
                     <text x="27" y="6" fill="white" fontSize="11" textAnchor="middle" fontWeight="bold">
                         {/* 根据不同区域格式化数值 */}
                         {activeZone === 'VOL' 
                            ? (hoverValue > 1000000 ? (hoverValue/1000000).toFixed(2) + 'M' : hoverValue.toFixed(0))
                            : hoverValue.toFixed(2)
                         }
                     </text>
                 </g>
             </g>
          )}

        </svg>
        
        {/* 右侧 Y 轴刻度 (静态) */}
        {/* 主图刻度 */}
        <div className="absolute right-0 top-0 flex flex-col justify-between text-[9px] text-gray-400 p-1 pointer-events-none select-none" style={{ height: mainHeight }}>
           <span>{mainMax.toFixed(2)}</span>
           <span>{mainMin.toFixed(2)}</span>
        </div>
        {/* 副图刻度 (如果存在) */}
        {hasSub && (
           <div className="absolute right-0 flex flex-col justify-between text-[9px] text-gray-400 p-1 pointer-events-none select-none" style={{ top: subYStart, height: subHeight }}>
              <span>{subMax.toFixed(2)}</span>
              <span>{subMin.toFixed(2)}</span>
           </div>
        )}
      </div>
    </div>
  );
};

// --- 主页面逻辑 ---
function MainContent() {
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();

  const [inputSymbol, setInputSymbol] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // 图表范围状态
  const [chartRange, setChartRange] = useState('1d'); // 默认改为 1d

  // 搜索建议状态
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchContainerRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const symbol = searchParams.get('symbol');
    if (symbol) {
      setInputSymbol(symbol.toUpperCase());
      fetchData(symbol, '1d'); // 默认加载1天数据
    }
  }, [searchParams]);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchData = async (symbol: string, range: string) => {
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}&range=${range}`);
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error('网络响应异常');
      }
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 404) throw new Error('未找到该股票/指数');
        throw new Error(json.error || '查询出错');
      }
      setData(json);
    } catch (err: any) {
      console.error("Fetch Error:", err);
      setError(err.message || '发生未知错误');
    } finally {
      setLoading(false);
    }
  };

  const handleRangeChange = (newRange: string) => {
    setChartRange(newRange);
    if (data?.symbol) {
      fetchData(data.symbol, newRange);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputSymbol(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (val.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
        if (res.ok) {
          const results = await res.json();
          setSuggestions(results);
          setShowSuggestions(true);
        }
      } catch (e) {
        console.error("Search suggestion error", e);
      }
    }, 300); 
  };

  const handleSelectSuggestion = (symbol: string) => {
    setInputSymbol(symbol);
    fetchData(symbol, chartRange);
    setShowSuggestions(false);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputSymbol.trim()) return;
    fetchData(inputSymbol, chartRange);
    setShowSuggestions(false);
  };

  const fmtNum = (n: any, decimals = 2) => {
    if (typeof n === 'number') return n.toFixed(decimals);
    const num = parseFloat(n);
    if (!isNaN(num)) return num.toFixed(decimals);
    return '--';
  };

  const fmtPct = (n: any) => {
    if (typeof n === 'number') return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
    const num = parseFloat(n);
    if (!isNaN(num)) return `${num > 0 ? '+' : ''}${num.toFixed(2)}%`;
    return '--';
  };

  const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute:'2-digit' });

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6 animate-fade-in pt-24">
      {/* --- 搜索栏 --- */}
      <div className="flex flex-col md:flex-row justify-between items-start mb-8 gap-4">
        <h1 className="text-2xl font-bold text-gray-900 mt-2">个股行情中心</h1>
        <form ref={searchContainerRef} onSubmit={handleSearchSubmit} className="relative w-full md:w-96 z-20">
          <input 
            type="text" value={inputSymbol} onChange={handleInputChange} onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            placeholder="输入代码 (如 AAPL, 0700.HK, ^HSI)..."
            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-full focus:ring-blue-500 block pl-5 p-3 shadow-sm outline-none"
            autoComplete="off"
          />
          <button type="submit" disabled={loading} className="absolute right-2 top-1.5 bg-blue-600 text-white px-4 py-1.5 rounded-full text-xs font-bold hover:bg-blue-700 disabled:bg-gray-400 transition">
            {loading ? '...' : '查询'}
          </button>
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 w-full bg-white mt-1 rounded-xl shadow-xl border border-gray-100 max-h-80 overflow-y-auto z-30">
              {suggestions.map((item) => (
                <div key={item.symbol} onClick={() => handleSelectSuggestion(item.symbol)} className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b last:border-0 flex justify-between">
                  <div><div className="font-bold">{item.symbol}</div><div className="text-xs text-gray-500">{item.name}</div></div>
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded">{item.exchange}</span>
                </div>
              ))}
            </div>
          )}
        </form>
      </div>

      <SignedOut>
        <div className="text-center py-20 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <h2 className="text-xl font-bold text-gray-800 mb-2">请先登录以查看深度数据</h2>
          <SignInButton mode="modal"><button className="bg-black text-white px-8 py-3 rounded-full font-bold hover:bg-gray-800 transition">登录 / 注册</button></SignInButton>
        </div>
      </SignedOut>

      <SignedIn>
        {!user?.publicMetadata?.approved && isLoaded ? (
           <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
             <p className="text-yellow-800 font-bold">⏳ 账号审核中</p>
             <p className="text-yellow-600 text-sm mt-1">为了保证服务质量，新注册用户需要等待管理员审核。<br/>请联系管理员进行开通，或耐心等待。</p>
           </div>
        ) : (
          <>
            {error && <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl mb-6 text-sm font-medium flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>{error}</div>}

            {data && (
              <div className="flex flex-col gap-6">
                
                {/* 1. 概览 & 图表板块 (占据主视觉) */}
                <div className="bg-white p-6 md:p-8 rounded-2xl border border-gray-100 shadow-sm">
                  {/* 头部信息 */}
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h1 className="text-4xl font-black text-gray-900">{data.symbol}</h1>
                        <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold">{data.exchange}</span>
                      </div>
                      <div className="text-lg font-bold text-gray-500 mt-1">{data.name}</div>
                      <div className="text-xs text-gray-400 mt-1 flex gap-4">
                        <span>货币: {data.currency}</span>
                        {/* 移除市值显示 */}
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end">
                        <div className={`flex items-baseline gap-3 ${data.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            <span className="text-5xl font-bold tracking-tight">{fmtNum(data.price)}</span>
                            <span className="text-lg font-bold">{data.change >= 0 ? '+' : ''}{fmtNum(data.change)} ({fmtPct(data.changePercent)})</span>
                        </div>
                        <div className="text-sm text-gray-400 mt-1 font-mono">
                            ≈ HKD {fmtNum(data.priceInHKD)}
                        </div>
                    </div>
                  </div>

                  {/* 图表组件 */}
                  <div className="border-t border-gray-50 pt-6">
                     <StockChart data={data.history || []} range={chartRange} onChangeRange={handleRangeChange} />
                  </div>
                </div>

                {/* 6. 最新资讯板块 (平铺在下方) */}
                <div className="bg-white p-6 md:p-8 rounded-2xl border border-gray-100 shadow-sm">
                  <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                    <span className="text-blue-600">📰</span> 最新资讯
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {data.news?.map((item) => (
                      <a key={item.uuid} href={item.link} target="_blank" className="group block h-full">
                        <div className="h-full flex flex-col bg-gray-50 rounded-xl overflow-hidden hover:shadow-md transition border border-gray-100">
                          {/* 简单布局：如果有图显示图，没图不显示 */}
                          {item.thumbnail && (
                             <div className="h-32 w-full bg-gray-200 relative overflow-hidden">
                                <img src={item.thumbnail} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                             </div>
                          )}
                          <div className="p-4 flex-1 flex flex-col justify-between">
                             <h4 className="font-bold text-gray-800 group-hover:text-blue-600 leading-snug mb-3 line-clamp-2">
                               {item.title}
                             </h4>
                             <div className="flex justify-between items-center text-xs text-gray-400 mt-auto">
                                <span className="font-medium bg-white px-2 py-1 rounded border border-gray-200">{item.publisher}</span>
                                <span>{fmtDate(item.publishTime)}</span>
                             </div>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                  
                  {(!data.news || data.news.length === 0) && (
                    <div className="text-center py-10 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                        暂无相关新闻
                    </div>
                  )}
                </div>

              </div>
            )}
          </>
        )}
      </SignedIn>
    </div>
  );
}

export default function QuotePage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Loading...</div>}>
      <MainContent />
    </Suspense>
  );
}
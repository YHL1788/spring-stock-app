'use client';

import React, { useState, useMemo } from 'react';
import { useStockPool } from '@/app/hooks/useStockPool'; 
import { db, auth, APP_ID } from '@/app/lib/stockService'; 
import { doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { X, Trash2, Save, FileSpreadsheet, Search, Sparkles, Loader2 } from 'lucide-react';
import { classifyStock, classifyStocks } from '@/app/lib/stockClassificationClient';
import {
  isSupportedClassificationMarket,
  isMissingClassification,
  type StockClassificationInput,
  type StockClassificationResult,
} from '@/app/lib/stockClassification';

type StockPoolRow = StockClassificationInput & {
  sector_level_1?: string;
  sector_level_2?: string;
  [key: string]: any;
};

const mergeAutomaticClassification = (
  stock: StockPoolRow,
  result: StockClassificationResult,
  existing?: StockPoolRow,
) => {
  const existingLevel1 = existing?.sector_level_1;
  const existingLevel2 = existing?.sector_level_2;
  const selectedLevel1 = !isMissingClassification(stock.sector_level_1)
    ? stock.sector_level_1
    : !isMissingClassification(existingLevel1)
      ? existingLevel1
      : result.sector_level_1;
  const selectedLevel2 = !isMissingClassification(stock.sector_level_2)
    ? stock.sector_level_2
    : !isMissingClassification(existingLevel2)
      ? existingLevel2
      : result.sector_level_2;

  return {
    ...stock,
    currency: String(stock.currency || existing?.currency || result.currency || 'USD').toUpperCase(),
    name: stock.name || existing?.name || result.name || stock.symbol,
    sector_level_1: selectedLevel1,
    sector_level_2: selectedLevel2,
    classification_source: result.source,
    classification_confidence: result.confidence,
    classification_reason: result.reason,
    source_sector: result.source_sector,
    source_industry: result.source_industry,
    classifiedAt: new Date().toISOString(),
  };
};

export default function StockPoolAdmin() {
  // ---------------------------------------------------------
  // 🔐 密码保护逻辑
  // ---------------------------------------------------------
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');

  // ---------------------------------------------------------
  // ⚙️ Admin 业务逻辑状态
  // ---------------------------------------------------------
  const { stocks, loading, refresh } = useStockPool();
  const [formData, setFormData] = useState({ 
    symbol: '', 
    currency: 'USD', 
    name: '', 
    sector_level_1: '', 
    sector_level_2: '' 
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoClassifying, setIsAutoClassifying] = useState(false);
  const [classificationMessage, setClassificationMessage] = useState('');

  // ---------------------------------------------------------
  // 🔍 列表筛选状态
  // ---------------------------------------------------------
  const [filters, setFilters] = useState({
    symbol: '',
    currency: '',
    name: '',
    sector_level_1: '',
    sector_level_2: ''
  });

  // ---------------------------------------------------------
  // 📥 Excel 导入模态框状态
  // ---------------------------------------------------------
  const [showImportModal, setShowImportModal] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [isMigrating, setIsMigrating] = useState(false);

  // ---------------------------------------------------------
  // 📤 Excel 导出模态框状态
  // ---------------------------------------------------------
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportText, setExportText] = useState('');

  // =========================================================
  // 功能函数区
  // =========================================================

  // 动态筛选数据
  const filteredStocks = useMemo(() => {
    return stocks.filter((s: any) => {
      const matchSymbol = (s.symbol || '').toLowerCase().includes(filters.symbol.toLowerCase());
      const matchCurrency = (s.currency || '').toLowerCase().includes(filters.currency.toLowerCase());
      const matchName = (s.name || '').toLowerCase().includes(filters.name.toLowerCase());
      const matchSec1 = (s.sector_level_1 || '').toLowerCase().includes(filters.sector_level_1.toLowerCase());
      const matchSec2 = (s.sector_level_2 || '').toLowerCase().includes(filters.sector_level_2.toLowerCase());
      
      return matchSymbol && matchCurrency && matchName && matchSec1 && matchSec2;
    });
  }, [stocks, filters]);

  const unknownCount = useMemo(() => stocks.filter((stock: StockPoolRow) => (
    isSupportedClassificationMarket(stock) && (
      isMissingClassification(stock.sector_level_1) || isMissingClassification(stock.sector_level_2)
    )
  )).length, [stocks]);

  const handleAutoClassifyForm = async () => {
    if (!formData.symbol.trim()) return alert('请先输入股票代码。');
    if (!isSupportedClassificationMarket(formData)) return alert('目前自动分类支持美股、港股、A 股和日本股票。');
    setIsAutoClassifying(true);
    setClassificationMessage('');
    try {
      const result = await classifyStock(formData);
      const merged = mergeAutomaticClassification(formData, result);
      setFormData({
        symbol: merged.symbol,
        currency: merged.currency || formData.currency,
        name: merged.name || '',
        sector_level_1: merged.sector_level_1 || '',
        sector_level_2: merged.sector_level_2 || '',
      });
      setClassificationMessage(`已识别：${merged.sector_level_1} / ${merged.sector_level_2}（${Math.round(result.confidence * 100)}%）`);
    } catch (error) {
      console.error('Auto classification failed:', error);
      alert('自动分类暂时不可用，请稍后重试，或继续手动填写。');
    } finally {
      setIsAutoClassifying(false);
    }
  };

  const handleAutoClassifyUnknown = async () => {
    const candidates = stocks.filter((stock: StockPoolRow) => (
      isSupportedClassificationMarket(stock) && (
        isMissingClassification(stock.sector_level_1) || isMissingClassification(stock.sector_level_2)
      )
    ));
    if (!candidates.length) return alert('当前美股、港股、A 股及日本股票均已有完整行业分类。');
    if (!confirm(`将自动补齐 ${candidates.length} 只股票的缺失行业。已有人工分类不会被覆盖，是否继续？`)) return;

    setIsAutoClassifying(true);
    setClassificationMessage(`正在识别 ${candidates.length} 只股票...`);
    try {
      const results = await classifyStocks(candidates);
      const resultMap = new Map(results.map((result) => [result.symbol, result]));
      const batch = writeBatch(db);
      let updateCount = 0;
      candidates.forEach((stock: StockPoolRow) => {
        const symbol = String(stock.symbol || '').trim().toUpperCase();
        const result = resultMap.get(symbol);
        if (!result) return;
        const merged = mergeAutomaticClassification(stock, result, stock);
        batch.set(doc(db, 'artifacts', APP_ID, 'public', 'data', 'stock_pool', symbol), {
          name: merged.name,
          currency: merged.currency,
          sector_level_1: merged.sector_level_1,
          sector_level_2: merged.sector_level_2,
          classification_source: merged.classification_source,
          classification_confidence: merged.classification_confidence,
          classification_reason: merged.classification_reason,
          source_sector: merged.source_sector,
          source_industry: merged.source_industry,
          classifiedAt: merged.classifiedAt,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        updateCount += 1;
      });
      await batch.commit();
      setClassificationMessage(`自动分类完成：已补齐 ${updateCount} 只股票，人工分类均已保留。`);
      refresh();
    } catch (error) {
      console.error('Bulk classification failed:', error);
      setClassificationMessage('自动分类未完成，请稍后重试；现有数据未被删除。');
    } finally {
      setIsAutoClassifying(false);
    }
  };

  const generateExportText = () => {
    if (!filteredStocks || filteredStocks.length === 0) {
      setExportText('当前列表暂无数据可供导出。');
      return;
    }
    // 表头
    const header = ['代码(Symbol)', '币种(Currency)', '名称(Name)', '一级行业', '二级行业'].join('\t');
    // 数据行，支持导出筛选后的结果
    const rows = filteredStocks.map((s: any) => {
      return [
        s.symbol || '',
        s.currency || 'USD',
        s.name || '',
        s.sector_level_1 || '',
        s.sector_level_2 || ''
      ].join('\t');
    });
    setExportText([header, ...rows].join('\n'));
    setShowExportModal(true);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      alert('内容已成功复制到剪贴板！现在可以直接去 Excel 中粘贴了。');
    } catch (err) {
      console.error('Failed to copy text: ', err);
      alert('复制失败，请尝试手动全选文本框内容并复制 (Ctrl+C)。');
    }
  };

  // 一键清空全部数据
  const handleClearAll = async () => {
    if (stocks.length === 0) return alert("当前云端没有数据可供清空。");
    const userInput = prompt(`⚠️ 危险操作！您正在尝试永久删除云端所有的 ${stocks.length} 条数据。\n为了防止误操作，如果确认清空，请输入大写字母 DELETE`);
    if (userInput !== 'DELETE') {
      return;
    }
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      stocks.forEach((s: any) => {
        const ref = doc(db, 'artifacts', APP_ID, 'public', 'data', 'stock_pool', s.symbol);
        batch.delete(ref);
      });
      await batch.commit();
      alert("✅ 云端数据已全部清空！");
      refresh(); 
    } catch (e) {
      console.error(e);
      alert("清空失败，请检查控制台错误信息。");
    } finally {
      setIsSaving(false);
    }
  };

  // 单条保存
  const handleSave = async () => {
    if (!formData.symbol) return alert("股票代码必填");
    if (!auth.currentUser) return alert("未连接到数据库");
    
    const docId = formData.symbol.trim().toUpperCase();
    
    // 【查重防线 3】单条新增时检查代码是否重复
    const exists = stocks.some((s: any) => s.symbol === docId);
    if (exists) {
        if (!confirm(`⚠️ 提示：代码 ${docId} 已在云端存在！\n代码列禁止重复，点击“确定”将作为【覆盖更新】修改该记录，点击“取消”放弃操作。`)) {
            return;
        }
    }

    setIsSaving(true);
    try {
      let dataToSave: StockPoolRow = { ...formData, symbol: docId };
      const needsAutomaticData = isSupportedClassificationMarket(dataToSave) && (
        !dataToSave.name || isMissingClassification(dataToSave.sector_level_1) || isMissingClassification(dataToSave.sector_level_2)
      );
      if (needsAutomaticData) {
        const result = await classifyStock(dataToSave);
        const existing = stocks.find((stock: StockPoolRow) => stock.symbol === docId);
        dataToSave = mergeAutomaticClassification(dataToSave, result, existing);
      } else {
        dataToSave = {
          ...dataToSave,
          classification_source: 'manual',
          classification_confidence: 1,
          classification_reason: '人工维护或 Excel 输入',
          classifiedAt: new Date().toISOString(),
        };
      }
      if (!dataToSave.name) return alert('无法自动取得名称，请手动填写后再保存。');
      await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'stock_pool', docId), {
        ...dataToSave,
        symbol: docId,
        currency: String(dataToSave.currency || 'USD').toUpperCase(),
        updatedAt: new Date().toISOString()
      });
      setFormData({ symbol: '', currency: 'USD', name: '', sector_level_1: '', sector_level_2: '' });
      setClassificationMessage('保存成功；缺失行业已自动补齐。');
      refresh(); 
    } catch (e) {
      console.error(e);
      alert("保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  // 单条删除
  const handleDelete = async (symbol: string) => {
    if (!confirm(`确认删除 ${symbol}?`)) return;
    try {
      await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'stock_pool', symbol));
      refresh(); 
    } catch (e) {
      console.error(e);
    }
  };

  // 填充编辑表单
  const fillForm = (s: any) => {
    setFormData({
      symbol: s.symbol || '',
      currency: s.currency || 'USD',
      name: s.name || '',
      sector_level_1: s.sector_level_1 || '',
      sector_level_2: s.sector_level_2 || ''
    });
  };

  // 处理 Excel 粘贴解析并去重
  const handlePasteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setPasteText(text);
    if (!text.trim()) {
      setPreviewData([]);
      return;
    }
    const lines = text.split('\n');
    const parsed: any[] = [];
    const seenSymbols = new Set<string>();
    let duplicateCount = 0;

    for (const line of lines) {
      const cols = line.split('\t');
      const symbol = (cols[0]?.trim() || '').toUpperCase();
      
      // 过滤完全空白的行
      if (!symbol && !cols[2]?.trim()) continue; 

      // 【查重防线 1】粘贴解析时过滤重复的代码
      if (symbol) {
          if (seenSymbols.has(symbol)) {
              duplicateCount++;
              continue; 
          }
          seenSymbols.add(symbol);
      }

      parsed.push({
        symbol: symbol,
        currency: cols[1]?.trim() || 'USD',
        name: cols[2]?.trim() || '',
        sector_level_1: cols[3]?.trim() || '',
        sector_level_2: cols[4]?.trim() || ''
      });
    }
    
    setPreviewData(parsed);
    if (duplicateCount > 0) {
        alert(`⚠️ 粘贴检测提示：\n发现了 ${duplicateCount} 条重复的股票代码。为了保证“代码列禁止重复”，已自动为您去重（仅保留每条代码首次出现的记录）。`);
    }
  };

  const handlePreviewChange = (index: number, field: string, value: string) => {
    const newData = [...previewData];
    newData[index][field] = value;
    setPreviewData(newData);
  };

  const handleRemovePreviewRow = (index: number) => {
    const newData = [...previewData];
    newData.splice(index, 1);
    setPreviewData(newData);
  };

  const handleBatchImport = async () => {
    const validData = previewData.filter(d => d.symbol);
    if (validData.length === 0) return alert("没有检测到有效数据，请检查必填项（股票代码）。");
    
    // 【查重防线 2】最终入库前，拦截预览表中手动修改导致的重复
    const symbolSet = new Set<string>();
    for (const item of validData) {
        const sym = item.symbol.trim().toUpperCase();
        if (symbolSet.has(sym)) {
            return alert(`❌ 导入被拦截：\n预览列表中存在重复的代码 [${sym}]。代码列禁止出现重复，请在右侧修改或移除重复项后再提交。`);
        }
        symbolSet.add(sym);
    }
    
    if (!confirm(`准备将 ${validData.length} 条有效数据写入数据库（若遇到库中已有相同代码，将覆盖更新原有记录）。继续吗？`)) return;
    
    setIsMigrating(true);
    try {
      const candidates = validData.filter((item) => isSupportedClassificationMarket(item) && (
        !item.name || isMissingClassification(item.sector_level_1) || isMissingClassification(item.sector_level_2)
      ));
      const results = await classifyStocks(candidates);
      const resultMap = new Map(results.map((result) => [result.symbol, result]));
      const enrichedData = validData.map((item) => {
        const docId = item.symbol.trim().toUpperCase();
        const existing = stocks.find((stock: StockPoolRow) => stock.symbol === docId);
        const result = resultMap.get(docId);
        if (result) return mergeAutomaticClassification({ ...item, symbol: docId }, result, existing);
        return {
          ...existing,
          ...item,
          symbol: docId,
          sector_level_1: !isMissingClassification(item.sector_level_1) ? item.sector_level_1 : existing?.sector_level_1 || '',
          sector_level_2: !isMissingClassification(item.sector_level_2) ? item.sector_level_2 : existing?.sector_level_2 || '',
          classification_source: 'manual',
          classification_confidence: 1,
          classification_reason: '人工维护或 Excel 输入',
          classifiedAt: new Date().toISOString(),
        };
      });
      const batch = writeBatch(db);
      enrichedData.forEach(item => {
        const docId = item.symbol.trim().toUpperCase();
        const ref = doc(db, 'artifacts', APP_ID, 'public', 'data', 'stock_pool', docId);
        batch.set(ref, {
          ...item,
          symbol: docId,
          currency: item.currency.toUpperCase(),
          updatedAt: new Date().toISOString()
        });
      });
      await batch.commit();
      alert(`✅ 成功导入/更新了 ${enrichedData.length} 条股票数据！缺失的美股、港股、A 股和日本股票行业已自动补齐。`);
      setShowImportModal(false);
      setPasteText('');
      setPreviewData([]);
      refresh(); 
    } catch (e) {
      console.error("Batch import failed:", e);
      alert("导入失败，请检查控制台错误信息。");
    } finally {
      setIsMigrating(false);
    }
  };

  // ---------------------------------------------------------
  // 🚪 拦截渲染：如果没有通过验证，显示密码输入框
  // ---------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg border border-slate-200 max-w-sm w-full">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-slate-800">🔒 开发者选项</h1>
            <p className="text-slate-500 text-sm mt-1">请输入管理员密码以继续</p>
          </div>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (passwordInput === '25210228') {
              setIsAuthenticated(true);
            } else {
              alert('访问被拒绝：密码错误');
              setPasswordInput('');
            }
          }}>
            <div className="mb-6">
              <input 
                type="password" 
                className="w-full border border-slate-300 bg-slate-50 p-3 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-center tracking-widest"
                placeholder="• • • • • • • •"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                autoFocus
              />
            </div>
            <button type="submit" className="w-full bg-slate-900 text-white py-3 rounded-lg font-medium hover:bg-slate-800 transition-colors shadow-sm">
              解锁进入
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // 🛠️ 提取渲染带筛选框的表头辅助函数
  // ---------------------------------------------------------
  const renderFilterTh = (label: string, filterKey: keyof typeof filters, align: string = 'left') => {
    return (
      <th className={`px-4 py-3 whitespace-nowrap align-top text-${align}`}>
        <div className="font-semibold text-slate-600 mb-2">{label}</div>
        <div className="relative">
          <input
            type="text"
            placeholder="筛选..."
            value={filters[filterKey]}
            onChange={(e) => setFilters({ ...filters, [filterKey]: e.target.value })}
            className="w-full min-w-[70px] border border-slate-300 rounded-md pl-6 pr-2 py-1.5 text-xs font-normal focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-700 bg-white shadow-sm transition-all"
          />
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
        </div>
      </th>
    );
  };

  // ---------------------------------------------------------
  // 🛠️ 正常的管理界面渲染 (验证通过后显示)
  // ---------------------------------------------------------
  return (
    <div className="p-8 max-w-7xl mx-auto min-h-screen bg-slate-50 text-slate-900 relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            全局股票池管理 (Stock Pool)
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full border border-green-200">已授权</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1 flex gap-3">
            <span>云端总计: <strong className="text-slate-800">{stocks.length}</strong> 条</span>
            {filteredStocks.length !== stocks.length && (
              <span className="text-indigo-600">筛选结果: <strong>{filteredStocks.length}</strong> 条</span>
            )}
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleAutoClassifyUnknown}
            disabled={isAutoClassifying || unknownCount === 0}
            className="px-4 py-2 bg-violet-600 text-white text-sm font-bold rounded flex items-center gap-2 hover:bg-violet-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="只补齐空白或未知的美股、港股、A 股及日本股票行业，不覆盖人工分类"
          >
            {isAutoClassifying ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            自动分类未知 ({unknownCount})
          </button>
          <button 
            onClick={generateExportText} 
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded flex items-center gap-2 hover:bg-emerald-700 transition-colors shadow-sm"
          >
            📤 导出列表 (支持筛选)
          </button>
          <button 
            onClick={() => setShowImportModal(true)} 
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <FileSpreadsheet size={16} /> 📥 一键从 Excel 导入
          </button>
          <button 
            onClick={handleClearAll} 
            className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded flex items-center gap-2 hover:bg-red-700 transition-colors shadow-sm"
            title="清空云端所有数据"
          >
            <Trash2 size={16} /> 一键清空
          </button>
          <button 
            onClick={refresh} 
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded hover:bg-slate-50 transition-colors shadow-sm"
          >
            刷新列表
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-4 py-3 text-sm text-slate-700 flex items-start gap-3">
        <Sparkles size={18} className="text-violet-600 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold text-slate-800">美股、港股、A 股与日本股票行业自动分类已启用</p>
          <p className="text-xs text-slate-600 mt-0.5">优先采用 SIP 现有分类，再通过公开行情行业资料映射；支持沪深北、东京代码，人工填写和 Excel 分类始终优先。</p>
          {classificationMessage && <p className="text-xs font-medium text-violet-700 mt-1.5">{classificationMessage}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 左侧：手动添加/编辑表单 */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-fit sticky top-6 lg:col-span-1">
          <h2 className="font-bold text-lg mb-4 border-b pb-2">单条维护</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">代码 (Symbol)</label>
                <input 
                  className="w-full border border-slate-300 p-2 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-mono transition-all" 
                  placeholder="如: AAPL" 
                  value={formData.symbol} 
                  onChange={e => setFormData({...formData, symbol: e.target.value.toUpperCase()})} 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">计价币种</label>
                <select 
                  className="w-full border border-slate-300 p-2 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-mono transition-all bg-white"
                  value={formData.currency}
                  onChange={e => setFormData({...formData, currency: e.target.value})}
                >
                  <option value="USD">USD</option>
                  <option value="HKD">HKD</option>
                  <option value="CNY">CNY</option>
                  <option value="JPY">JPY</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">名称 (Name)</label>
              <input 
                className="w-full border border-slate-300 p-2 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all" 
                placeholder="如: 苹果公司" 
                value={formData.name} 
                onChange={e => setFormData({...formData, name: e.target.value})} 
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">一级行业</label>
                <input 
                  className="w-full border border-slate-300 p-2 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all" 
                  value={formData.sector_level_1} 
                  onChange={e => setFormData({...formData, sector_level_1: e.target.value})} 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">二级行业</label>
                <input 
                  className="w-full border border-slate-300 p-2 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all" 
                  value={formData.sector_level_2} 
                  onChange={e => setFormData({...formData, sector_level_2: e.target.value})} 
                />
              </div>
            </div>
            <div className="rounded-lg border border-violet-100 bg-violet-50/70 p-3">
              <button
                type="button"
                onClick={handleAutoClassifyForm}
                disabled={isAutoClassifying || !formData.symbol}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-white border border-violet-200 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors"
              >
                {isAutoClassifying ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                自动识别名称与行业
              </button>
              <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">行业可留空。保存时会自动补齐；如您手动填写，则以人工内容为准。</p>
            </div>
            <button 
              onClick={handleSave} 
              disabled={isSaving}
              className="w-full py-2.5 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-70 mt-2 flex items-center justify-center gap-2 shadow-sm"
            >
              {isSaving ? '保存中...' : <><Save size={16}/> 单条入库</>}
            </button>
          </div>
        </div>

        {/* 右侧：云端列表展示（带筛选） */}
        <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-[600px] h-[calc(100vh-140px)]">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <svg className="animate-spin h-8 w-8 text-indigo-500 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto flex-1 relative scrollbar-thin">
              <table className="min-w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 sticky top-0 z-10 shadow-sm [&>tr>th]:bg-slate-50">
                  <tr>
                    {renderFilterTh('代码', 'symbol')}
                    {renderFilterTh('币种', 'currency', 'center')}
                    {renderFilterTh('名称', 'name')}
                    {renderFilterTh('一级行业', 'sector_level_1')}
                    {renderFilterTh('二级行业', 'sector_level_2')}
                    <th className="px-5 py-3 text-right whitespace-nowrap align-top">
                      <div className="font-semibold text-slate-600 mb-2">操作</div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStocks.length > 0 ? filteredStocks.map((s: any) => (
                    <tr key={s.symbol} className="hover:bg-indigo-50/30 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-indigo-600">{s.symbol}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="bg-slate-100 text-slate-600 font-mono text-[10px] px-2 py-0.5 rounded border border-slate-200">
                          {s.currency || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                      <td className="px-4 py-3">
                        {!isMissingClassification(s.sector_level_1) ? (
                          <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded text-xs border border-blue-100 font-medium">
                            {s.sector_level_1}
                          </span>
                        ) : <span className="text-slate-300 text-xs">-</span>}
                      </td>
                      <td className="px-4 py-3">
                        {!isMissingClassification(s.sector_level_2) ? (
                          <div className="flex items-center gap-1.5">
                            <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded text-xs border border-emerald-100 font-medium">
                              {s.sector_level_2}
                            </span>
                            {['sip_curated', 'yahoo_finance', 'fallback'].includes(s.classification_source) && (
                              <span className="text-[9px] rounded-full bg-violet-50 border border-violet-100 px-1.5 py-0.5 text-violet-600" title={s.classification_reason || '自动分类'}>自动</span>
                            )}
                          </div>
                        ) : <span className="text-slate-300 text-xs">-</span>}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <button onClick={() => fillForm(s)} className="text-indigo-600 hover:text-indigo-800 font-medium mr-4 transition-colors">编辑</button>
                        <button onClick={() => handleDelete(s.symbol)} className="text-red-500 hover:text-red-700 font-medium transition-colors">删除</button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6} className="p-16 text-center">
                        <div className="flex flex-col items-center justify-center text-slate-400">
                          <Search size={32} className="mb-3 text-slate-300" />
                          <p className="font-medium text-slate-500">未找到匹配的股票数据</p>
                          <p className="text-xs mt-1">请尝试清除筛选条件或导入新数据</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ========================================== */}
      {/* 📥 Excel 导入与预览大弹窗 */}
      {/* ========================================== */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <FileSpreadsheet className="text-indigo-600" size={20} />
                  批量导入股票数据 (Excel Paste)
                </h3>
                <p className="text-xs text-slate-500 mt-1">从 Excel 直接复制区域并粘贴。名称和行业可留空，美股、港股、A 股及日本股票会在写入时自动补齐；人工分类优先。</p>
              </div>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600 bg-white p-1.5 rounded-full shadow-sm border transition-colors"><X size={20}/></button>
            </div>

            {/* Modal Body: Two Columns */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Column: Textarea */}
              <div className="w-1/3 border-r flex flex-col bg-white">
                <div className="px-4 py-2 bg-slate-100 border-b text-xs font-bold text-slate-600 flex justify-between items-center">
                  <span>数据源粘贴区</span>
                  <span className="text-indigo-500 font-mono bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">必须以 Tab 分隔</span>
                </div>
                <div className="p-4 flex-1">
                  <textarea 
                    className="w-full h-full border border-slate-300 rounded-md p-3 text-xs font-mono focus:ring-2 focus:ring-indigo-500 outline-none resize-none whitespace-pre"
                    placeholder="【请在此处粘贴 Excel 内容】&#10;&#10;预期列顺序：&#10;代码 | 币种 | 名称（可空） | 一级行业（可空） | 二级行业（可空）&#10;&#10;示例：&#10;AAPL&#9;USD&#10;0700.HK&#9;HKD&#9;腾讯控股&#10;600519&#9;CNY&#10;7203&#9;JPY"
                    value={pasteText}
                    onChange={handlePasteChange}
                  ></textarea>
                </div>
              </div>

              {/* Right Column: Preview Table */}
              <div className="w-2/3 flex flex-col bg-slate-50">
                <div className="px-4 py-2 bg-slate-100 border-b text-xs font-bold text-slate-600 flex justify-between items-center">
                  <span>数据结构预览区</span>
                  <span className="text-slate-500">解析成功: <strong className="text-indigo-600">{previewData.length}</strong> 行</span>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  {previewData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-slate-400 border-2 border-dashed border-slate-300 rounded-lg bg-white">
                      等待粘贴数据...
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
                      <table className="min-w-full text-xs text-left">
                        <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 shadow-sm">
                          <tr>
                            <th className="px-3 py-2 w-24">代码 (必填)</th>
                            <th className="px-3 py-2 w-20">币种</th>
                            <th className="px-3 py-2 w-32">名称 (可自动)</th>
                            <th className="px-3 py-2 w-24">一级行业</th>
                            <th className="px-3 py-2 w-24">二级行业</th>
                            <th className="px-3 py-2 w-10 text-center">删</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewData.map((row, idx) => (
                            <tr key={idx} className="hover:bg-indigo-50/50 transition-colors">
                              <td className="px-2 py-1.5">
                                <input type="text" value={row.symbol} onChange={(e) => handlePreviewChange(idx, 'symbol', e.target.value)} className="w-full p-1 border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white bg-transparent outline-none font-mono font-bold text-indigo-700" placeholder="缺失" />
                              </td>
                              <td className="px-2 py-1.5">
                                <input type="text" value={row.currency} onChange={(e) => handlePreviewChange(idx, 'currency', e.target.value)} className="w-full p-1 border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white bg-transparent outline-none font-mono text-slate-600" placeholder="USD" />
                              </td>
                              <td className="px-2 py-1.5">
                                <input type="text" value={row.name} onChange={(e) => handlePreviewChange(idx, 'name', e.target.value)} className="w-full p-1 border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white bg-transparent outline-none" placeholder="缺失" />
                              </td>
                              <td className="px-2 py-1.5">
                                <input type="text" value={row.sector_level_1} onChange={(e) => handlePreviewChange(idx, 'sector_level_1', e.target.value)} className="w-full p-1 border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white bg-transparent outline-none text-slate-500" />
                              </td>
                              <td className="px-2 py-1.5">
                                <input type="text" value={row.sector_level_2} onChange={(e) => handlePreviewChange(idx, 'sector_level_2', e.target.value)} className="w-full p-1 border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white bg-transparent outline-none text-slate-500" />
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                <button onClick={() => handleRemovePreviewRow(idx)} className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors" title="移除此行">
                                  <Trash2 size={14}/>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500"><Sparkles size={13} className="inline mr-1 text-violet-600" />缺失名称或行业将在写入前自动识别，手动内容保持不变。</span>
              <div className="flex gap-3">
              <button 
                onClick={() => { setShowImportModal(false); setPasteText(''); setPreviewData([]); }} 
                className="px-5 py-2.5 rounded-md text-slate-700 font-bold bg-white border border-slate-300 hover:bg-slate-100 transition-colors shadow-sm text-sm"
              >
                取消导入
              </button>
              <button 
                onClick={handleBatchImport} 
                disabled={previewData.length === 0 || isMigrating} 
                className="px-6 py-2.5 rounded-md text-white font-bold flex items-center gap-2 transition-all shadow-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-sm"
              >
                {isMigrating ? <span className="animate-pulse">数据覆盖入库中...</span> : <><Save size={16}/> 确认无误，批量写入</>}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* 📤 导出为 Excel 文本模态框 */}
      {/* ========================================== */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[70vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  📤 导出数据以供 Excel 使用
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  以下文本已经通过制表符 (Tab) 对齐，支持您刚做的多维筛选结果。点击右下角“一键复制”后，即可前往空白 Excel 表格中直接粘贴 (Ctrl+V)。
                </p>
              </div>
              <button 
                onClick={() => setShowExportModal(false)} 
                className="text-slate-400 hover:text-slate-600 bg-white p-1.5 rounded-full shadow-sm border transition-colors"
              >
                <X size={20}/>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 p-6 bg-slate-100/50 overflow-hidden flex flex-col">
               <textarea 
                  className="w-full h-full border border-slate-300 rounded-md p-4 text-xs font-mono focus:ring-2 focus:ring-emerald-500 outline-none resize-none whitespace-pre bg-white shadow-inner"
                  value={exportText}
                  readOnly
               ></textarea>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t bg-slate-50 flex justify-between items-center gap-3">
               <span className="text-xs text-slate-500 font-mono">共计 {filteredStocks.length} 条数据准备就绪。</span>
               <div className="flex gap-3">
                <button 
                  onClick={() => setShowExportModal(false)} 
                  className="px-5 py-2.5 rounded-md text-slate-700 font-bold bg-white border border-slate-300 hover:bg-slate-100 transition-colors shadow-sm text-sm"
                >
                  关闭
                </button>
                <button 
                  onClick={copyToClipboard} 
                  className="px-6 py-2.5 rounded-md text-white font-bold flex items-center gap-2 transition-all shadow-md bg-emerald-600 hover:bg-emerald-700 text-sm"
                >
                  📋 一键复制全部内容
                </button>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { AlertTriangle, Edit3, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { APP_ID, db } from '@/app/lib/stockService';
import {
  CORPORATE_ACTION_COLLECTION,
  CorporateActionRecord,
  CorporateActionType,
  normalizeTickerForCorporateAction,
} from '@/app/book/SP_wjhh1/lib/corporateActionEngine';

const ADMIN_PASSWORD = '25210228';
const INPUT_CLASS = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

const emptyForm: CorporateActionRecord = {
  ticker: '',
  market: 'USD',
  actionType: 'split',
  effectiveDate: '',
  oldShares: 1,
  newShares: 1,
  note: '',
};

export default function CorporateActionsAdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [records, setRecords] = useState<CorporateActionRecord[]>([]);
  const [formData, setFormData] = useState<CorporateActionRecord>(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (isAuthenticated) loadRecords();
  }, [isAuthenticated]);

  const filteredRecords = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    if (!keyword) return records;
    return records.filter((record) => {
      return [
        record.ticker,
        record.market,
        record.actionType,
        record.effectiveDate,
        record.note,
      ].some((value) => String(value || '').toLowerCase().includes(keyword));
    });
  }, [records, filter]);

  const factor = calculateFactor(formData);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', CORPORATE_ACTION_COLLECTION));
      const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() } as CorporateActionRecord));
      rows.sort((a, b) => String(b.effectiveDate || '').localeCompare(String(a.effectiveDate || '')));
      setRecords(rows);
    } catch (error) {
      console.error(error);
      alert('读取拆/合股详情失败，请检查 Firebase 连接。');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    if (passwordInput !== ADMIN_PASSWORD) {
      alert('管理员密码不正确。');
      return;
    }
    setIsAuthenticated(true);
  };

  const resetForm = () => {
    setFormData(emptyForm);
    setEditingId('');
  };

  const handleSave = async () => {
    const ticker = normalizeTickerForCorporateAction(formData.ticker);
    if (!ticker) return alert('请填写股票代码。');
    if (!formData.effectiveDate) return alert('请填写生效日期。');
    if (!Number.isFinite(factor) || factor <= 0) return alert('原股数和新股数必须大于 0。');

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const docId = editingId || `${ticker}_${formData.effectiveDate}_${formData.actionType}`;
      const payload: CorporateActionRecord = {
        ...formData,
        ticker,
        market: String(formData.market || '').trim().toUpperCase(),
        oldShares: Number(formData.oldShares),
        newShares: Number(formData.newShares),
        factor,
        updatedAt: now,
        createdAt: editingId ? formData.createdAt : now,
      };
      await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', CORPORATE_ACTION_COLLECTION, docId), payload, { merge: true });
      await loadRecords();
      resetForm();
    } catch (error) {
      console.error(error);
      alert('保存失败，请检查控制台。');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (record: CorporateActionRecord) => {
    setEditingId(record.id || '');
    setFormData({
      ...emptyForm,
      ...record,
      oldShares: Number(record.oldShares || 1),
      newShares: Number(record.newShares || 1),
    });
  };

  const handleDelete = async (record: CorporateActionRecord) => {
    if (!record.id) return;
    if (!confirm(`确认删除 ${record.ticker} ${record.effectiveDate} 的拆/合股记录？这会影响所有引用该公司行动的计算。`)) return;
    try {
      await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', CORPORATE_ACTION_COLLECTION, record.id));
      await loadRecords();
      if (editingId === record.id) resetForm();
    } catch (error) {
      console.error(error);
      alert('删除失败，请检查控制台。');
    }
  };

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-10">
        <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-blue-600">Developer Options</p>
          <h1 className="mt-3 text-2xl font-black text-slate-900">拆/合股详情</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            这是全局公司行动库，会影响 FCN、Option、DQ-AQ、现货和风险暴露等模块。请输入管理员密码继续。
          </p>
          <input
            type="password"
            value={passwordInput}
            onChange={(event) => setPasswordInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && handleLogin()}
            placeholder="管理员密码"
            className="mt-6 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
          />
          <button
            onClick={handleLogin}
            className="mt-4 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700"
          >
            进入管理
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f3eb] px-6 py-8 text-slate-900">
      <section className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-[2rem] bg-slate-950 p-8 text-white shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-300">Global Corporate Actions</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight">拆/合股详情</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
            本页面只维护人工条款和交易记录的口径转换规则。历史行情数据默认由数据源自行复权，不在这里重复调整。
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black">{editingId ? '编辑记录' : '新增记录'}</h2>
                <p className="mt-1 text-xs text-slate-500">例：NVDA 1 拆 10，原股数=1，新股数=10。</p>
              </div>
              <button onClick={resetForm} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50">
                清空
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <Field label="股票代码">
                <input value={formData.ticker} onChange={(event) => setFormData((prev) => ({ ...prev, ticker: event.target.value }))} className={INPUT_CLASS} placeholder="NVDA / 0700.HK" />
              </Field>
              <Field label="币种">
                <select value={formData.market || 'USD'} onChange={(event) => setFormData((prev) => ({ ...prev, market: event.target.value }))} className={INPUT_CLASS}>
                  <option value="USD">USD</option>
                  <option value="HKD">HKD</option>
                  <option value="JPY">JPY</option>
                  <option value="CNY">CNY</option>
                </select>
              </Field>
              <Field label="类型">
                <select value={formData.actionType} onChange={(event) => setFormData((prev) => ({ ...prev, actionType: event.target.value as CorporateActionType }))} className={INPUT_CLASS}>
                  <option value="split">拆股</option>
                  <option value="reverse_split">合股</option>
                </select>
              </Field>
              <Field label="生效日期">
                <input type="date" value={formData.effectiveDate} onChange={(event) => setFormData((prev) => ({ ...prev, effectiveDate: event.target.value }))} className={INPUT_CLASS} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="原股数">
                  <input type="number" step="0.000001" value={formData.oldShares} onChange={(event) => setFormData((prev) => ({ ...prev, oldShares: Number(event.target.value) }))} className={INPUT_CLASS} />
                </Field>
                <Field label="新股数">
                  <input type="number" step="0.000001" value={formData.newShares} onChange={(event) => setFormData((prev) => ({ ...prev, newShares: Number(event.target.value) }))} className={INPUT_CLASS} />
                </Field>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                调整因子：<span className="font-black">{Number.isFinite(factor) ? factor.toFixed(6) : '--'}</span>
                <span className="ml-2 text-xs">价格除以因子，股数乘以因子。</span>
              </div>
              <Field label="备注">
                <textarea value={formData.note || ''} onChange={(event) => setFormData((prev) => ({ ...prev, note: event.target.value }))} className={`${INPUT_CLASS} min-h-[92px]`} placeholder="来源、公告链接或手工说明" />
              </Field>
            </div>

            <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs leading-6 text-rose-700">
              <div className="flex items-start gap-2 font-bold">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                保存后会影响引用该股票的条款标准化计算，请确认生效日期和比例无误。
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {saving ? '保存中...' : editingId ? '保存修改' : '新增记录'}
            </button>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">全局记录</h2>
                <p className="mt-1 text-xs text-slate-500">当前共 {records.length} 条，筛选后 {filteredRecords.length} 条。</p>
              </div>
              <div className="flex items-center gap-2">
                <input value={filter} onChange={(event) => setFilter(event.target.value)} className={`${INPUT_CLASS} w-64`} placeholder="模糊搜索代码/币种/备注" />
                <button onClick={loadRecords} className="rounded-2xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50">
                  {loading ? '刷新中...' : '刷新'}
                </button>
              </div>
            </div>

            <div className="mt-5 max-h-[620px] overflow-auto rounded-2xl border border-slate-200">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 text-slate-600">
                  <tr>
                    <th className="px-3 py-3">股票代码</th>
                    <th className="px-3 py-3">币种</th>
                    <th className="px-3 py-3">类型</th>
                    <th className="px-3 py-3">生效日期</th>
                    <th className="px-3 py-3 text-right">原股数</th>
                    <th className="px-3 py-3 text-right">新股数</th>
                    <th className="px-3 py-3 text-right">因子</th>
                    <th className="px-3 py-3">备注</th>
                    <th className="px-3 py-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">读取中...</td></tr>
                  ) : filteredRecords.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">暂无记录</td></tr>
                  ) : filteredRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-blue-50/40">
                      <td className="px-3 py-3 font-black text-slate-900">{record.ticker}</td>
                      <td className="px-3 py-3 font-mono text-slate-500">{record.market || '-'}</td>
                      <td className="px-3 py-3">{record.actionType === 'split' ? '拆股' : '合股'}</td>
                      <td className="px-3 py-3 font-mono">{record.effectiveDate}</td>
                      <td className="px-3 py-3 text-right font-mono">{record.oldShares}</td>
                      <td className="px-3 py-3 text-right font-mono">{record.newShares}</td>
                      <td className="px-3 py-3 text-right font-mono font-black">{calculateFactor(record).toFixed(6)}</td>
                      <td className="max-w-[260px] truncate px-3 py-3 text-slate-500" title={record.note || ''}>{record.note || '-'}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => handleEdit(record)} className="rounded-xl border border-purple-200 bg-white p-2 text-purple-600 hover:bg-purple-50" title="编辑">
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleDelete(record)} className="rounded-xl border border-rose-200 bg-white p-2 text-rose-600 hover:bg-rose-50" title="删除">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-black text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function calculateFactor(record: Pick<CorporateActionRecord, 'oldShares' | 'newShares'>) {
  const oldShares = Number(record.oldShares);
  const newShares = Number(record.newShares);
  if (!Number.isFinite(oldShares) || oldShares <= 0 || !Number.isFinite(newShares) || newShares <= 0) return NaN;
  return newShares / oldShares;
}

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { Database, FileSpreadsheet, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { signInAnonymously } from 'firebase/auth';
import { APP_ID, auth, db } from '@/app/lib/stockService';

const ADMIN_PASSWORD = '25210228';
const COLLECTION_NAME = 'sip_index_constituents';
const INPUT_CLASS = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

type IndexConstituent = {
  id?: string;
  indexCode: string;
  indexName?: string;
  symbol: string;
  name?: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
};

const emptyForm: IndexConstituent = {
  indexCode: '',
  indexName: '',
  symbol: '',
  name: '',
  note: '',
};

export default function IndexConstituentsAdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [records, setRecords] = useState<IndexConstituent[]>([]);
  const [formData, setFormData] = useState<IndexConstituent>(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [deleteIndexCode, setDeleteIndexCode] = useState('');
  const [deletingIndex, setDeletingIndex] = useState(false);

  useEffect(() => {
    if (isAuthenticated) loadRecords();
  }, [isAuthenticated]);

  const filteredRecords = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    if (!keyword) return records;
    return records.filter((record) => [
      record.indexCode,
      record.indexName,
      record.symbol,
      record.name,
      record.note,
    ].some((value) => String(value || '').toLowerCase().includes(keyword)));
  }, [filter, records]);

  const indexGroups = useMemo(() => {
    const map = new Map<string, { indexCode: string; indexName: string; count: number }>();
    records.forEach((record) => {
      const key = normalizeCode(record.indexCode);
      if (!key) return;
      const existing = map.get(key) || { indexCode: key, indexName: record.indexName || '', count: 0 };
      existing.count += 1;
      if (!existing.indexName && record.indexName) existing.indexName = record.indexName;
      map.set(key, existing);
    });
    return Array.from(map.values()).sort((a, b) => a.indexCode.localeCompare(b.indexCode));
  }, [records]);

  const login = () => {
    if (passwordInput !== ADMIN_PASSWORD) {
      alert('管理员密码不正确。');
      return;
    }
    setIsAuthenticated(true);
  };

  const ensureAuth = async () => {
    if (!auth.currentUser) await signInAnonymously(auth);
  };

  const loadRecords = async () => {
    setLoading(true);
    try {
      await ensureAuth();
      const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', COLLECTION_NAME));
      const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() } as IndexConstituent));
      rows.sort((a, b) => `${a.indexCode}_${a.symbol}`.localeCompare(`${b.indexCode}_${b.symbol}`));
      setRecords(rows);
    } catch (error) {
      console.error(error);
      alert('读取指数成分股库失败，请检查 Firebase 连接。');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setEditingId('');
    setFormData(emptyForm);
  };

  const saveRecord = async () => {
    const indexCode = normalizeCode(formData.indexCode);
    const symbol = normalizeCode(formData.symbol);
    if (!indexCode || !symbol) return alert('指数代码和成分股代码必填。');

    setSaving(true);
    try {
      await ensureAuth();
      const now = new Date().toISOString();
      const docId = editingId || buildDocId(indexCode, symbol);
      await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', COLLECTION_NAME, docId), {
        ...formData,
        indexCode,
        symbol,
        indexName: formData.indexName?.trim() || '',
        name: formData.name?.trim() || '',
        note: formData.note?.trim() || '',
        createdAt: editingId ? formData.createdAt : now,
        updatedAt: now,
      }, { merge: true });
      await loadRecords();
      resetForm();
    } catch (error) {
      console.error(error);
      alert('保存失败，请检查控制台。');
    } finally {
      setSaving(false);
    }
  };

  const editRecord = (record: IndexConstituent) => {
    setEditingId(record.id || '');
    setFormData({ ...emptyForm, ...record });
  };

  const deleteRecord = async (record: IndexConstituent) => {
    if (!record.id) return;
    if (!confirm(`确认删除 ${record.indexCode} / ${record.symbol}？`)) return;
    await ensureAuth();
    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', COLLECTION_NAME, record.id));
    await loadRecords();
    if (editingId === record.id) resetForm();
  };

  const deleteIndexGroup = async () => {
    const targetCode = normalizeCode(deleteIndexCode);
    if (!targetCode) return alert('请先选择需要删除的指数代码。');
    const targets = records.filter((record) => normalizeCode(record.indexCode) === targetCode && record.id);
    if (!targets.length) return alert(`没有找到 ${targetCode} 的成分股记录。`);
    if (!confirm(`确认删除指数 ${targetCode} 下的 ${targets.length} 条成分股记录？此操作不可撤销。`)) return;

    setDeletingIndex(true);
    try {
      await ensureAuth();
      const batch = writeBatch(db);
      targets.forEach((record) => {
        if (!record.id) return;
        batch.delete(doc(db, 'artifacts', APP_ID, 'public', 'data', COLLECTION_NAME, record.id));
      });
      await batch.commit();
      if (targets.some((record) => record.id === editingId)) resetForm();
      setDeleteIndexCode('');
      await loadRecords();
    } catch (error) {
      console.error(error);
      alert('按指数批量删除失败，请检查控制台。');
    } finally {
      setDeletingIndex(false);
    }
  };

  const importPaste = async () => {
    const rows = parsePasteRows(pasteText);
    if (!rows.length) return alert('没有识别到可导入的数据。');
    if (!confirm(`确认导入/覆盖 ${rows.length} 条指数成分股记录？`)) return;

    setSaving(true);
    try {
      await ensureAuth();
      const batch = writeBatch(db);
      const now = new Date().toISOString();
      rows.forEach((row) => {
        const docId = buildDocId(row.indexCode, row.symbol);
        batch.set(doc(db, 'artifacts', APP_ID, 'public', 'data', COLLECTION_NAME, docId), {
          ...row,
          createdAt: now,
          updatedAt: now,
        }, { merge: true });
      });
      await batch.commit();
      setPasteText('');
      await loadRecords();
    } catch (error) {
      console.error(error);
      alert('批量导入失败，请检查控制台。');
    } finally {
      setSaving(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-10">
        <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-blue-600">Developer Options</p>
          <h1 className="mt-3 text-2xl font-black text-slate-900">指数股票池</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            维护指数代码与成分股代码的映射，供量化分析中的广度牛熊分析使用。
          </p>
          <input
            type="password"
            value={passwordInput}
            onChange={(event) => setPasswordInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && login()}
            placeholder="管理员密码"
            className={INPUT_CLASS + ' mt-6'}
          />
          <button onClick={login} className="mt-4 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700">
            进入管理
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f3eb] px-6 py-8 text-slate-900">
      <section className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[2rem] bg-slate-950 p-8 text-white shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-300">Index Constituents</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight">指数股票池</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
            第一版只维护指数代码和成分股代码。指数代码建议使用 /api/history 可识别的行情代码，例如 ^HSI、^GSPC、^NDX。
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          <SummaryCard label="指数数量" value={indexGroups.length.toString()} />
          <SummaryCard label="成分股记录" value={records.length.toString()} />
          <SummaryCard label="筛选结果" value={filteredRecords.length.toString()} />
          <SummaryCard label="数据库" value={COLLECTION_NAME} small />
        </section>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <section className="space-y-5">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black">{editingId ? '编辑记录' : '新增记录'}</h2>
                  <p className="mt-1 text-xs text-slate-500">最少填写指数代码和成分股代码。</p>
                </div>
                <button onClick={resetForm} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50">
                  清空
                </button>
              </div>
              <div className="mt-5 grid gap-4">
                <Field label="指数代码">
                  <input value={formData.indexCode} onChange={(event) => setFormData((prev) => ({ ...prev, indexCode: event.target.value }))} className={INPUT_CLASS} placeholder="^HSI / ^GSPC" />
                </Field>
                <Field label="指数名称（可选）">
                  <input value={formData.indexName || ''} onChange={(event) => setFormData((prev) => ({ ...prev, indexName: event.target.value }))} className={INPUT_CLASS} placeholder="恒生指数 / S&P 500" />
                </Field>
                <Field label="成分股代码">
                  <input value={formData.symbol} onChange={(event) => setFormData((prev) => ({ ...prev, symbol: event.target.value }))} className={INPUT_CLASS} placeholder="0700.HK / NVDA" />
                </Field>
                <Field label="成分股名称（可选）">
                  <input value={formData.name || ''} onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))} className={INPUT_CLASS} placeholder="腾讯控股" />
                </Field>
                <Field label="备注（可选）">
                  <textarea value={formData.note || ''} onChange={(event) => setFormData((prev) => ({ ...prev, note: event.target.value }))} className={`${INPUT_CLASS} min-h-[88px]`} />
                </Field>
              </div>
              <button onClick={saveRecord} disabled={saving} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {saving ? '保存中...' : editingId ? '保存修改' : '新增记录'}
              </button>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                <h2 className="text-lg font-black">Excel 一键粘贴导入</h2>
              </div>
              <p className="mt-2 text-xs leading-6 text-slate-500">
                格式：指数代码 / 指数名称 / 成分股代码 / 成分股名称 / 备注。也支持只有“指数代码 + 成分股代码”两列。
              </p>
              <textarea
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                className={`${INPUT_CLASS} mt-4 min-h-[180px] font-mono`}
                placeholder={'^HSI\t恒生指数\t0700.HK\t腾讯控股\n^HSI\t恒生指数\t0005.HK\t汇丰控股'}
              />
              <button onClick={importPaste} disabled={saving || !pasteText.trim()} className="mt-4 w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-50">
                批量导入 / 覆盖
              </button>
            </div>

            <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-rose-600" />
                <h2 className="text-lg font-black text-rose-900">按指数代码一键删除</h2>
              </div>
              <p className="mt-2 text-xs leading-6 text-rose-700">
                只会删除所选指数代码下的成分股记录，不会影响其它指数股票池。删除前会再次确认数量。
              </p>
              <select
                value={deleteIndexCode}
                onChange={(event) => setDeleteIndexCode(event.target.value)}
                className={`${INPUT_CLASS} mt-4 border-rose-200 focus:border-rose-500 focus:ring-rose-100`}
              >
                <option value="">选择需要删除的指数</option>
                {indexGroups.map((group) => (
                  <option key={group.indexCode} value={group.indexCode}>
                    {group.indexName || group.indexCode} ({group.indexCode}) · {group.count} 条
                  </option>
                ))}
              </select>
              <button
                onClick={deleteIndexGroup}
                disabled={deletingIndex || !deleteIndexCode}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {deletingIndex ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {deletingIndex ? '删除中...' : '删除该指数全部成分股'}
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">指数成分股库</h2>
                <p className="mt-1 text-xs text-slate-500">按指数代码和成分股代码唯一覆盖。</p>
              </div>
              <div className="flex items-center gap-2">
                <input value={filter} onChange={(event) => setFilter(event.target.value)} className={`${INPUT_CLASS} w-64`} placeholder="搜索指数/股票/名称" />
                <button onClick={loadRecords} className="rounded-2xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50">
                  {loading ? '刷新中...' : '刷新'}
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {indexGroups.map((group) => (
                <span key={group.indexCode} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                  {group.indexName || group.indexCode} · {group.count}
                </span>
              ))}
            </div>

            <div className="mt-5 max-h-[680px] overflow-auto rounded-2xl border border-slate-200">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 text-slate-600">
                  <tr>
                    <th className="px-3 py-3">指数代码</th>
                    <th className="px-3 py-3">指数名称</th>
                    <th className="px-3 py-3">成分股代码</th>
                    <th className="px-3 py-3">成分股名称</th>
                    <th className="px-3 py-3">备注</th>
                    <th className="px-3 py-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">读取中...</td></tr>
                  ) : filteredRecords.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">暂无记录</td></tr>
                  ) : filteredRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-blue-50/40">
                      <td className="px-3 py-3 font-mono font-black text-slate-900">{record.indexCode}</td>
                      <td className="px-3 py-3 text-slate-500">{record.indexName || '-'}</td>
                      <td className="px-3 py-3 font-mono font-black text-blue-700">{record.symbol}</td>
                      <td className="px-3 py-3 text-slate-600">{record.name || '-'}</td>
                      <td className="max-w-[260px] truncate px-3 py-3 text-slate-500" title={record.note || ''}>{record.note || '-'}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => editRecord(record)} className="rounded-xl border border-purple-200 bg-white p-2 text-purple-600 hover:bg-purple-50" title="编辑">
                            <Save className="h-4 w-4" />
                          </button>
                          <button onClick={() => deleteRecord(record)} className="rounded-xl border border-rose-200 bg-white p-2 text-rose-600 hover:bg-rose-50" title="删除">
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

function SummaryCard({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-400">
        <Database className="h-4 w-4" /> {label}
      </div>
      <div className={`mt-2 font-black text-slate-900 ${small ? 'text-sm' : 'text-3xl'}`}>{value}</div>
    </div>
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

function normalizeCode(value: string) {
  return String(value || '').trim().toUpperCase();
}

function buildDocId(indexCode: string, symbol: string) {
  return `${indexCode}__${symbol}`.replace(/[^A-Z0-9._^-]+/gi, '_');
}

function parsePasteRows(text: string): IndexConstituent[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|,/).map((cell) => cell.trim()))
    .map((cells) => {
      if (cells.length >= 4) {
        return {
          indexCode: normalizeCode(cells[0]),
          indexName: cells[1] || '',
          symbol: normalizeCode(cells[2]),
          name: cells[3] || '',
          note: cells[4] || '',
        };
      }
      return {
        indexCode: normalizeCode(cells[0]),
        symbol: normalizeCode(cells[1]),
        indexName: '',
        name: '',
        note: cells[2] || '',
      };
    })
    .filter((row) => row.indexCode && row.symbol);
}

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Code2, Edit3, Eye, Loader2, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { db, auth, APP_ID } from '@/app/lib/stockService';

interface ResearchNote {
  noteID: string;
  target: string;
  author: string;
  htmlContent: string;
  note: string;
  plainTextPreview: string;
  createdAt: string;
  updatedAt: string;
}

type SortDir = 'desc' | 'asc';

const COLLECTION_NAME = 'sip_research_library';

const emptyDraft = {
  target: '',
  author: '',
  note: '',
  htmlContent: '',
};

const formatTime = (value: string) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

const makeNoteID = () => {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SIP-NOTE-${date}-${suffix}`;
};

const htmlToPreview = (html: string) => {
  if (typeof window === 'undefined') return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 180);
};

const isFullHtmlDocument = (html: string) => /<!doctype html|<html[\s>]/i.test(html);

const sanitizeFullHtmlDocument = (html: string) => {
  if (typeof window === 'undefined') return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  doc.querySelectorAll('script, iframe, object, embed').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      const isEventHandler = name.startsWith('on');
      const isUnsafeUrl = ['href', 'src'].includes(name) && /^javascript:/i.test(value);

      if (isEventHandler || isUnsafeUrl) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
};

const sanitizeHtml = (html: string) => {
  if (typeof window === 'undefined') return '';

  const allowedTags = new Set([
    'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4',
    'HR', 'I', 'IMG', 'LI', 'OL', 'P', 'PRE', 'SPAN', 'STRONG', 'TABLE', 'TBODY',
    'TD', 'TH', 'THEAD', 'TR', 'U', 'UL',
  ]);
  const allowedAttrs = new Set(['href', 'src', 'alt', 'title', 'target', 'rel', 'colspan', 'rowspan']);
  const template = document.createElement('template');
  template.innerHTML = html;

  const cleanNode = (node: Node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!allowedTags.has(el.tagName)) {
          el.replaceWith(...Array.from(el.childNodes));
          return;
        }

        Array.from(el.attributes).forEach((attr) => {
          const name = attr.name.toLowerCase();
          const value = attr.value.trim();
          const isEventHandler = name.startsWith('on');
          const isUnsafeUrl = ['href', 'src'].includes(name) && /^javascript:/i.test(value);
          const isAllowed = allowedAttrs.has(name);

          if (!isAllowed || isEventHandler || isUnsafeUrl) {
            el.removeAttribute(attr.name);
          }
        });

        if (el.tagName === 'A') {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }

        cleanNode(el);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.remove();
      }
    });
  };

  cleanNode(template.content);
  return template.innerHTML;
};

export default function SipResearchLibraryPage() {
  const [userReady, setUserReady] = useState(false);
  const [records, setRecords] = useState<ResearchNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({
    target: '',
    author: '',
    note: '',
  });
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [editorOpen, setEditorOpen] = useState(false);
  const [viewerRecord, setViewerRecord] = useState<ResearchNote | null>(null);
  const [editingRecord, setEditingRecord] = useState<ResearchNote | null>(null);
  const [draft, setDraft] = useState(emptyDraft);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const initAuth = async () => {
      if (!auth.currentUser) {
        // @ts-ignore
        if (typeof window !== 'undefined' && window.__initial_auth_token) {
          // @ts-ignore
          await signInWithCustomToken(auth, window.__initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      }

      unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setUserReady(!!currentUser);
      });
    };

    initAuth();
    return () => unsubscribe?.();
  }, []);

  const loadRecords = async () => {
    if (!userReady) return;
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', COLLECTION_NAME));
      const list: ResearchNote[] = [];
      snap.forEach((item) => {
        const data = item.data();
        list.push({
          noteID: data.noteID || item.id,
          target: data.target || '',
          author: data.author || '',
          htmlContent: data.htmlContent || '',
          note: data.note || '',
          plainTextPreview: data.plainTextPreview || '',
          createdAt: data.createdAt || '',
          updatedAt: data.updatedAt || '',
        });
      });
      setRecords(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [userReady]);

  const filteredRecords = useMemo(() => {
    const targetQuery = filters.target.trim().toUpperCase();
    const authorQuery = filters.author.trim().toUpperCase();
    const noteQuery = filters.note.trim().toUpperCase();
    const filtered = records.filter((record) => (
      (!targetQuery || record.target.toUpperCase().includes(targetQuery)) &&
      (!authorQuery || record.author.toUpperCase().includes(authorQuery)) &&
      (!noteQuery || record.note.toUpperCase().includes(noteQuery))
    ));

    return [...filtered].sort((a, b) => {
      const left = new Date(a.updatedAt || a.createdAt).getTime() || 0;
      const right = new Date(b.updatedAt || b.createdAt).getTime() || 0;
      return sortDir === 'asc' ? left - right : right - left;
    });
  }, [filters, records, sortDir]);

  const openCreate = () => {
    setEditingRecord(null);
    setDraft(emptyDraft);
    setEditorOpen(true);
  };

  const openEdit = (record: ResearchNote) => {
    setEditingRecord(record);
    setDraft({
      target: record.target,
      author: record.author,
      note: record.note,
      htmlContent: record.htmlContent,
    });
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (!draft.target.trim()) {
      alert('请填写标的');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const noteID = editingRecord?.noteID || makeNoteID();
      const payload: ResearchNote = {
        noteID,
        target: draft.target.trim(),
        author: draft.author.trim(),
        note: draft.note.trim(),
        htmlContent: draft.htmlContent,
        plainTextPreview: htmlToPreview(draft.htmlContent),
        createdAt: editingRecord?.createdAt || now,
        updatedAt: now,
      };

      await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', COLLECTION_NAME, noteID), payload);
      setEditorOpen(false);
      setEditingRecord(null);
      setDraft(emptyDraft);
      await loadRecords();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: ResearchNote) => {
    const ok = window.confirm(`确定删除 ${record.noteID} 吗？`);
    if (!ok) return;
    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', COLLECTION_NAME, record.noteID));
    await loadRecords();
  };

  const FilterTh = ({ label, filterKey }: { label: string; filterKey: 'target' | 'author' | 'note' }) => (
    <th className="px-4 py-3 align-top">
      <div className="font-bold text-slate-500">{label}</div>
      <input
        value={filters[filterKey]}
        onChange={(event) => setFilters((prev) => ({ ...prev, [filterKey]: event.target.value }))}
        placeholder="筛选"
        className="mt-1 w-full min-w-[90px] rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-normal text-gray-700 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
      />
    </th>
  );

  const sanitizedDraft = useMemo(() => sanitizeHtml(draft.htmlContent), [draft.htmlContent]);
  const sanitizedViewer = useMemo(() => sanitizeHtml(viewerRecord?.htmlContent || ''), [viewerRecord]);
  const draftIsFullDocument = useMemo(() => isFullHtmlDocument(draft.htmlContent), [draft.htmlContent]);
  const viewerIsFullDocument = useMemo(() => isFullHtmlDocument(viewerRecord?.htmlContent || ''), [viewerRecord]);
  const draftIframeDoc = useMemo(() => sanitizeFullHtmlDocument(draft.htmlContent), [draft.htmlContent]);
  const viewerIframeDoc = useMemo(() => sanitizeFullHtmlDocument(viewerRecord?.htmlContent || ''), [viewerRecord]);

  return (
    <div className="space-y-6 rounded-2xl bg-gradient-to-br from-slate-50 via-white to-amber-50/50 p-1">
      <div className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-100">
              SIP Research Library
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950">SIP投研资料库</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              用 HTML 记录投研材料、会议纪要、估值片段和市场观察。每条资料都有稳定的 noteID，方便后续引用和追踪。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={loadRecords}
              disabled={loading || !userReady}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              刷新
            </button>
            <button
              onClick={openCreate}
              disabled={!userReady}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-slate-200 transition-colors hover:bg-amber-700 disabled:opacity-50"
            >
              <Plus size={16} />
              新增资料
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-sm shadow-slate-100">
          <div className="text-xs font-bold text-gray-400">资料数量</div>
          <div className="mt-2 text-3xl font-black text-slate-950">{records.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-sm shadow-slate-100">
          <div className="text-xs font-bold text-gray-400">已筛选</div>
          <div className="mt-2 text-3xl font-black text-slate-950">{filteredRecords.length}</div>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-500 to-slate-950 p-5 text-white shadow-lg shadow-amber-100">
          <div className="text-xs font-bold text-amber-100">最新更新</div>
          <div className="mt-2 text-lg font-black">{filteredRecords[0]?.target || '-'}</div>
          <div className="mt-1 text-xs text-amber-100">{filteredRecords[0] ? formatTime(filteredRecords[0].updatedAt) : '-'}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-xl shadow-slate-200/60">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-bold text-gray-900">投研资料索引</h2>
            <p className="mt-1 text-xs text-gray-500">在表头按标的、作者、备注组合筛选，按更新时间排序。</p>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center text-gray-500">
            <Loader2 size={32} className="mb-3 animate-spin text-amber-600" />
            正在读取资料库...
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-gray-400">
            <AlertCircle size={32} className="mb-3 text-amber-500" />
            暂无投研资料
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full whitespace-nowrap text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-xs font-bold text-slate-500 shadow-[0_1px_0_0_#e5e7eb]">
                <tr>
                  <th className="px-4 py-3">noteID</th>
                  <th className="px-4 py-3">
                    <button
                      onClick={() => setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                      className="inline-flex items-center gap-1 font-bold hover:text-slate-900"
                    >
                      更新时间
                      <span className="text-amber-600">{sortDir === 'asc' ? '▲' : '▼'}</span>
                    </button>
                  </th>
                  <FilterTh label="标的" filterKey="target" />
                  <FilterTh label="作者" filterKey="author" />
                  <FilterTh label="备注" filterKey="note" />
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredRecords.map((record) => (
                  <tr key={record.noteID} className="transition-colors odd:bg-white even:bg-slate-50/40 hover:bg-amber-50">
                    <td className="px-4 py-4 font-mono text-xs font-bold text-amber-700">{record.noteID}</td>
                    <td className="px-4 py-4 text-xs text-gray-500">{formatTime(record.updatedAt)}</td>
                    <td className="px-4 py-4 font-bold text-slate-900">{record.target}</td>
                    <td className="px-4 py-4 text-sm font-medium text-gray-700">{record.author || '-'}</td>
                    <td className="max-w-xl px-4 py-4">
                      <div className="truncate text-sm text-gray-700">{record.note || '-'}</div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                        <button onClick={() => setViewerRecord(record)} className="rounded-lg p-2 text-blue-600 transition-colors hover:bg-blue-50" title="查看">
                          <Eye size={16} />
                        </button>
                        <button onClick={() => openEdit(record)} className="rounded-lg p-2 text-amber-600 transition-colors hover:bg-amber-50" title="编辑">
                          <Edit3 size={16} />
                        </button>
                        <button onClick={() => handleDelete(record)} className="rounded-lg p-2 text-rose-600 transition-colors hover:bg-rose-50" title="删除">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-950/30">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-amber-50 px-6 py-5">
              <div>
                <h2 className="text-xl font-black text-gray-900">{editingRecord ? '编辑投研资料' : '新增投研资料'}</h2>
                <p className="mt-1 text-sm text-gray-500">{editingRecord?.noteID || '保存后自动生成 noteID'}</p>
              </div>
              <button onClick={() => setEditorOpen(false)} className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-2">
              <div className="space-y-4 overflow-auto border-r border-slate-200 p-6">
                <div>
                  <label className="mb-1 block text-sm font-bold text-gray-700">标的</label>
                  <input
                    value={draft.target}
                    onChange={(event) => setDraft((prev) => ({ ...prev, target: event.target.value }))}
                    placeholder="例如 NVDA、恒生指数、美股大盘、AI产业链"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-gray-700">作者</label>
                  <input
                    value={draft.author}
                    onChange={(event) => setDraft((prev) => ({ ...prev, author: event.target.value }))}
                    placeholder="请输入作者"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-gray-700">备注</label>
                  <textarea
                    value={draft.note}
                    onChange={(event) => setDraft((prev) => ({ ...prev, note: event.target.value }))}
                    placeholder="补充说明、资料来源或核心观点"
                    className="h-24 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-2 text-sm font-bold text-gray-700">
                    <Code2 size={15} />
                    HTML 正文
                  </label>
                  <textarea
                    value={draft.htmlContent}
                    onChange={(event) => setDraft((prev) => ({ ...prev, htmlContent: event.target.value }))}
                    placeholder="<h2>投研标题</h2><p>核心观点...</p>"
                    className="h-[460px] w-full rounded-xl border border-slate-300 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="overflow-auto bg-slate-50 p-6">
                <div className="mb-3 text-sm font-bold text-gray-700">实时预览</div>
                {draftIsFullDocument ? (
                  <iframe
                    title="HTML preview"
                    sandbox=""
                    srcDoc={draftIframeDoc}
                    className="h-[620px] w-full rounded-2xl border border-slate-200 bg-white shadow-sm"
                  />
                ) : (
                  <div className="prose prose-slate max-w-none rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div dangerouslySetInnerHTML={{ __html: sanitizedDraft || '<p style="color:#94a3b8">HTML 预览将在这里显示。</p>' }} />
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button onClick={() => setEditorOpen(false)} className="rounded-xl bg-white px-5 py-2 text-sm font-bold text-gray-700 ring-1 ring-slate-200 hover:bg-slate-50">
                取消
              </button>
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-slate-200 hover:bg-amber-700 disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {viewerRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-950/30">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-amber-50 px-6 py-5">
              <div>
                <div className="font-mono text-xs font-bold text-amber-700">{viewerRecord.noteID}</div>
                <h2 className="mt-1 text-xl font-black text-gray-900">{viewerRecord.target}</h2>
                <p className="mt-1 text-sm text-gray-500">更新时间：{formatTime(viewerRecord.updatedAt)}</p>
              </div>
              <button onClick={() => setViewerRecord(null)} className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            {viewerRecord.note && (
              <div className="border-b border-slate-100 bg-amber-50/50 px-6 py-3 text-sm text-gray-700">
                {viewerRecord.note}
              </div>
            )}
            <div className="overflow-auto p-6">
              {viewerIsFullDocument ? (
                <iframe
                  title={viewerRecord.noteID}
                  sandbox=""
                  srcDoc={viewerIframeDoc}
                  className="h-[72vh] w-full rounded-2xl border border-slate-200 bg-white"
                />
              ) : (
                <div className="prose prose-slate max-w-none" dangerouslySetInnerHTML={{ __html: sanitizedViewer }} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

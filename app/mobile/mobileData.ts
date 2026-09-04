"use client";

import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "firebase/auth";
import { APP_ID, auth, db } from "@/app/lib/stockService";

export type MatrixData = {
  accounts?: string[];
  markets?: string[];
  rawMatrix?: Record<string, any>;
  updatedAt?: any;
  createdAt?: any;
};

export type MobileCacheDoc = {
  module?: string;
  status?: string;
  calculatedAt?: any;
  updatedAt?: any;
  data?: any;
  warnings?: string[];
  errors?: string[];
};

export const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (typeof value === "number") return value < 10000000000 ? value * 1000 : value;
  if (typeof value === "string") {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  return 0;
};

export const formatTime = (value: any) => {
  const ms = toMillis(value);
  if (!ms) return "暂无记录";
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
};

export const formatNumber = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

export const formatHKD = (value: number | null | undefined, digits = 0) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${value < 0 ? "-" : ""}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};

export const formatPercent = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${(value * 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
};

export const ensureMobileFirebaseAuth = async () => {
  if (!auth.currentUser) {
    if (typeof window !== "undefined" && (window as any).__initial_auth_token) {
      await signInWithCustomToken(auth, (window as any).__initial_auth_token);
    } else {
      await signInAnonymously(auth);
    }
  }

  return new Promise<void>((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, () => {
      unsubscribe();
      resolve();
    });
  });
};

export const dataDoc = (collectionName: string, docId: string) => (
  doc(db, "artifacts", APP_ID, "public", "data", collectionName, docId)
);

export const dataCollection = (collectionName: string) => (
  collection(db, "artifacts", APP_ID, "public", "data", collectionName)
);

export const getDataDoc = async <T = any>(collectionName: string, docId = "latest_summary") => {
  const snap = await getDoc(dataDoc(collectionName, docId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as T) } as T & { id: string };
};

export const getDisplayCache = async (moduleName: string) => {
  return getDataDoc<MobileCacheDoc>("sip_display_cache_current", moduleName);
};

export const getCollectionRows = async <T = any>(collectionName: string) => {
  const snap = await getDocs(dataCollection(collectionName));
  return snap.docs.map((item) => ({ id: item.id, ...(item.data() as T) }));
};

export const matrixTotal = (matrix?: MatrixData | null) => {
  if (!matrix?.rawMatrix) return 0;
  return Object.values(matrix.rawMatrix).reduce<number>((sum, row: any) => {
    if (!row || typeof row !== "object") return sum;
    return sum + Object.values(row).reduce<number>((inner, value: any) => inner + toNumber(value), 0);
  }, 0);
};

export const pnlTotal = (matrix?: MatrixData | null, field: "realized" | "unrealized" | "total" = "total") => {
  if (!matrix?.rawMatrix) return 0;
  return Object.values(matrix.rawMatrix).reduce<number>((sum, row: any) => {
    if (!row || typeof row !== "object") return sum;
    return sum + toNumber(row[field]);
  }, 0);
};

export const matrixRows = (matrix?: MatrixData | null) => {
  if (!matrix?.rawMatrix) return [];
  return Object.entries(matrix.rawMatrix).map(([market, row]: [string, any]) => ({ market, row }));
};

export const getCacheTime = (cache?: MobileCacheDoc | null) => (
  cache ? formatTime(cache.calculatedAt || cache.updatedAt) : "暂无缓存"
);

export const getSummaryTime = (summary?: any | null) => (
  summary ? formatTime(summary.updatedAt || summary.createdAt) : "暂无入库"
);

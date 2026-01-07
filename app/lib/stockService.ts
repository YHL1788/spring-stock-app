import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query } from 'firebase/firestore';
import { getAuth, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

// 1. 初始化 Firebase (单例模式)
// 尝试从环境变量读取配置
const firebaseConfigStr = process.env.NEXT_PUBLIC_FIREBASE_CONFIG;
const firebaseConfig = firebaseConfigStr ? JSON.parse(firebaseConfigStr) : {};

// 确保 Firebase 只初始化一次
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);

// 应用 ID，用于隔离数据
const APP_ID = process.env.NEXT_PUBLIC_APP_ID || 'default-app';

// 导出 db 和 auth 供 Admin 页面写操作使用
export { db, auth, APP_ID };

/**
 * [核心] 从数据库获取股票列表
 */
export async function fetchStockPoolFromDB(): Promise<any[]> {
  try {
    // 确保登录 (匿名或 Token)
    if (!auth.currentUser) {
       // @ts-ignore
      if (typeof window !== 'undefined' && window.__initial_auth_token) {
         // @ts-ignore
        await signInWithCustomToken(auth, window.__initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    }

    const q = query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'stock_pool'));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) return [];

    return snapshot.docs.map(doc => doc.data());
  } catch (error) {
    console.error("Error fetching stock pool:", error);
    return [];
  }
}

// --- 纯函数工具 (不依赖数据库，仅处理数据逻辑) ---

/**
 * 根据代码获取详情
 * @param symbol 股票代码
 * @param stockPool 必须传入完整的股票池数组 (来自 Hook 或 DB)
 */
export function getStockDetail(symbol: string, stockPool: any[] = []): any {
  if (!stockPool?.length) return {};
  const target = symbol.trim().toUpperCase();
  
  // 1. 精确匹配
  let found = stockPool.find((s: any) => s.symbol?.toUpperCase() === target);

  // 2. 模糊匹配 (处理 CRM.US -> CRM)
  if (!found && target.includes('.')) {
    const shortTarget = target.split('.')[0];
    found = stockPool.find((s: any) => s.symbol?.toUpperCase() === shortTarget);
  }
  return found || {};
}

/**
 * 获取所有一级行业
 * @param stockPool 必须传入完整的股票池数组
 */
export function getLevel1Sectors(stockPool: any[] = []): string[] {
  if (!stockPool?.length) return [];
  const sectors = new Set<string>();
  stockPool.forEach((s: any) => {
    if (s.sector_level_1) sectors.add(s.sector_level_1);
  });
  return Array.from(sectors);
}
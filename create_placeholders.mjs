import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件的路径 (在 ES Module 中 __dirname 需要这样获取)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. 定义所有需要创建的路由路径
const routes = [
  'app/offerings/securities',
  'app/offerings/futures',
  'app/offerings/forex',
  'app/offerings/options',
  'app/offerings/derivatives',
  'app/offerings/funds',
  'app/market/overview',
  'app/market/calendar',
  'app/strategies/pchip',
  'app/strategies/mine',
  'app/book',
  'app/notes/sip',
  'app/notes/mine',
  'app/about/intro',
  'app/about/team',
  'app/about/faq',
  'app/about/contact',
  'app/quote' // 确保 quote 目录也被包含
];

// 2. 定义占位页面的通用代码模板
const pageContent = `
export default function PlaceholderPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] bg-gray-50">
      <div className="text-6xl mb-4">🚧</div>
      <h1 className="text-3xl font-bold text-gray-400">功能模块开发中...</h1>
      <p className="text-gray-500 mt-4">This page is currently under construction.</p>
    </div>
  );
}
`;

// 3. 执行创建逻辑
console.log('🚀 开始创建占位页面...');

routes.forEach(routePath => {
  // 构建完整的文件夹路径
  const fullDir = path.join(__dirname, routePath);
  
  // 如果文件夹不存在，递归创建
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
    console.log(`📁 创建文件夹: ${routePath}`);
  }

  // 构建 page.tsx 文件路径
  const filePath = path.join(fullDir, 'page.tsx');

  // 如果文件不存在，则写入内容 (防止覆盖你已经写好的代码)
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, pageContent.trim());
    console.log(`✅ 创建文件: ${routePath}/page.tsx`);
  } else {
    console.log(`⚠️ 跳过已存在: ${routePath}/page.tsx`);
  }
});

console.log('✨ 所有占位页面创建完毕！请重启 Next.js 服务器查看效果。');
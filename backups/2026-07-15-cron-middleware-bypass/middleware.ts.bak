import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// 1. 定义受保护的路由模式
// 使用 (.*) 匹配该路径下的所有子路由
const isProtectedRoute = createRouteMatcher([
  '/market(.*)',       // 市场行情
  '/analysis(.*)',     // 分析工具
  '/strategies(.*)',   // 策略
  '/book(.*)',         // 账簿
  '/notes(.*)',        // 投资笔记
  '/api(.*)',          // API 接口 (可选，取决于您的 API 是否需要公开)
]);

// 2. 在中间件中进行拦截
export default clerkMiddleware(async (auth, req) => {
  // 如果请求的是受保护路由，则强制要求认证
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // 排除静态资源和 Next.js 内部路由
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // 始终运行 API 路由
    '/(api|trpc)(.*)',
  ],
};
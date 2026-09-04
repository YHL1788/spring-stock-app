import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// 1. 瀹氫箟鍙椾繚鎶ょ殑璺敱妯″紡
// 浣跨敤 (.*) 鍖归厤璇ヨ矾寰勪笅鐨勬墍鏈夊瓙璺敱
const isProtectedRoute = createRouteMatcher([
  '/market(.*)',       // 甯傚満琛屾儏
  '/analysis(.*)',     // 鍒嗘瀽宸ュ叿
  '/strategies(.*)',   // 绛栫暐
  '/book(.*)',         // 璐︾翱
  '/notes(.*)',        // 鎶曡祫绗旇
  '/api(.*)',          // API 鎺ュ彛 (鍙€夛紝鍙栧喅浜庢偍鐨?API 鏄惁闇€瑕佸叕寮€)
]);

const isPublicCronRoute = createRouteMatcher([
  '/api/book/spwjhh1/refresh-display-cache(.*)',
]);

const isPublicDividendLowVolPublishRoute = createRouteMatcher([
  '/api/dividend-low-vol/publish(.*)',
]);

// 2. 鍦ㄤ腑闂翠欢涓繘琛屾嫤鎴?
export default clerkMiddleware(async (auth, req) => {
  if (isPublicCronRoute(req) || isPublicDividendLowVolPublishRoute(req)) {
    return;
  }

  // 濡傛灉璇锋眰鐨勬槸鍙椾繚鎶よ矾鐢憋紝鍒欏己鍒惰姹傝璇?
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // 鎺掗櫎闈欐€佽祫婧愬拰 Next.js 鍐呴儴璺敱
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // 濮嬬粓杩愯 API 璺敱
    '/(api|trpc)(.*)',
  ],
};

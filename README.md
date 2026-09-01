This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 港股红利低波结果同步

“分析 → 红利低波分析”读取港股红利低波实验室推送的版本化结果，并展示动态月度回测、恒生指数/恒生国企指数对照、月度调仓与持仓、最新候选股票和均线买点参考。

在 Vercel 的 Production、Preview 和 Development 环境配置同一个高强度随机值：

```text
DIVIDEND_LOW_VOL_SYNC_SECRET=<至少32个随机字符>
```

实验室通过公开但有共享密钥保护的 `POST /api/dividend-low-vol/publish` 发布结果；普通读取接口 `GET /api/dividend-low-vol` 和页面继续受 Clerk 登录保护。同步记录存放在现有 Firebase Admin 项目下，每个实验编号独立归档，正式批准版本会成为默认展示版本。

Streamlit 端必须配置相同密钥，详见实验室仓库 README。不要把真实密钥写进 Git、前端变量或截图。

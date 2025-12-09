import Link from "next/link";

export default function Home() {
  return (
    <div className="relative isolate overflow-hidden min-h-screen flex flex-col justify-center">
      {/* 背景圖片 */}
      <div className="absolute inset-0 -z-10">
        {/* 使用 Unsplash 的高品質金融/城市夜景圖片 */}
        <img
          src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=2070&auto=format&fit=crop"
          alt="金融市場背景"
          className="h-full w-full object-cover"
        />
        {/* 深色漸變遮罩，確保白字清晰 */}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/80 to-gray-900/40" />
      </div>

      {/* 內容區域 */}
      <div className="mx-auto max-w-7xl px-6 pb-24 pt-10 sm:pb-32 lg:flex lg:px-8 lg:py-40">
        <div className="mx-auto max-w-2xl lg:mx-0 lg:max-w-xl lg:flex-shrink-0 lg:pt-8 animate-fade-in-up">
          <div className="mt-24 sm:mt-32 lg:mt-16">
            <a href="/about/intro" className="inline-flex space-x-6">
              <span className="rounded-full bg-blue-600/10 px-3 py-1 text-sm font-semibold leading-6 text-blue-400 ring-1 ring-inset ring-blue-600/10">
                最新發布
              </span>
              <span className="inline-flex items-center space-x-2 text-sm font-medium leading-6 text-gray-300">
                <span>SIP v1.0 正式上線</span>
              </span>
            </a>
          </div>
          
          <h1 className="mt-10 text-4xl font-extrabold tracking-tight text-white sm:text-6xl leading-tight">
            為家族辦公室打造的<br/>
            <span className="text-blue-500">投資記賬本</span>
          </h1>
          
          <p className="mt-6 text-lg leading-8 text-gray-300">
            科學化倉位管理，自主化策略配置。<br/>
            SIP (Spring Investment Platform) 助您以專業視角，審視全球資產佈局，讓財富傳承更具智慧。
          </p>
          
          <div className="mt-10 flex items-center gap-x-6">
          </div>
        </div>
      </div>
    </div>
  );
}
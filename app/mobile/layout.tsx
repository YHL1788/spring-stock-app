"use client";

import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import { ArrowRight, BarChart3, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import styles from "./mobile.module.css";

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedOut>
        <div className={`${styles.authRoot} -mt-24`}>
          <div className={styles.authGlow} aria-hidden="true" />
          <section className={styles.authPanel}>
            <div className={styles.authBrand}>
              <div className={styles.authLogo}>
                <BarChart3 size={26} strokeWidth={2.4} />
              </div>
              <div>
                <div className={styles.authBrandName}>SIP</div>
                <div className={styles.authBrandCaption}>SPRING INVESTMENT PLATFORM</div>
              </div>
            </div>

            <div className={styles.authHero}>
              <div className={styles.authKicker}><Sparkles size={14} /> PRIVATE WEALTH CONSOLE</div>
              <h1>随时掌握您的<br />资产与风险</h1>
              <p>专为移动端设计的只读投资终端。登录后即可安全查看持仓、盈亏与风险暴露。</p>
            </div>

            <div className={styles.authFeatures}>
              <div><ShieldCheck size={18} /><span>只读模式<br /><small>不提供交易与修改入口</small></span></div>
              <div><LockKeyhole size={18} /><span>账户保护<br /><small>仅登录用户可以访问</small></span></div>
            </div>

            <SignInButton mode="modal">
              <button type="button" className={styles.authButton}>
                安全登录 <ArrowRight size={18} />
              </button>
            </SignInButton>

            <p className={styles.authFootnote}>登录窗口将在本站内打开，不再自动跳转到外部登录页面。</p>
          </section>
        </div>
      </SignedOut>
      <SignedIn>{children}</SignedIn>
    </>
  );
}

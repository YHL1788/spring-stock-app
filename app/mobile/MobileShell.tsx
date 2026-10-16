"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { BriefcaseBusiness, ShieldCheck } from "lucide-react";
import styles from "./mobile.module.css";
import PwaInstallButton from "./PwaInstallButton";

export default function MobileShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const pathname = usePathname();
  const isHoldings = pathname.startsWith("/mobile/holdings");
  const isRisk = pathname.startsWith("/mobile/risk");

  return (
    <div className={`${styles.mobileRoot} -mt-24`}>
      <header className={styles.header}>
        <div className={styles.headerTopline}>
          <div className={styles.eyebrow}><span className={styles.liveDot} /> SIP PRIVATE CONSOLE</div>
          <div className={styles.headerActions}>
            <PwaInstallButton />
            <UserButton afterSignOutUrl="/mobile/holdings" />
          </div>
        </div>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
        </div>
        <p className={styles.subtitle}>{subtitle}</p>
      </header>
      <main className={styles.stage}>{children}</main>
      <nav className={styles.bottomNav} aria-label="Mobile app navigation">
        <Link href="/mobile/holdings" className={`${styles.navItem} ${isHoldings ? styles.navItemActive : ""}`}>
          <BriefcaseBusiness size={19} />
          <span>持仓</span>
        </Link>
        <Link href="/mobile/risk" className={`${styles.navItem} ${isRisk ? styles.navItemActive : ""}`}>
          <ShieldCheck size={19} />
          <span>风控</span>
        </Link>
      </nav>
    </div>
  );
}

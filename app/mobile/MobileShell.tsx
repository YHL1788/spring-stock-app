"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, ShieldAlert } from "lucide-react";
import styles from "./mobile.module.css";

export default function MobileShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const pathname = usePathname();
  const isHoldings = pathname.startsWith("/mobile/holdings");
  const isRisk = pathname.startsWith("/mobile/risk");

  return (
    <div className={`${styles.mobileRoot} -mt-24`}>
      <header className={styles.header}>
        <div className={styles.eyebrow}>SIP READ ONLY APP</div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </header>
      <main className={styles.stage}>{children}</main>
      <nav className={styles.bottomNav} aria-label="Mobile app navigation">
        <Link href="/mobile/holdings" className={`${styles.navItem} ${isHoldings ? styles.navItemActive : ""}`}>
          <Briefcase size={16} />
          持仓
        </Link>
        <Link href="/mobile/risk" className={`${styles.navItem} ${isRisk ? styles.navItemActive : ""}`}>
          <ShieldAlert size={16} />
          风控
        </Link>
      </nav>
    </div>
  );
}

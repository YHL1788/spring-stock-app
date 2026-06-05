import { redirect } from 'next/navigation';

export default function HoldingsPerformanceRedirectPage() {
  redirect('/book/SP_wjhh1/holdings/summary?tab=performance');
}

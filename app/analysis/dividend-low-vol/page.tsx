import { redirect } from 'next/navigation';

const DIVIDEND_LOW_VOL_URL = 'https://hk-dividend-low-vol-lab.streamlit.app/';

export default function DividendLowVolRedirectPage() {
  redirect(DIVIDEND_LOW_VOL_URL);
}

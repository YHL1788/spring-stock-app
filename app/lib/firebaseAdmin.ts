import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const parseServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
  }

  const normalized = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');

  const parsed = JSON.parse(normalized);
  if (parsed.private_key) {
    parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
  }
  return parsed;
};

const getAdminApp = () => {
  const apps = getApps();
  if (apps.length > 0) return apps[0];
  return initializeApp({
    credential: cert(parseServiceAccount()),
  });
};

export const getAdminDb = () => getFirestore(getAdminApp());

export const getServerAppId = () => process.env.NEXT_PUBLIC_APP_ID || 'default-app';

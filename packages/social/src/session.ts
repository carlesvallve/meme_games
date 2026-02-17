import { jwtDecrypt } from 'jose';
import { hkdf } from '@panva/hkdf';

const AUTH_SECRET = process.env.AUTH_SECRET ?? '';

async function getDerivedKey(secret: string) {
  return hkdf(
    'sha256',
    secret,
    '',
    'Auth.js Generated Encryption Key',
    32,
  );
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function getSession(cookieHeader: string | null): Promise<{ user: SessionUser } | null> {
  if (!cookieHeader || !AUTH_SECRET) return null;

  const cookieName = process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

  const match = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${cookieName}=`));

  if (!match) return null;

  const token = match.split('=').slice(1).join('=');
  if (!token) return null;

  try {
    const key = await getDerivedKey(AUTH_SECRET);
    const { payload } = await jwtDecrypt(token, key, { clockTolerance: 15 });

    const id = payload.id ?? payload.sub;
    const email = payload.email;
    const name = payload.name;

    if (typeof id !== 'string' || typeof email !== 'string' || typeof name !== 'string') {
      return null;
    }

    return { user: { id, email, name } };
  } catch {
    return null;
  }
}

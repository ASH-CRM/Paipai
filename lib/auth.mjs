// ล็อกอินด้วย PIN: เก็บเฉพาะค่าแฮช (scrypt + salt) ไม่เก็บ PIN จริง
// โทเคนเข้าสู่ระบบเซ็นด้วย HMAC — เปลี่ยน/รีเซ็ต PIN แล้วโทเคนเก่าใช้ไม่ได้ทันที (tokenVer)
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const store = () => getStore({ name: 'assistant', consistency: 'strong' });

const TOKEN_DAYS = 30;
export const MAX_FAILS = 5;          // ใส่ผิดติดกันครบ 5 ครั้ง → ล็อก
export const LOCK_MINUTES = 15;

export const isValidPin = pin => typeof pin === 'string' && /^\d{4,8}$/.test(pin);

export function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
  return { salt, hash };
}

export function checkPin(pin, user) {
  if (!user?.pinHash || !user?.pinSalt || typeof pin !== 'string') return false;
  const a = Buffer.from(hashPin(pin, user.pinSalt).hash, 'hex');
  const b = Buffer.from(user.pinHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const s = store();
  let v = await s.get('config/secret');
  if (!v) {
    v = crypto.randomBytes(32).toString('hex');
    await s.set('config/secret', v);
  }
  return v;
}

const b64 = s => Buffer.from(s).toString('base64url');
const sign = (data, key) => crypto.createHmac('sha256', key).update(data).digest('base64url');

export async function makeToken(user) {
  const body = b64(JSON.stringify({ u: user.id, v: user.tokenVer || 0, exp: Date.now() + TOKEN_DAYS * 864e5 }));
  return body + '.' + sign(body, await secret());
}

export async function readToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const want = sign(body, await secret());
  if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

/* ---------- ผู้ใช้ ---------- */
export async function loadUsers() {
  return (await store().get('users', { type: 'json' })) || [];
}
export async function saveUsers(users) {
  await store().setJSON('users', users);
}

// ข้อมูลที่ส่งให้หน้าเว็บได้ (ไม่มีแฮช PIN)
export const publicUser = u => ({ id: u.id, name: u.name, role: u.role, avatar: u.avatar, color: u.color, disabled: !!u.disabled });

/* ---------- กันเดา PIN ---------- */
export async function getLock(userId) {
  return (await store().get('lock/' + userId, { type: 'json' })) || { fails: 0, until: 0 };
}
export async function recordFail(userId) {
  const l = await getLock(userId);
  l.fails += 1;
  if (l.fails >= MAX_FAILS) { l.until = Date.now() + LOCK_MINUTES * 60e3; l.fails = 0; }
  await store().setJSON('lock/' + userId, l);
  return l;
}
export async function clearLock(userId) {
  await store().delete('lock/' + userId);
}

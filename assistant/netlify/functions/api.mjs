// API ทั้งหมดของแอปผู้ช่วย: /api/*
import crypto from 'node:crypto';
import {
  store, isValidPin, hashPin, checkPin, makeToken, readToken,
  loadUsers, saveUsers, publicUser, getLock, recordFail, clearLock, LOCK_MINUTES
} from '../../lib/auth.mjs';
import { streamReply } from '../../lib/chat.mjs';

export const config = { path: '/api/*' };

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
const fail = (status, error, extra = {}) => json({ error, ...extra }, status);
const newId = () => crypto.randomBytes(8).toString('hex');
const cleanName = n => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 40);
const cleanAvatar = a => String(a || '🙂').trim().slice(0, 8) || '🙂';
const cleanColor = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#5FA0E8';

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

async function currentUser(req) {
  const h = req.headers.get('authorization') || '';
  const p = await readToken(h.replace(/^Bearer\s+/i, ''));
  if (!p) return null;
  const u = (await loadUsers()).find(x => x.id === p.u);
  if (!u || u.disabled || (u.tokenVer || 0) !== p.v) return null;
  return u;
}

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [res, id, sub] = parts;
  const m = req.method;

  try {
    /* ---------- ก่อนล็อกอิน ---------- */
    if (res === 'status' && m === 'GET') {
      const users = await loadUsers();
      return json({
        setup: users.length === 0,
        users: users.filter(u => !u.disabled).map(u => ({ id: u.id, name: u.name, avatar: u.avatar, color: u.color }))
      });
    }

    if (res === 'setup' && m === 'POST') {
      // ★ สร้างผู้ดูแลคนแรก: ต้องใส่รหัสตั้งค่า (SETUP_CODE) ที่ตั้งไว้ใน Netlify กันคนอื่นเข้ามาตั้งก่อน
      const users = await loadUsers();
      if (users.length) return fail(409, 'already-setup');
      const b = await body(req);
      const code = process.env.SETUP_CODE;
      if (!code) return fail(500, 'no-setup-code');
      if (b.code !== code) return fail(403, 'bad-setup-code');
      const name = cleanName(b.name);
      if (!name) return fail(400, 'bad-name');
      if (!isValidPin(b.pin)) return fail(400, 'bad-pin');
      const { salt, hash } = hashPin(b.pin);
      const admin = { id: newId(), name, role: 'admin', avatar: cleanAvatar(b.avatar), color: cleanColor(b.color),
        pinSalt: salt, pinHash: hash, tokenVer: 0, disabled: false, createdAt: Date.now() };
      await saveUsers([admin]);
      return json({ token: await makeToken(admin), user: publicUser(admin) });
    }

    if (res === 'login' && m === 'POST') {
      const b = await body(req);
      const users = await loadUsers();
      const u = users.find(x => x.id === b.userId && !x.disabled);
      if (!u) return fail(404, 'no-user');
      const lock = await getLock(u.id);
      if (lock.until > Date.now()) return fail(423, 'locked', { until: lock.until });
      if (!checkPin(String(b.pin || ''), u)) {
        const l = await recordFail(u.id);
        if (l.until > Date.now()) return fail(423, 'locked', { until: l.until });
        return fail(401, 'wrong-pin', { left: 5 - l.fails });
      }
      await clearLock(u.id);
      return json({ token: await makeToken(u), user: publicUser(u) });
    }

    /* ---------- ต้องล็อกอิน ---------- */
    const me = await currentUser(req);
    if (!me) return fail(401, 'unauthorized');

    if (res === 'me') {
      if (!id && m === 'GET') return json({ user: publicUser(me) });
      if (id === 'pin' && m === 'POST') {
        const b = await body(req);
        if (!checkPin(String(b.currentPin || ''), me)) return fail(403, 'wrong-pin');
        if (!isValidPin(b.newPin)) return fail(400, 'bad-pin');
        const users = await loadUsers();
        const u = users.find(x => x.id === me.id);
        const { salt, hash } = hashPin(b.newPin);
        u.pinSalt = salt; u.pinHash = hash;
        u.tokenVer = (u.tokenVer || 0) + 1;     // ออกจากระบบทุกเครื่อง แล้วออกโทเคนใหม่ให้เครื่องนี้
        await saveUsers(users);
        return json({ token: await makeToken(u) });
      }
    }

    /* ---------- จัดการผู้ใช้ (ผู้ดูแลเท่านั้น) ---------- */
    if (res === 'users') {
      if (me.role !== 'admin') return fail(403, 'admin-only');
      const users = await loadUsers();

      if (!id && m === 'GET') return json({ users: users.map(publicUser) });

      if (!id && m === 'POST') {
        const b = await body(req);
        const name = cleanName(b.name);
        if (!name) return fail(400, 'bad-name');
        if (users.some(u => u.name === name)) return fail(409, 'name-taken');
        if (!isValidPin(b.pin)) return fail(400, 'bad-pin');
        const { salt, hash } = hashPin(b.pin);
        const u = { id: newId(), name, role: b.role === 'admin' ? 'admin' : 'user', avatar: cleanAvatar(b.avatar),
          color: cleanColor(b.color), pinSalt: salt, pinHash: hash, tokenVer: 0, disabled: false, createdAt: Date.now() };
        users.push(u);
        await saveUsers(users);
        return json({ user: publicUser(u) });
      }

      const u = users.find(x => x.id === id);
      if (!u) return fail(404, 'no-user');
      const admins = users.filter(x => x.role === 'admin' && !x.disabled);
      const isLastAdmin = u.role === 'admin' && !u.disabled && admins.length === 1;

      if (m === 'PATCH') {
        const b = await body(req);
        if (b.name !== undefined) {
          const name = cleanName(b.name);
          if (!name) return fail(400, 'bad-name');
          if (users.some(x => x.id !== u.id && x.name === name)) return fail(409, 'name-taken');
          u.name = name;
        }
        if (b.avatar !== undefined) u.avatar = cleanAvatar(b.avatar);
        if (b.color !== undefined) u.color = cleanColor(b.color);
        if (b.role !== undefined) {
          const role = b.role === 'admin' ? 'admin' : 'user';
          if (role === 'user' && isLastAdmin) return fail(400, 'last-admin');
          u.role = role;
        }
        if (b.disabled !== undefined) {
          if (b.disabled && (u.id === me.id || isLastAdmin)) return fail(400, 'cannot-disable');
          u.disabled = !!b.disabled;
          u.tokenVer = (u.tokenVer || 0) + 1;
        }
        if (b.pin !== undefined) {
          if (!isValidPin(b.pin)) return fail(400, 'bad-pin');
          const { salt, hash } = hashPin(b.pin);
          u.pinSalt = salt; u.pinHash = hash;
          u.tokenVer = (u.tokenVer || 0) + 1;
          await clearLock(u.id);                 // รีเซ็ต PIN = ปลดล็อกด้วย
        }
        await saveUsers(users);
        return json({ user: publicUser(u) });
      }

      if (m === 'DELETE') {
        if (u.id === me.id) return fail(400, 'cannot-delete-self');
        if (isLastAdmin) return fail(400, 'last-admin');
        await saveUsers(users.filter(x => x.id !== u.id));
        const s = store();
        const { blobs } = await s.list({ prefix: `chats/${u.id}/` });
        await Promise.all(blobs.map(b => s.delete(b.key)));
        await clearLock(u.id);
        return json({ ok: true });
      }
    }

    /* ---------- ประวัติแชต ---------- */
    const s = store();
    const indexKey = `chats/${me.id}/index`;
    const loadIndex = async () => (await s.get(indexKey, { type: 'json' })) || [];

    if (res === 'chats') {
      if (!id && m === 'GET') return json({ chats: await loadIndex() });
      if (id && !/^[0-9a-f]{16}$/.test(id)) return fail(400, 'bad-id');
      if (id && m === 'GET') {
        const c = await s.get(`chats/${me.id}/${id}`, { type: 'json' });
        return c ? json({ chat: c }) : fail(404, 'no-chat');
      }
      if (id && m === 'DELETE') {
        await s.delete(`chats/${me.id}/${id}`);
        await s.setJSON(indexKey, (await loadIndex()).filter(c => c.id !== id));
        return json({ ok: true });
      }
    }

    if (res === 'chat' && m === 'POST') {
      const b = await body(req);
      const text = String(b.message || '').trim().slice(0, 8000);
      if (!text) return fail(400, 'empty');
      if (!process.env.ANTHROPIC_API_KEY) return fail(500, 'no-server-key');

      let chat = null;
      if (b.chatId && /^[0-9a-f]{16}$/.test(b.chatId)) chat = await s.get(`chats/${me.id}/${b.chatId}`, { type: 'json' });
      if (!chat) chat = { id: newId(), title: text.replace(/\s+/g, ' ').slice(0, 48), createdAt: Date.now(), messages: [] };
      chat.messages.push({ role: 'user', content: text, ts: Date.now() });

      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(ctrl) {
          const send = ev => ctrl.enqueue(enc.encode('data: ' + JSON.stringify(ev) + '\n\n'));
          send({ type: 'meta', chatId: chat.id, title: chat.title });
          let answer = '';
          try {
            answer = await streamReply(me, chat.messages, send);
          } catch (e) {
            console.error('chat failed', e?.status, e?.message);
            send({ type: 'error', message: e?.status === 429 ? 'busy' : 'failed' });
          }
          if (answer) {
            chat.messages.push({ role: 'assistant', content: answer, ts: Date.now() });
            chat.updatedAt = Date.now();
            await s.setJSON(`chats/${me.id}/${chat.id}`, chat);
            const idx = (await loadIndex()).filter(c => c.id !== chat.id);
            idx.unshift({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt });
            await s.setJSON(indexKey, idx.slice(0, 200));
          }
          send({ type: 'done' });
          ctrl.close();
        }
      });
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' }
      });
    }

    return fail(404, 'not-found');
  } catch (e) {
    console.error('api error', e);
    return fail(500, 'server-error');
  }
};

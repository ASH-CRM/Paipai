// Service worker แบบเรียบง่าย: ทำให้ติดตั้งเป็นแอปได้ และเปิดหน้าแอปได้เร็ว
const CACHE = 'paipai-v164';
const ASSETS = ['./', './index.html', './paipai.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// หน้าแอป: โหลดจากเน็ตก่อน (จะได้เวอร์ชันล่าสุดเสมอ) ถ้าออฟไลน์ใช้ตัวที่เก็บไว้
// ส่วน API แปลภาษา: ผ่านตรงไม่แคช
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // API ภายนอกผ่านตรง
  // API ของแอป (ล็อกอิน/แชต/แปล) และคำขอที่ไม่ใช่ GET: ผ่านตรง ไม่แคช
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

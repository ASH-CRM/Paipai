// ตัวกลางแปลภาษา: เก็บ API Key ไว้ฝั่งเซิร์ฟเวอร์ (ตั้งใน Environment variables ของ Netlify)
// ผู้ใช้เปิดเว็บแล้วใช้ได้เลย โดยไม่มีคีย์โผล่ในหน้าเว็บ
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: 'method-not-allowed' }) };
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: 'no-server-key' }) };
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: event.body
    });
    const data = await res.text();
    return { statusCode: res.status, headers: { ...cors(), 'content-type': 'application/json' }, body: data };
  } catch (e) {
    return { statusCode: 502, headers: cors(), body: JSON.stringify({ error: 'upstream-failed' }) };
  }
};
function cors(){
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}

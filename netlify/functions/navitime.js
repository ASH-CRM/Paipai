// ★ NAVITIME Route(totalnavi) ผ่าน RapidAPI — ข้อมูลรถไฟญี่ปุ่นจริง (ตาราง/ค่าโดยสาร/ทางออกสถานี)
// ตั้งค่า: Netlify > Site settings > Environment variables > NAVITIME_RAPIDAPI_KEY = คีย์จาก RapidAPI
const HOST = 'navitime-route-totalnavi.p.rapidapi.com';

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  const KEY = process.env.NAVITIME_RAPIDAPI_KEY;
  const q = (event && event.queryStringParameters) || {};

  if (!KEY) return { statusCode: 200, headers, body: JSON.stringify({ status: 'NO_NAVITIME_KEY' }) };
  if (!q.start || !q.goal) return { statusCode: 400, headers, body: JSON.stringify({ status: 'BAD_REQUEST' }) };

  // ★ สเปก NAVITIME: ระบุเวลาได้ "อย่างใดอย่างหนึ่งเท่านั้น"
  //   start_time / goal_time / first_operation / last_operation — ห้ามส่งพร้อมกัน
  const params = new URLSearchParams({
    start: q.start,                       // "lat,lon"
    goal: q.goal,                         // "lat,lon"
    datum: 'wgs84',
    coord_unit: 'degree',
    term: '1440',
    limit: q.limit || '3',
    language: q.language || 'en'          // ขอชื่อสถานี/ขบวนเป็นอักษรโรมันถ้ารองรับ
  });
  if (q.goal_time) {
    params.set('goal_time', q.goal_time);             // ต้องไปถึงเวลานี้
  } else if (q.first_operation) {
    params.set('first_operation', q.first_operation); // รถเที่ยวแรกของวันที่ระบุ (YYYY-MM-DD)
  } else if (q.last_operation) {
    params.set('last_operation', q.last_operation);   // รถเที่ยวสุดท้ายของวันที่ระบุ
  } else {
    // ค่าเริ่มต้น: ออกเดินทางตอนนี้ (เวลาญี่ปุ่น UTC+9)
    let st = q.start_time;
    if (!st) {
      const now = new Date();
      const jp = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
      const p2 = n => String(n).padStart(2, '0');
      st = jp.getFullYear() + '-' + p2(jp.getMonth() + 1) + '-' + p2(jp.getDate()) +
           'T' + p2(jp.getHours()) + ':' + p2(jp.getMinutes()) + ':00';
    }
    params.set('start_time', st);
  }

  try {
    const r = await fetch('https://' + HOST + '/route_transit?' + params.toString(), {
      headers: {
        'X-RapidAPI-Key': KEY,
        'X-RapidAPI-Host': HOST
      }
    });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { j = { status: 'BAD_RESPONSE', raw: text.slice(0, 300) }; }
    if (!r.ok && j && !j.status) j.status = 'HTTP_' + r.status;
    return { statusCode: 200, headers, body: JSON.stringify(j) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ status: 'ERROR', message: String(e && e.message || e) }) };
  }
};

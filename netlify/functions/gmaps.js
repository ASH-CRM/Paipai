// ตัวกลางเรียก Google Directions API (เก็บคีย์ไว้ฝั่งเซิร์ฟเวอร์ ไม่โผล่ในหน้าเว็บ)
// ตั้งค่า Environment variable ชื่อ GOOGLE_MAPS_KEY ใน Netlify
exports.handler = async (event) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ status: 'NO_SERVER_KEY' }) };
  }
  const q = event.queryStringParameters || {};

  // ★ โหมดแปลงชื่อสถานที่ → พิกัด (ใช้ส่งปลายทางให้แอปเรียกรถ)
  if (q.address) {
    const params = new URLSearchParams({ address: q.address, language: q.language || 'th', key });
    try {
      const r = await fetch('https://maps.googleapis.com/maps/api/geocode/json?' + params.toString());
      const text = await r.text();
      return { statusCode: r.status, headers: cors, body: text };
    } catch (e) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ status: 'UPSTREAM_FAILED' }) };
    }
  }

  // ★ โหมดแปลงพิกัด → ชื่อสถานที่ (Google Geocoding แม่นกว่าบริการฟรี)
  if (q.latlng) {
    const params = new URLSearchParams({ latlng: q.latlng, language: q.language || 'th', key });
    if (q.result_type) params.set('result_type', q.result_type);
    try {
      const r = await fetch('https://maps.googleapis.com/maps/api/geocode/json?' + params.toString());
      const text = await r.text();
      return { statusCode: r.status, headers: cors, body: text };
    } catch (e) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ status: 'UPSTREAM_FAILED' }) };
    }
  }

  // ★ โหมดดึงรายละเอียด+รีวิวจริงของสถานที่ (Place Details)
  if (q.details) {
    const params = new URLSearchParams({
      place_id: q.details,
      fields: 'name,rating,user_ratings_total,reviews,url,editorial_summary,opening_hours',
      language: q.language || 'th', reviews_sort: 'most_relevant', key
    });
    try {
      const r = await fetch('https://maps.googleapis.com/maps/api/place/details/json?' + params.toString());
      const text = await r.text();
      return { statusCode: r.status, headers: cors, body: text };
    } catch (e) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ status: 'UPSTREAM_FAILED' }) };
    }
  }

  // ★ โหมดส่งต่อรูปภาพสถานที่ (Places Photo) — คีย์อยู่ฝั่งเซิร์ฟเวอร์ ไม่โผล่ในหน้าเว็บ
  if (q.photo) {
    const params = new URLSearchParams({ photo_reference: q.photo, maxwidth: q.w || '400', key });
    try {
      const r = await fetch('https://maps.googleapis.com/maps/api/place/photo?' + params.toString());
      if (!r.ok) return { statusCode: 200, headers: cors, body: JSON.stringify({ status: 'PHOTO_FAILED' }) };
      const buf = Buffer.from(await r.arrayBuffer());
      return {
        statusCode: 200,
        headers: {
          'access-control-allow-origin': '*',
          'content-type': r.headers.get('content-type') || 'image/jpeg',
          'cache-control': 'public, max-age=604800'
        },
        body: buf.toString('base64'),
        isBase64Encoded: true
      };
    } catch (e) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ status: 'PHOTO_FAILED' }) };
    }
  }

  // ★ โหมดวัดระยะ/เวลาระหว่างจุด (Distance Matrix) — ใช้ในแผนเที่ยว
  if (q.matrix_origins && q.matrix_dests) {
    const params = new URLSearchParams({
      origins: q.matrix_origins, destinations: q.matrix_dests,
      mode: q.mode || 'walking', language: q.language || 'th', key
    });
    try {
      const r = await fetch('https://maps.googleapis.com/maps/api/distancematrix/json?' + params.toString());
      const text = await r.text();
      return { statusCode: r.status, headers: cors, body: text };
    } catch (e) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ status: 'UPSTREAM_FAILED' }) };
    }
  }

  // ★ โหมดค้นสถานที่รอบตัว (Places Nearby) — ใช้กับ "แพลนใกล้ฉัน"
  if (q.nearby && q.location) {
    const params = new URLSearchParams({
      location: q.location, radius: q.radius || '3000',
      language: q.language || 'th', key
    });
    if (q.type) params.set('type', q.type);
    if (q.keyword) params.set('keyword', q.keyword);
    try {
      const r = await fetch('https://maps.googleapis.com/maps/api/place/nearbysearch/json?' + params.toString());
      const text = await r.text();
      return { statusCode: r.status, headers: cors, body: text };
    } catch (e) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ status: 'UPSTREAM_FAILED' }) };
    }
  }

  // ★ โหมดยืนยันสถานที่จริง (Places Text Search): เรตติ้ง + จำนวนรีวิว + สถานะกิจการ
  if (q.place) {
    const params = new URLSearchParams({ query: q.place, language: q.language || 'th', key });
    try {
      const r = await fetch('https://maps.googleapis.com/maps/api/place/textsearch/json?' + params.toString());
      const text = await r.text();
      return { statusCode: r.status, headers: cors, body: text };
    } catch (e) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ status: 'UPSTREAM_FAILED' }) };
    }
  }

  if (!q.origin || !q.destination) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ status: 'MISSING_PARAMS' }) };
  }
  const params = new URLSearchParams({
    origin: q.origin,
    destination: q.destination,
    mode: q.mode || 'transit',
    language: q.language || 'th',
    alternatives: q.alternatives || 'true',
    key
  });
  if (q.mode === 'transit' && q.transit_mode) params.set('transit_mode', q.transit_mode);
  // ★ ขอตารางเวลารถจริง (รถไฟ/ชินคันเซน/รถเมล์) — 'now' หรือ unix timestamp
  if (q.mode === 'transit') params.set('departure_time', q.departure_time || 'now');
  if (q.region) params.set('region', q.region);

  try {
    const r = await fetch('https://maps.googleapis.com/maps/api/directions/json?' + params.toString());
    const text = await r.text();
    return { statusCode: r.status, headers: cors, body: text };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ status: 'UPSTREAM_FAILED' }) };
  }
};

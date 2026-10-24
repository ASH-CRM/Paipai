// คุยกับ Claude แบบสตรีม: ส่งคำตอบทีละท่อนไปที่หน้าเว็บ (Server-Sent Events)
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
const HISTORY_LIMIT = 20;            // ส่งประวัติล่าสุดไปให้ AI กี่ข้อความ
const MAX_CONTINUATIONS = 3;         // ค้นเว็บนานจน API ขอพัก (pause_turn) → ทำต่อได้กี่รอบ

let client;
const anthropic = () => (client ||= new Anthropic());   // ใช้ ANTHROPIC_API_KEY จาก Environment variables ของ Netlify

function systemPrompt(user) {
  const now = new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', dateStyle: 'full', timeStyle: 'short'
  });
  return `คุณคือ "ผู้ช่วย AI" ส่วนตัวของกลุ่มผู้ใช้เล็กๆ ในประเทศไทย ตอนนี้กำลังคุยกับคุณ${user.name}
วันเวลาปัจจุบัน (เวลาประเทศไทย): ${now}

แนวทาง:
- ตอบเป็นภาษาไทยเป็นหลัก สุภาพ เป็นกันเอง กระชับ ตรงประเด็น (ถ้าผู้ใช้พิมพ์ภาษาอื่น ตอบภาษานั้น)
- ข้อความของผู้ใช้อาจมาจากการพูดผ่านไมค์ จึงอาจมีคำผิดเล็กน้อย ให้เดาความหมายที่ตั้งใจ
- เรื่องที่ต้องใช้ข้อมูลล่าสุด เช่น ร้านอาหาร เวลาเปิด-ปิด ราคา ข่าว สภาพอากาศ ให้ค้นเว็บก่อนตอบ และบอกแหล่งที่มาสั้นๆ
- จัดรูปแบบด้วย Markdown เมื่อช่วยให้อ่านง่าย (หัวข้อสั้น รายการ ตาราง) แต่อย่ายาวเกินจำเป็น
- ตอนนี้คุณยังจองร้าน สั่งอาหาร ลงนัดในปฏิทิน หรือจ่ายเงินแทนผู้ใช้ไม่ได้ ห้ามอ้างว่าทำสำเร็จแล้ว
  ให้ช่วยเตรียมทุกอย่าง (หาร้าน เบอร์โทร ลิงก์ ขั้นตอน ข้อความที่ใช้จอง) ให้ผู้ใช้ทำต่อได้ทันที`;
}

const TOOLS = [{
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: 5,
  user_location: { type: 'approximate', country: 'TH', timezone: 'Asia/Bangkok' }
}];

/* history: [{role:'user'|'assistant', content:string}] ข้อความล่าสุดคือของผู้ใช้
   send(event) ส่งอีเวนต์ไปหน้าเว็บ · คืนข้อความคำตอบทั้งหมด */
export async function streamReply(user, history, send) {
  const messages = history.slice(-HISTORY_LIMIT).map(m => ({ role: m.role, content: m.content }));
  while (messages.length && messages[0].role !== 'user') messages.shift();

  let answer = '';
  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    const stream = anthropic().beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',          // ถ้าโมเดลหลักปฏิเสธ ให้เซิร์ฟเวอร์ส่งต่อโมเดลสำรองเอง
      system: systemPrompt(user),
      tools: TOOLS,
      messages
    });

    for await (const ev of stream) {
      if (ev.type === 'content_block_start') {
        const t = ev.content_block.type;
        if (t === 'thinking') send({ type: 'status', text: 'กำลังคิด…' });
        else if (t === 'server_tool_use') send({ type: 'status', text: 'กำลังค้นหาข้อมูลจากเว็บ…' });
        else if (t === 'text') send({ type: 'status', text: '' });
      } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        answer += ev.delta.text;
        send({ type: 'text', text: ev.delta.text });
      }
    }

    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'pause_turn') {
      // ค้นเว็บหลายรอบจนถึงขีดจำกัดของเซิร์ฟเวอร์ → ส่งคำตอบที่ได้กลับไปให้ทำต่อ (ไม่ต้องเพิ่มข้อความผู้ใช้)
      messages.push({ role: 'assistant', content: msg.content });
      continue;
    }
    if (msg.stop_reason === 'refusal' && !answer.trim()) {
      const note = 'ขออภัยครับ เรื่องนี้ผมช่วยไม่ได้';
      answer = note;
      send({ type: 'text', text: note });
    } else if (msg.stop_reason === 'max_tokens') {
      const note = '\n\n_(คำตอบยาวเกินกำหนด ถูกตัดไว้ตรงนี้ — พิมพ์ "ต่อ" เพื่อให้ตอบต่อ)_';
      answer += note;
      send({ type: 'text', text: note });
    }
    break;
  }
  return answer.trim();
}

// คุยกับ Claude แบบสตรีม + ให้ AI สั่งเมนูของแอป PAIPAI ได้
// เครื่องมือเมนู (plan_trip ฯลฯ) ทำงานที่หน้าเว็บของผู้ใช้: เซิร์ฟเวอร์ส่งคำสั่งไปให้หน้าเว็บทำ แล้วรับผลกลับมาคุยต่อ
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
const MAX_CONTINUATIONS = 3;         // ค้นเว็บนานจน API ขอพัก (pause_turn) → ทำต่อได้กี่รอบ

let client;
const anthropic = () => (client ||= new Anthropic());   // ใช้ ANTHROPIC_API_KEY จาก Environment variables ของ Netlify

function systemPrompt(user) {
  const today = new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'full' });
  return `คุณคือ "ผู้ช่วย AI" ของแอป PAIPAI (แอปผู้ช่วยเดินทาง) กำลังคุยกับคุณ${user.name}
วันนี้ (เวลาประเทศไทย): ${today}

แอปนี้มีเมนูที่คุณสั่งงานแทนผู้ใช้ได้ด้วยเครื่องมือ ผลลัพธ์จะแสดงในกรอบด้านล่างของหน้าจอให้ผู้ใช้เห็นทันที:
- Plan Pai (plan_trip): จัดตารางเที่ยวทีละวันจากสถานที่จริงใน Google Maps ได้ 1-7 วัน ต่อ 1 เมือง
- Pa Pai (find_route): หาวิธีเดินทางด้วยขนส่งสาธารณะ ขึ้นรถไฟสายไหน ลงสถานีไหน
- Pak Pai (find_stay): หาที่พักจริงพร้อมเรตติ้ง
- Jai Pai (payment_guide): วิธีจ่ายเงินในประเทศนั้น บัตรไทยใช้ได้ไหม ต้องพกเงินสดเท่าไร
- Riak Rot (call_ride): เปิดแอปเรียกรถ (Grab/Bolt/Uber ฯลฯ) พร้อมจุดหมาย ผู้ใช้แตะเลือกแอปเอง
- translator56 (start_translator): แปลบทสนทนาสด ตั้งคู่ภาษาให้พร้อม แล้วให้ผู้ใช้แตะปุ่มเริ่มพูดเอง
- สแกนป้าย/เมนูอาหาร (open_menu: scan): เปิดกล้องให้ผู้ใช้ถ่ายแล้วแปล
- แปลไฟล์/นิยาย (open_menu: doc): ผู้ใช้ต้องแตะเลือกไฟล์เอง
- แปลงสกุลเงิน (convert_currency): ใช้อัตราล่าสุด
- open_menu: เปิดเมนูใดก็ได้ให้ผู้ใช้ใช้งานเอง

แนวทาง:
- ตอบภาษาไทยเป็นหลัก สุภาพ เป็นกันเอง กระชับเหมือนคุยกัน (ผู้ใช้พิมพ์ภาษาอื่น ตอบภาษานั้น)
- ข้อความผู้ใช้อาจมาจากการพูดผ่านไมค์ อาจมีคำผิดเล็กน้อย ให้เดาความหมายที่ตั้งใจ
- เมื่อผู้ใช้ขอสิ่งที่เมนูทำได้ ให้ใช้เครื่องมือของเมนูนั้นทันที อย่าตอบเองจากความรู้ และอย่าถามข้อมูลเพิ่มถ้าพอเดาได้
  (เช่น "จัดทริปญี่ปุ่น 5 วันที่โตเกียว" → plan_trip เมือง โตเกียว 5 วัน ได้เลย)
- ก่อนเรียกเครื่องมือ บอกสั้นๆ หนึ่งประโยคว่ากำลังทำอะไร
- หลังได้ผลจากเครื่องมือ รายละเอียดเต็มแสดงอยู่ในกรอบด้านล่างแล้ว ให้สรุปไฮไลต์สั้นๆ 2-5 บรรทัด ห้ามพิมพ์รายการซ้ำทั้งหมด แล้วเสนอสิ่งที่ทำต่อได้
- ทริปเกิน 7 วันหรือหลายเมือง: จัดทีละเมืองด้วย plan_trip ได้ หรือเปิดเมนู Plan Pai ให้ผู้ใช้เพิ่มเมืองเอง
- เครื่องมือล้มเหลว: บอกผู้ใช้ตรงๆ ว่าเกิดอะไรขึ้น แล้วเสนอทางเลือก ห้ามแต่งผลขึ้นมาเอง
- เรื่องทั่วไปที่ต้องใช้ข้อมูลล่าสุด เช่น ข่าว สภาพอากาศ ราคา ให้ค้นเว็บ (web_search) และบอกแหล่งที่มาสั้นๆ
- คุณยังจอง สั่งซื้อ หรือจ่ายเงินแทนผู้ใช้ไม่ได้ ห้ามอ้างว่าทำสำเร็จ ให้เตรียมข้อมูลให้ผู้ใช้ทำต่อเอง`;
}

const LANGS = ['th-TH','en-US','ja-JP','zh-CN','zh-HK','ko-KR','vi-VN','id-ID','ms-MY','fr-FR','de-DE','es-ES','it-IT','ru-RU','ar-SA','hi-IN','pt-BR'];
const STYLES = ['culture', 'food', 'shopping', 'photo', 'themepark', 'nature', 'nightlife', 'museum', 'cafe', 'games'];

// เครื่องมือที่หน้าเว็บของผู้ใช้เป็นคนทำ (สั่งเมนูใน PAIPAI)
export const CLIENT_TOOLS = [
  {
    name: 'open_menu',
    description: 'Open a PAIPAI menu in the panel below the chat so the user can use it themselves.',
    input_schema: {
      type: 'object',
      properties: {
        menu: {
          type: 'string',
          enum: ['home', 'translator', 'scan', 'doc', 'route', 'plan', 'ride', 'pay', 'stay'],
          description: 'home = main menu, translator = translator56 live conversation translator, scan = camera to translate a menu or sign, doc = translate a file or novel (the user picks the file), route = Pa Pai transit directions, plan = Plan Pai trip planner, ride = Riak Rot ride-hailing shortcuts, pay = Jai Pai payment guide, stay = Pak Pai accommodation finder'
        }
      },
      required: ['menu']
    }
  },
  {
    name: 'plan_trip',
    description: 'Run the Plan Pai trip planner for ONE city. It builds a day-by-day itinerary from real Google Maps places and shows it in the panel below. Takes 1-3 minutes. Returns a compact version of the plan.',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'One city name, Thai or English, e.g. "โตเกียว"' },
        days: { type: 'integer', minimum: 1, maximum: 7 },
        area: { type: 'string', description: 'Optional district to focus on, e.g. "ชินจูกุ"' },
        month: { type: 'integer', minimum: 1, maximum: 12, description: 'Optional travel month' },
        styles: { type: 'array', items: { type: 'string', enum: STYLES }, description: 'Optional travel styles' },
        who: { type: 'string', enum: ['solo', 'couple', 'family', 'elderly', 'friends'] },
        budget: { type: 'string', enum: ['budget', 'standard', 'premium'] },
        hidden_gems: { type: 'boolean', description: 'Include lesser-known places' },
        must_visit: { type: 'string', description: 'Places the user must visit, comma separated' }
      },
      required: ['city', 'days']
    }
  },
  {
    name: 'find_route',
    description: 'Run Pa Pai to find public-transport routes (train/bus lines, stations) and show the options in the panel below.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Destination place' },
        from: { type: 'string', description: 'Starting place. Omit to use the user\'s current GPS location.' },
        city: { type: 'string', description: 'City or country where the trip happens, e.g. "โตเกียว"' }
      },
      required: ['to']
    }
  },
  {
    name: 'find_stay',
    description: 'Run Pak Pai to find real accommodation with ratings and show it in the panel below.',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        area: { type: 'string', description: 'Optional district, e.g. "ชินจูกุ"' }
      },
      required: ['city']
    }
  },
  {
    name: 'payment_guide',
    description: 'Open Jai Pai for a country: payment methods, whether Thai cards work, cash, tipping. Shown in the panel below.',
    input_schema: {
      type: 'object',
      properties: { country: { type: 'string', description: 'Country name in Thai, e.g. "ญี่ปุ่น"' } },
      required: ['country']
    }
  },
  {
    name: 'start_translator',
    description: 'Open translator56 (live two-way conversation translator) with the language pair set, ready for the user to tap and speak. Use for requests like "แปลไทย-ญี่ปุ่น" or "ช่วยคุยกับคนเกาหลี".',
    input_schema: {
      type: 'object',
      properties: {
        my_lang: { type: 'string', enum: LANGS, description: 'The user\'s language, usually th-TH' },
        their_lang: { type: 'string', enum: LANGS, description: 'The other person\'s language (zh-HK = Cantonese)' }
      },
      required: ['their_lang']
    }
  },
  {
    name: 'convert_currency',
    description: 'Convert money with live exchange rates in the app\'s currency converter. Supported: THB, JPY, HKD, KRW, CNY, TWD, SGD, MYR, VND, LAK, USD, EUR, GBP, AUD.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        from: { type: 'string', description: 'ISO currency code, e.g. JPY' },
        to: { type: 'string', description: 'ISO currency code, e.g. THB' }
      },
      required: ['amount', 'from', 'to']
    }
  },
  {
    name: 'call_ride',
    description: 'Open Riak Rot with the destination filled in so the user can tap a ride-hailing app.',
    input_schema: {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        city: { type: 'string', description: 'City or country, used to pick the right apps' }
      },
      required: ['destination']
    }
  }
];
export const CLIENT_TOOL_NAMES = new Set(CLIENT_TOOLS.map(t => t.name));

const TOOLS = [
  ...CLIENT_TOOLS,
  {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: 5,
    user_location: { type: 'approximate', country: 'TH', timezone: 'Asia/Bangkok' }
  }
];

/* messages: ประวัติในรูปแบบ API (ต่อท้ายอย่างเดียว ห้ามแก้ของเก่า) — ฟังก์ชันนี้ต่อท้ายคำตอบของ AI ให้เอง
   send(event) ส่งอีเวนต์ไปหน้าเว็บ
   คืน { text: ข้อความที่ AI พิมพ์รอบนี้, toolCalls: [{id,name,input}] ที่หน้าเว็บต้องทำ } */
export async function streamReply(user, messages, send) {
  let text = '';
  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    const stream = anthropic().beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',          // ถ้าโมเดลหลักปฏิเสธ ให้เซิร์ฟเวอร์ส่งต่อโมเดลสำรองเอง
      cache_control: { type: 'ephemeral' },
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
        text += ev.delta.text;
        send({ type: 'text', text: ev.delta.text });
      }
    }

    const msg = await stream.finalMessage();
    messages.push({ role: 'assistant', content: msg.content });

    if (msg.stop_reason === 'pause_turn') continue;   // ค้นเว็บค้างไว้ → ส่งกลับไปให้ทำต่อ (ไม่ต้องเพิ่มข้อความผู้ใช้)

    if (msg.stop_reason === 'tool_use') {
      const toolCalls = msg.content
        .filter(b => b.type === 'tool_use' && CLIENT_TOOL_NAMES.has(b.name))
        .map(b => ({ id: b.id, name: b.name, input: b.input }));
      if (toolCalls.length) return { text, toolCalls };
    }
    if (msg.stop_reason === 'refusal' && !text.trim()) {
      const note = 'ขออภัยครับ เรื่องนี้ผมช่วยไม่ได้';
      text = note;
      send({ type: 'text', text: note });
    } else if (msg.stop_reason === 'max_tokens') {
      const note = '\n\n_(คำตอบยาวเกินกำหนด ถูกตัดไว้ตรงนี้ — พิมพ์ "ต่อ" เพื่อให้ตอบต่อ)_';
      text += note;
      send({ type: 'text', text: note });
    }
    break;
  }
  return { text, toolCalls: [] };
}

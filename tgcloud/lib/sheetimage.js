// 🖼 An agent's day as an image: the template's day tab (របាយការណ៍ប្រចាំថ្ងៃ on
// top, របាយការណ៍សរុប ប្រចាំខែ up to that day below), with the numbers the
// workbook's formulas would show, worked out here from the saved days
// (agent_daily_totals, the same data the Excel is built from):
//   - each lottery row: 2D/3D/4D sales and win/lose (the day's `daily` cells),
//     total = 2D+3D+4D, % = win/lose ÷ total;
//   - សាងលេខ = −Σ the day's សាង member win/lose (Tbl_03), ទូទាត់ the same;
//   - Total (Daily) = win/lose + តវ៉ា + ទូទាត់; the month: the same from day 1;
//   - តវ៉ា (Tbl_02) and the Expence amounts are typed into the Excel by
//     hand, so they're 0 here (as in the workbook the bot builds).
// sheetHtml() is the page Cloudflare's browser screenshots (sdk renderImage).

const TYPES = ['MHSB', 'MC', 'MT', 'TC', 'KH', 'SC', 'TH', 'KP'];
const num = (v) => Number(v) || 0;

/** One table's rows from days' `daily` cells: [{ type, c2, c3, c4, total, wl, pct }] plus its total row. */
function table(dailies, { blank }) {
  const rows = TYPES.map((type, i) => {
    const r = 4 + i;
    const pick = (col) => {
      const vals = dailies.map((d) => d?.[`${col}${r}`]);
      return blank && vals.every((v) => v === undefined) ? null : vals.reduce((n, v) => n + num(v), 0);
    };
    const c2 = pick('C');
    const c3 = pick('D');
    const c4 = pick('E');
    const wl = pick('G');
    const total = num(c2) + num(c3) + num(c4);
    return { type, c2, c3, c4, total, wl, pct: total ? num(wl) / total : null };
  });
  const sum = (k) => rows.reduce((n, r) => n + num(r[k]), 0);
  return { rows, total: { c2: sum('c2'), c3: sum('c3'), c4: sum('c4'), total: sum('total'), wl: sum('wl') } };
}

/** −Σ the សាង members' win/lose for these days (the sheet's សាងលេខ). */
const sangOf = (list) => -list.reduce((n, d) => n + (d?.m3 ?? []).reduce((m, r) => m + num(r.winLoseAmountKhr), 0), 0);

/**
 * Everything the day tab shows for `day` ('YYYY-MM-DD'), from `days` (Map
 * day → { daily, m1, m3 }, the month's saved days up to `day`).
 */
export function sheetValues(agent, day, days, { share = 0.4 } = {}) {
  const month = day.slice(0, 7);
  const upTo = (last) => [...days.keys()].filter((d) => d.startsWith(month) && d <= last).sort().map((d) => days.get(d));
  const today = days.get(day);
  const daily = table([today?.daily], { blank: true });
  const sangDay = sangOf([today]);
  const monthDays = upTo(day);
  const monthly = table(monthDays.map((d) => d?.daily), { blank: false });
  const sangMonth = sangOf(monthDays);
  // The faint figures left of the month's totals: the same, up to the day before.
  const prevKey = day.endsWith('-01') ? null : `${month}-${String(Number(day.slice(8)) - 1).padStart(2, '0')}`;
  const prevDays = prevKey ? upTo(prevKey) : [];
  const prev = prevKey ? { complaint: 0, sang: sangOf(prevDays), total: table(prevDays.map((d) => d?.daily), { blank: false }).total.wl + sangOf(prevDays) } : null;
  return {
    username: agent.username,
    nickname: agent.nickname || '',
    day,
    monthStart: `${month}-01`,
    share,
    daily: { ...daily, complaint: 0, sang: sangDay, pay: sangDay, result: daily.total.wl + sangDay },
    monthly: { ...monthly, complaint: 0, sang: sangMonth, pay: sangMonth, result: monthly.total.wl + sangMonth, expense: 0, loan: 0, deposit: 0, inHand: monthly.total.wl + sangMonth },
    prev,
  };
}

// ---------------------------------------------------------------- html
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (v) => (v === null || v === undefined ? '' : Math.round(v).toLocaleString('en-US'));
const pct = (v) => (v === null || v === undefined ? '' : `${Math.round(v * 100)}%`);
const ddmmyy = (key) => `${key.slice(8, 10)}-${key.slice(5, 7)}-${key.slice(2, 4)}`;
const red = (v) => (v < 0 ? ' neg' : '');

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #fff; font-family: Arial, 'Battambang', sans-serif; width: 1180px; }
.kh { font-family: 'Battambang', Arial, sans-serif; }
table { border-collapse: collapse; table-layout: fixed; width: 1180px; }
col.b { width: 176px; } col.n { width: 164px; } col.f { width: 180px; } col.g { width: 164px; } col.h { width: 168px; }
td { height: 37px; padding: 0 10px; font-size: 22px; font-weight: 700; color: #000; white-space: nowrap; overflow: hidden; }
.title td { height: 36px; font-weight: 400; font-size: 18px; border-top: 1px solid #555; }
.title .user { font-family: Georgia, 'Times New Roman', serif; font-size: 24px; letter-spacing: 1px; text-align: center; border-left: 1px solid #555; }
.title .date { background: #ffff00; font-family: 'Times New Roman', serif; font-size: 21px; text-align: center; }
.head td { font-size: 18px; font-weight: 400; text-align: center; border-top: 1px solid #555; border-bottom: 3px solid #555; height: 38px; }
.head td:first-child { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-variant: small-caps; text-align: left; font-size: 19px; }
.row td { border-bottom: 1px solid #ddd; text-align: right; }
.row td + td { border-left: 1px solid #ddd; }
.row td:first-child { text-align: left; font-family: Georgia, 'Times New Roman', serif; }
.row .f { background: #ededed; }
.row .h { background: #f2f2f2; color: #2b2bff; font-family: Georgia, serif; font-weight: 400; }
.tot td { border-top: 1px solid #555; border-bottom: 1px solid #555; text-align: right; font-size: 23px; }
.tot td:first-child { text-align: center; font-weight: 400; font-size: 20px; }
.tot .p { background: #fbe3d6; } .tot .q { background: #f6c6a8; }
.tot .h, .side { background: #e7e6e6; }
.sum td { height: 36px; font-size: 22px; }
.sum .lbl { text-align: right; font-weight: 400; font-size: 18px; }
.sum .val { text-align: right; }
.sum .box { background: #c6eefa; border: 2px solid #333; }
.neg { color: #ff0000; }
.sang { color: #ff0000; font-style: italic; text-align: right; border-bottom: 3px double #333; }
.company { color: #aaa; font-weight: 400; font-size: 21px; }
.faint { color: #9a9a9a; font-weight: 400; font-size: 15px; text-align: center; }
.nick { text-align: center; font-weight: 400; font-size: 21px; vertical-align: middle; }
.gray td { background: #ebebeb; }
.blue td { background: #dce7f4; }
.deep td { background: #a9c4e8; }
.gap td { height: 28px; background: #dce7f4; border-top: 2px solid #8064a2; }
`;

function tableRows(t, { daily }) {
  return t.rows.map((r) => `<tr class="row"><td>${r.type}</td><td>${money(r.c2)}</td><td>${money(r.c3)}</td><td>${money(r.c4)}</td><td class="f">${money(r.total)}</td><td>${money(r.wl)}</td><td class="h">${pct(r.pct)}</td></tr>`).join('')
    + `<tr class="tot"><td class="kh">${daily ? 'Total(Daily)' : 'G-Total'}</td><td class="p">${money(t.total.c2)}</td><td class="p">${money(t.total.c3)}</td><td class="p">${money(t.total.c4)}</td><td class="p">${money(t.total.total)}</td><td class="q">${money(t.total.wl)}</td><td class="h"></td></tr>`;
}

/** The page: 1180 px wide, both tables. */
export function sheetHtml(v) {
  const d = v.daily;
  const m = v.monthly;
  const head = (wlLabel) => `<tr class="head kh"><td>Loterry Type</td><td>លុយលក់_2D</td><td>លុយលក់_3D</td><td>លុយលក់_4D</td><td>លុយលក់សរុប</td><td>${wlLabel}</td><td>ភាគរយ(%)</td></tr>`;
  const cols = '<colgroup><col class="b"><col class="n"><col class="n"><col class="n"><col class="f"><col class="g"><col class="h"></colgroup>';
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Battambang:wght@400;700&display=block" rel="stylesheet">
<style>${CSS}</style></head><body><div id="sheet">
<table>${cols}
<tr class="title"><td colspan="5" class="kh" style="text-align:center">របាយការណ៍ប្រចាំថ្ងៃ</td><td class="user">${esc(v.username)}</td><td class="date">${ddmmyy(v.day)}</td></tr>
${head('ស៊ី /ខាត  ប្រចាំថ្ងៃ')}
${tableRows(d, { daily: true })}
<tr class="sum gray"><td></td><td></td><td></td><td></td><td class="lbl kh">តវ៉ាប្រចាំថ្ងៃ -&gt;</td><td class="val${red(d.complaint)}">${money(d.complaint)}</td><td rowspan="3" class="nick">${esc(v.nickname)}</td></tr>
<tr class="sum gray"><td class="company kh">ក្រុមហ៊ុន ${Math.round(v.share * 100)}%</td><td class="lbl kh">សាងលេខ</td><td class="sang">${money(d.sang)}</td><td></td><td class="lbl kh">ទូទាត់(សាងលេខ) -&gt;</td><td class="val${red(d.pay)}">${money(d.pay)}</td></tr>
<tr class="sum gray"><td></td><td></td><td></td><td></td><td class="box" style="text-align:center;font-size:18px">Total (Daily)</td><td class="box val${red(d.result)}">${money(d.result)}</td></tr>
<tr class="gap"><td colspan="7"></td></tr>
<tr class="title"><td colspan="4" class="kh" style="text-align:center">របាយការណ៍សរុប ប្រចាំខែ</td><td class="user">${esc(v.username)}</td><td class="date">${ddmmyy(v.monthStart)} To</td><td class="date">${ddmmyy(v.day)}</td></tr>
${head('ស៊ី /ខាត')}
${tableRows(m, { daily: false })}
<tr class="sum blue"><td class="faint">${v.prev ? money(v.prev.complaint) : ''}</td><td></td><td></td><td></td><td class="lbl kh">តវ៉ាសរុប -&gt;</td><td class="val${red(m.complaint)}">${money(m.complaint)}</td><td rowspan="3" class="nick">${esc(v.nickname)}</td></tr>
<tr class="sum blue"><td class="faint">${v.prev ? money(v.prev.sang) : ''}</td><td class="lbl kh">សាងលេខសរុប</td><td class="sang">${money(m.sang)}</td><td></td><td class="lbl kh">លុយសាង(ទូទាត់) -&gt;</td><td class="val${red(m.pay)}">${money(m.pay)}</td></tr>
<tr class="sum blue"><td class="faint">${v.prev ? money(v.prev.total) : ''}</td><td></td><td></td><td></td><td class="box" style="text-align:center;font-size:16px">Total (Monthly)</td><td class="box val${red(m.result)}">${money(m.result)}</td></tr>
<tr class="sum deep"><td></td><td></td><td></td><td></td><td class="lbl kh" style="text-align:left;background:#fff;border:1px solid #333">ចំណាយ</td><td class="val" style="background:#fff;border:1px solid #333">${money(m.expense)}</td><td></td></tr>
<tr class="sum deep"><td></td><td></td><td></td><td></td><td class="lbl kh" style="text-align:left;background:#fff;border:1px solid #333">លុយខ្ចី</td><td class="val" style="background:#fff;border:1px solid #333">${money(m.loan)}</td><td></td></tr>
<tr class="sum deep"><td></td><td></td><td></td><td></td><td class="lbl kh" style="text-align:left;background:#fff;border:1px solid #333;font-size:16px">លុយដាក់ចូលទៅក្រុមហ៊ុន</td><td class="val" style="background:#fff;border:1px solid #333">${money(m.deposit)}</td><td></td></tr>
<tr class="sum deep"><td></td><td></td><td></td><td></td><td class="box kh" style="text-align:center;font-size:19px;font-weight:700">លុយក្នុងដៃ</td><td class="box val${red(m.inHand)}">${money(m.inHand)}</td><td></td></tr>
</table></div></body></html>`;
}

// ---------------------------------------------------------------- keyboards
const btn = (text, callback_data) => ({ text, callback_data });
const dm = (key) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

/** Under the image: ◀ / ▶ a day, 🔄, 📅 another day, back to the agent. */
export function imageKeyboard(agentId, day, { first, today }) {
  const shift = (n) => {
    const t = new Date(`${day}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  const prev = shift(-1);
  const next = shift(1);
  return {
    inline_keyboard: [
      [
        ...(prev >= first ? [btn(`◀ ${dm(prev)}`, `XLI_${agentId}_${prev}`)] : []),
        ...(next <= today ? [btn(`${dm(next)} ▶`, `XLI_${agentId}_${next}`)] : []),
      ],
      [btn('🔄 ទាញថ្មី', `XLI_${agentId}_${day}!`), btn('📅 ថ្ងៃផ្សេង', `XLD_${agentId}_${day.slice(0, 7)}`)],
      [btn('⬅️ ត្រឡប់ក្រោយ', `XLA_${agentId}`)],
    ].filter((r) => r.length),
  };
}

/** 📅 A month's days (up to today) as buttons, with ◀ ▶ months between `first` and today. */
export function imageDayPicker(agent, month, { first, today }) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = [];
  for (let d = 1; d <= last; d++) {
    const key = `${month}-${String(d).padStart(2, '0')}`;
    if (key > today) break;
    days.push(btn(key === today ? `[${d}]` : String(d), `XLI_${agent.id}_${key}`));
  }
  const rows = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  const other = (n) => new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  const nav = [
    ...(other(-1) >= first.slice(0, 7) ? [btn(`◀ ${other(-1).slice(5)}/${other(-1).slice(0, 4)}`, `XLD_${agent.id}_${other(-1)}`)] : []),
    ...(other(1) <= today.slice(0, 7) ? [btn(`${other(1).slice(5)}/${other(1).slice(0, 4)} ▶`, `XLD_${agent.id}_${other(1)}`)] : []),
  ];
  return {
    text: `<b>🖼 ${esc(agent.username)}</b> · ${month.slice(5)}/${month.slice(0, 4)}\nជ្រើសរើសថ្ងៃ:`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [...rows, ...(nav.length ? [nav] : []), [btn('⬅️ ត្រឡប់ក្រោយ', `XLI_${agent.id}`)]] },
  };
}

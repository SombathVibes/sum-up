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
// sheetHtml() / memberHtml() are the pages Cloudflare's browser screenshots (sdk renderImages).

import { FONT_CSS } from './sheetfonts.js';

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
const money = (v) => (v === null || v === undefined ? '' : (Math.round(v) || 0).toLocaleString('en-US')); // never "-0"
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

/** The day tab (1180 px wide, both tables) as { css, body }. */
export function sheetPart(v) {
  const d = v.daily;
  const m = v.monthly;
  const head = (wlLabel) => `<tr class="head kh"><td>Loterry Type</td><td>លុយលក់_2D</td><td>លុយលក់_3D</td><td>លុយលក់_4D</td><td>លុយលក់សរុប</td><td>${wlLabel}</td><td>ភាគរយ(%)</td></tr>`;
  const cols = '<colgroup><col class="b"><col class="n"><col class="n"><col class="n"><col class="f"><col class="g"><col class="h"></colgroup>';
  return { css: CSS, body: `<table>${cols}
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
</table>` };
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

// ---------------------------------------------------------------- 👥 member report
// The M_report sheet (របាយការណ៍ប្រចាំថ្ងៃបុគ្គលិកលក់): one row per member of the
// agent (its staff list, sorted by username, up to 16), with Run (2D+3D+4D) and
// Win/Lose for the day before and the day (Tbl_01, the members' report rows),
// then the month up to the day: TotalRun, Win/Lose, ត (តវ៉ា, typed by hand: 0),
// សាង (40%) = −Σ their សាង win/lose (Tbl_03), សរុប = the three, 10% of សរុប.
// Tele/FB and Page Name are typed by hand too: shown as "-".

const KH_DIGITS = '០១២៣៤៥៦៧៨៩';
const khDigits = (s) => String(s).replace(/\d/g, (d) => KH_DIGITS[d]);
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (key) => `${key.slice(8, 10)}-${EN_MONTHS[Number(key.slice(5, 7)) - 1]}-${key.slice(0, 4)}`;

/** Everything the member report shows for `day`, from the month's saved days and the agent's members. */
export function memberValues(agent, day, days, members) {
  const month = day.slice(0, 7);
  const prev = (() => {
    const t = new Date(`${day}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - 1);
    return t.toISOString().slice(0, 10);
  })();
  const roster = [...members].sort((a, b) => a.username.localeCompare(b.username)).slice(0, 16);
  const run = (r) => num(r.betAmount2DKhr) + num(r.betAmount3DKhr) + num(r.betAmount4DKhr);
  const sumFor = (username, list, field, f) => list.reduce((n, d) => n + (d?.[field] ?? []).filter((r) => r.username === username).reduce((m, r) => m + f(r), 0), 0);
  const monthDays = [...days.keys()].filter((d) => d.startsWith(month) && d <= day).sort().map((d) => days.get(d));
  const rows = roster.map((mem, i) => {
    const on = (key) => (days.has(key) ? [days.get(key)] : []);
    const totalRun = sumFor(mem.username, monthDays, 'm1', run);
    const wl = sumFor(mem.username, monthDays, 'm1', (r) => num(r.winLoseAmountKhr));
    const sang = -sumFor(mem.username, monthDays, 'm3', (r) => num(r.winLoseAmountKhr));
    const total = wl + 0 + sang;
    return {
      no: i + 1,
      name: mem.nickname || '',
      username: mem.username,
      prevRun: sumFor(mem.username, on(prev), 'm1', run),
      prevWl: sumFor(mem.username, on(prev), 'm1', (r) => num(r.winLoseAmountKhr)),
      dayRun: sumFor(mem.username, on(day), 'm1', run),
      dayWl: sumFor(mem.username, on(day), 'm1', (r) => num(r.winLoseAmountKhr)),
      totalRun,
      wl,
      complaint: 0,
      sang,
      total,
      tenth: total * 0.1,
    };
  });
  const keys = ['prevRun', 'prevWl', 'dayRun', 'dayWl', 'totalRun', 'wl', 'complaint', 'sang', 'total', 'tenth'];
  const sums = Object.fromEntries(keys.map((k) => [k, rows.reduce((n, r) => n + r[k], 0)]));
  return { username: agent.username, nickname: agent.nickname || '', day, prev, month, rows, sums };
}

const MEMBER_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #fff; font-family: Arial, 'Battambang', sans-serif; }
.kh { font-family: 'Battambang', Arial, sans-serif; }
table { border-collapse: collapse; table-layout: fixed; }
td { height: 34px; padding: 0 8px; font-size: 16px; white-space: nowrap; overflow: hidden; border: 1px solid #c8c8c8; text-align: right; color: #222; }
.top td { height: 46px; text-align: center; font-weight: 700; border-color: #999; }
.top .title { font-family: 'Moul', 'Battambang', serif; font-weight: 400; font-size: 22px; color: #3a50a0; text-align: left; }
.top .d1 { background: #bde0fb; color: #2b4fa8; font-size: 17px; }
.top .d2 { background: #d6f2c6; color: #2b4fa8; font-size: 17px; }
.top .agent { background: #dde8f7; color: #2b4fa8; font-size: 17px; }
.top .hatch { background: repeating-linear-gradient(45deg, #888 0 2px, #fff 2px 6px); }
.top .sum { font-family: 'Moul', 'Battambang', serif; font-weight: 400; font-size: 19px; color: #3a50a0; }
.top .sum i { font-family: Georgia, serif; font-size: 14px; }
.head td { height: 34px; background: #f2c4ec; text-align: center; font-weight: 700; font-size: 14px; color: #333; }
.head .b1 { background: #bde0fb; } .head .b2 { background: #d6f2c6; } .head .pg { background: #f8d9c8; } .head .ten { background: #ece9e9; }
.row td:nth-child(-n+4) { text-align: left; }
.row .c { text-align: center; }
.row .run { color: #2457c5; }
.row .b1 { background: #e3f1fd; } .row .b2 { background: #ecf8e5; } .row .pg { background: #fbe8de; }
.row .mo { color: #6a2c91; } .row .ten { background: #ece9e9; text-align: right; font-weight: 700; }
.neg { color: #ff0000 !important; }
.riel { font-family: 'Noto Sans Khmer', sans-serif; font-weight: 400; margin-left: 1px; }
.tot td { height: 36px; font-weight: 400; color: #2457c5; background: #f4f4f4; }
.tot .lbl { text-align: left; color: #222; }
.tot .mo { color: #6a2c91; }
`;

// ៛ in Noto Sans Khmer: Battambang has no glyph for it (Cloudflare's browser showed a box).
const riel = (v) => `${money(v)}<span class="riel">៛</span>`;
const dash = () => '-';

/** The member report (2000 px wide) as { css, body }. */
export function memberPart(v) {
  const cls = (n, base) => `${base}${n < 0 ? ' neg' : ''}`;
  const widths = [52, 150, 110, 140, 112, 112, 112, 112, 84, 84, 84, 84, 120, 120, 112, 92, 104, 112, 100];
  const rows = v.rows.map((r) => `<tr class="row"><td class="c">${r.no}</td><td class="kh">${esc(r.name)}</td><td class="c"></td><td>${esc(r.username)}</td>`
    + `<td class="b1 run">${money(r.prevRun)}</td><td class="${cls(r.prevWl, 'b1')}">${money(r.prevWl)}</td>`
    + `<td class="b2 run">${money(r.dayRun)}</td><td class="${cls(r.dayWl, 'b2')}">${money(r.dayWl)}</td>`
    + `<td class="c">${dash()}</td><td class="c">${dash()}</td><td class="c">${dash()}</td><td class="c">${dash()}</td><td class="pg"></td>`
    + `<td class="mo">${riel(r.totalRun)}</td><td class="${cls(r.wl, 'mo')}">${riel(r.wl)}</td><td class="${cls(r.complaint, 'mo')}">${riel(r.complaint)}</td>`
    + `<td class="${cls(r.sang, 'mo')}">${riel(r.sang)}</td><td class="${cls(r.total, 'mo')}">${riel(r.total)}</td><td class="${cls(r.tenth, 'ten')}">${riel(Math.round(r.tenth))}</td></tr>`).join('');
  const s = v.sums;
  return { css: MEMBER_CSS, body: `<table><colgroup>${widths.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>
<tr class="top"><td colspan="4" class="title kh">របាយការណ៍ប្រចាំថ្ងៃបុគ្គលិកលក់</td><td colspan="2" class="d1">${longDate(v.prev)}</td><td colspan="2" class="d2">${longDate(v.day)}</td>`
    + `<td colspan="2" class="agent">${esc(v.username)}</td><td colspan="2" class="agent">${esc(v.nickname)}</td><td class="hatch"></td>`
    + `<td colspan="4" class="sum kh">សរុបរបស់ Member <i>(Daily Report)</i></td><td colspan="2" class="sum kh">${khDigits(v.month.slice(5))}-${v.month.slice(0, 4)}</td></tr>
<tr class="head"><td>No</td><td>Staff_Name</td><td>Start_Work</td><td>User_Name</td><td class="b1">Run</td><td class="b1">Win/Lose</td><td class="b2">Run</td><td class="b2">Win/Lose</td>`
    + `<td>Tele(Old)</td><td>Tele(New)</td><td>FB(Old)</td><td>FB(New)</td><td class="pg">Page Name</td><td>TotalRun</td><td>Win/Lose</td><td class="kh">តវ៉ា</td><td class="kh">សាង (40%)</td><td class="kh">សរុប</td><td class="ten">10%</td></tr>
${rows}
<tr class="tot"><td></td><td class="lbl kh">សរុប</td><td></td><td></td><td>${money(s.prevRun)}</td><td class="${s.prevWl < 0 ? 'neg' : ''}">${money(s.prevWl)}</td><td>${money(s.dayRun)}</td><td class="${s.dayWl < 0 ? 'neg' : ''}">${money(s.dayWl)}</td>`
    + `<td class="c">-</td><td class="c">-</td><td class="c">-</td><td class="c">-</td><td></td>`
    + `<td class="mo">${riel(s.totalRun)}</td><td class="mo">${riel(s.wl)}</td><td class="mo${s.complaint < 0 ? ' neg' : ''}">${riel(s.complaint)}</td><td class="mo${s.sang < 0 ? ' neg' : ''}">${riel(s.sang)}</td><td class="mo">${riel(s.total)}</td><td class="mo">${riel(Math.round(s.tenth))}</td></tr>
</table>` };
}

// ---------------------------------------------------------------- page
/** Rules of one part's CSS under `scope` (both parts style td, .row, … their own way). */
function scoped(css, scope) {
  return css.replace(/([^{}]+)\{/g, (_, sel) => `${sel.split(',').map((x) => {
    const t = x.trim();
    if (t === 'body') return scope;
    return `${scope} ${t === '*' ? '*' : t}`;
  }).join(', ')} {`);
}


/** A page of parts stacked in #sheet, each scaled by `zoom` to `width` px. */
function page(parts, width) {
  const css = parts.map((p, i) => scoped(p.css, `.part${i}`)).join('\n');
  const body = parts.map((p, i) => `<div class="part${i}" style="zoom:${(width / p.width).toFixed(4)};width:${p.width}px">${p.body}</div>`).join('<div style="height:24px"></div>');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}\n* { box-sizing: border-box; margin: 0; padding: 0; } body { background: #fff; }\n${css}</style></head>`
    + `<body><div id="sheet" style="width:${width}px;background:#fff">${body}</div></body></html>`;
}

/** The day tab alone (the 1180 px page). */
export const sheetHtml = (v) => page([{ ...sheetPart(v), width: 1180 }], 1180);
/** The member report alone. */
export const memberHtml = (v) => page([{ ...memberPart(v), width: 2000 }], 2000);

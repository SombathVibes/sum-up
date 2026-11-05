import assert from 'node:assert/strict';
const L = new URL('../tgcloud/lib', import.meta.url).href;
const D = await import(`${L}/dates.js`);
const { parseAmount } = await import(`${L}/parse.js`);
const ui = await import(`${L}/ui.js`);
const R = await import(`${L}/report.js`);

// Phnom Penh: 2026-11-02 23:30 UTC = 2026-11-03 06:30 PP
const ts = Date.UTC(2026, 10, 2, 23, 30) / 1000;
assert.deepEqual(D.dayOf(ts), { y: 2026, m: 11, d: 3 });
assert.equal(D.startOf({ y: 2026, m: 11, d: 3 }), Date.UTC(2026, 10, 2, 17) / 1000);
const wk = D.weekRange({ y: 2026, m: 11, d: 3 }); // Tue → Mon 2nd .. Sun 8th
assert.deepEqual([D.dayOf(wk.start), D.dayOf(wk.end)], [{ y: 2026, m: 11, d: 2 }, { y: 2026, m: 11, d: 8 }]);
const sun = D.weekRange({ y: 2026, m: 11, d: 8 });
assert.deepEqual(D.dayOf(sun.start), { y: 2026, m: 11, d: 2 });
const mo = D.monthRange(2026, 2);
assert.deepEqual([D.dayOf(mo.start), D.dayOf(mo.end)], [{ y: 2026, m: 2, d: 1 }, { y: 2026, m: 2, d: 28 }]);
assert.deepEqual(D.addMonths({ y: 2026, m: 1 }, -2), { y: 2025, m: 11 });
assert.deepEqual(D.addDays({ y: 2026, m: 3, d: 1 }, -1), { y: 2026, m: 2, d: 28 });
assert.equal(D.formatTime(ts), '06:30AM');
assert.equal(D.formatTime(Date.UTC(2026, 10, 3, 5, 5) / 1000), '12:05PM');

assert.deepEqual(parseAmount('$12.34 paid by SOK'), { currency: 'USD', amount: 1234 });
assert.deepEqual(parseAmount('Received $1,234 from'), { currency: 'USD', amount: 123400 });
assert.deepEqual(parseAmount('៛4,000 paid by'), { currency: 'KHR', amount: 400000 });
assert.deepEqual(parseAmount('ទទួលបាន 4000 រៀល'), { currency: 'KHR', amount: 400000 });
assert.deepEqual(parseAmount('12.5 ដុល្លារ'), { currency: 'USD', amount: 1250 });
assert.equal(parseAmount('hello'), null);

assert.equal(R.money(123456), '1,234.56');
assert.equal(R.money(400000), '4,000');
assert.equal(R.money(1250), '12.5');
assert.equal(R.money(0), '0');

// Bank day picker: a week of days, • on days with payments, older weeks a page back.
const today = { y: 2026, m: 11, d: 3 };
const days = ui.bankDayPicker(today, 0, new Set(['2026-11-02', '2026-10-31'])).reply_markup.inline_keyboard;
assert.deepEqual(days.slice(0, 3).flat().map((b) => [b.text, b.callback_data]), [
  ['ថ្ងៃនេះ', 'DATE_2026-11-03'], ['ម្សិលមិញ •', 'DATE_2026-11-02'],
  ['01/11', 'DATE_2026-11-01'], ['31/10 •', 'DATE_2026-10-31'], ['30/10', 'DATE_2026-10-30'],
  ['29/10', 'DATE_2026-10-29'], ['28/10', 'DATE_2026-10-28'],
]);
assert.deepEqual(days[3].map((b) => b.callback_data), ['BANKWK_1']); // no "next week" on the current one
const lastWeek = ui.bankDayPicker(today, 1, new Set()).reply_markup.inline_keyboard;
assert.deepEqual([lastWeek[0][0].callback_data, lastWeek[3].map((b) => b.callback_data)], ['DATE_2026-10-27', ['BANKWK_2', 'BANKWK_0']]);
assert.deepEqual(ui.bankPeriodPicker(today).reply_markup.inline_keyboard.slice(0, 2).flat().map((b) => b.callback_data), ['THIS_WEEK', 'LAST_WEEK', 'THIS_MONTH', 'LAST_MONTH']);
// 📊 opens the type choice: 📋 today, 💰 this week (as the lottery report).
assert.deepEqual(ui.bankTypePicker().reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['TODAY', 'THIS_WEEK', 'BACK']);
// A day's buttons, as on the lottery report: ◀ / ▶ by date (keeping the view), 🔄 and 📅, then ⬅️ to the type choice.
const kb = ui.reportKeyboard('DATE_2026-11-02', 'DATE_2026-11-01', 'DATE_2026-11-03', { cards: true, daily: false, bank: null }, { day: true }).inline_keyboard;
assert.deepEqual(kb.slice(1).map((r) => r.map((b) => [b.text, b.callback_data])), [
  [['◀ 01/11', 'DATE_2026-11-01~c'], ['03/11 ▶', 'DATE_2026-11-03~c']],
  [['🔄 ទាញថ្មី', 'DATE_2026-11-02~c!'], ['📅 ថ្ងៃផ្សេង', 'BANKWK_0']],
  [['⬅️ ត្រឡប់ក្រោយ', 'BANK']],
]);
assert.equal(kb[2][0].style, 'success');
// A week: ◀ 🔄 ▶ (no ▶ on the current one), 📅 រយៈពេលផ្សេង.
const wkb = ui.reportKeyboard('WEEK_2026-11-02', 'WEEK_2026-10-26', null, { cards: false, daily: false, bank: null }).inline_keyboard;
assert.deepEqual(wkb.map((r) => r.map((b) => b.callback_data)), [['WEEK_2026-10-26', 'WEEK_2026-11-02!'], ['BANKTOT'], ['BANK']]);

const day = { y: 2026, m: 11, d: 3 };
const first = D.startOf(day) + 3600 * 8, last = D.startOf(day) + 3600 * 17;
const end = D.startOf({ y: 2026, m: 12, d: 3 }) + 3600;
assert.equal(ui.menuText({ kind: 'paid', end, daysLeft: 29 }).split('\n')[0], '📅 សុពលភាពដល់ 03/12/2026 · នៅសល់ 29 ថ្ងៃ');
assert.equal(ui.menuText({ kind: 'trial', end, daysLeft: 29 }).split('\n')[0], '📅 សាកល្បងដល់ 03/12/2026 · នៅសល់ 29 ថ្ងៃ');
assert.equal(ui.menuText({ kind: 'paid', end, daysLeft: 2 }).split('\n')[0], '⚠️ ផុតកំណត់ 03/12/2026 · នៅសល់ 2 ថ្ងៃ — ចុច ⭐ ការជាវ');
assert.equal(ui.menuText({ kind: 'renewing', end, daysLeft: 2 }).split('\n')[0], '🔁 បន្តស្វ័យប្រវត្តិ 03/12/2026');
assert.equal(ui.menuText({ kind: 'lifetime' }).split('\n')[0], '♾️ អចិន្ត្រៃយ៍');
assert.equal(ui.menuText(null), ui.MENU_TEXT);
const hasBilling = (status) => ui.menuKeyboard(false, status).inline_keyboard.flat().some((b) => b.callback_data === 'BILLING');
assert.equal(hasBilling({ kind: 'paid', end, daysLeft: 8 }), false);  // more than 7 days left: hidden
assert.equal(hasBilling({ kind: 'trial', end, daysLeft: 7 }), true);  // 7 days or less: shown
// The ⚠️ line comes with the button: 7 days or less, not 8.
assert.ok(ui.menuText({ kind: 'paid', end, daysLeft: 7 }).startsWith('⚠️ ផុតកំណត់ 03/12/2026 · នៅសល់ 7 ថ្ងៃ'));
assert.ok(ui.menuText({ kind: 'paid', end, daysLeft: 8 }).startsWith('📅 សុពលភាពដល់'));
assert.equal(hasBilling({ kind: 'lifetime' }), false);
assert.equal(hasBilling(null), true);
// View flags round-trip through callback data.
assert.deepEqual(ui.parseView(ui.viewKey('MONTH_2026-11', { daily: true, bank: 1148497258 })), { key: 'MONTH_2026-11', view: { cards: false, daily: true, bank: 1148497258 } });
assert.deepEqual(ui.parseView('DATE_2026-11-03~t'), { key: 'DATE_2026-11-03', view: { cards: false, daily: false, bank: null } });
assert.ok(ui.viewKey('CMONTH_2026-11', { daily: true, bank: 6336847041 }).length + 1 <= 64); // callback_data limit, with '!'

// Week report with two banks: combined day rows, bank lines, busiest day, comparison.
{
  const ABA = 1148497258, WING = 6336847041;
  const wk = D.weekRange({ y: 2026, m: 11, d: 3 });
  const at = (d, h) => D.startOf({ y: 2026, m: 11, d }) + h * 3600;
  const { text, rich } = R.rangeReport(wk, {
    days: [
      { day: '2026-11-02', currency: 'KHR', total: 9240000, ops: 7 },
      { day: '2026-11-02', currency: 'USD', total: 1250, ops: 1 },
      { day: '2026-11-03', currency: 'KHR', total: 13970000, ops: 14 },
    ],
    bots: [
      { botTgId: ABA, currency: 'KHR', total: 20000000, ops: 18, first: at(2, 8), last: at(3, 17) },
      { botTgId: WING, currency: 'KHR', total: 3210000, ops: 3, first: at(2, 9), last: at(3, 12) },
      { botTgId: WING, currency: 'USD', total: 1250, ops: 1, first: at(2, 10), last: at(2, 10) },
    ],
    prev: [{ botTgId: ABA, currency: 'KHR', total: 20000000, ops: 10, first: 0, last: 0 }],
  }, { username: 'sombath' });
  assert.ok(text.includes('📊 សប្ដាហ៍ 02/11 – 08/11/2026'));
  assert.ok(text.includes('Mon 02         8         92,400        12.5'));
  assert.ok(text.includes('Wed 04         ·              ·           ·'));
  assert.ok(text.includes('Total         22        232,100        12.5'));
  assert.ok(text.includes('🏦 ABA 18 · ៛200,000'));
  assert.ok(text.includes('🏦 WING 4 · ៛32,100 · $12.5'));
  assert.ok(text.includes('📈 ថ្ងៃច្រើនបំផុត: Tue 03/11 · 14 ប្រតិ. · ៛139,700'));
  assert.ok(text.includes('ធៀបសប្ដាហ៍មុន: ៛ ↗️ +16%'));
  // The rich form: a real table with Khmer headers and the total row headed សរុប.
  assert.ok(rich.includes('<th>ថ្ងៃ</th>') && rich.includes('<th align="right">រៀល</th>'));
  assert.ok(rich.includes('<td><b>សរុប</b></td><td align="right"><b>22</b></td>'));
  // Month view, per week by default.
  const mo = R.rangeReport(D.monthRange(2026, 11), { days: [{ day: '2026-11-03', currency: 'KHR', total: 100000, ops: 2 }], bots: [], prev: [] }, {}, { month: true }).text;
  assert.ok(mo.includes('📊 ខែ 11/2026') && mo.includes('01–01') && mo.includes('02–08') && mo.includes('30–30'));
  assert.ok(mo.includes('📅 មានប្រតិបត្តិការ 1/30 ថ្ងៃ · មធ្យម ៛1,000/ថ្ងៃ'));
}
// Day comparisons: vs yesterday and vs the same weekday last week.
{
  const row = (total, ops) => [{ botTgId: 1148497258, currency: 'KHR', total, ops, first: 0, last: 0 }];
  const day = { y: 2026, m: 11, d: 3 };
  const t = R.dayTable(day, row(10970000, 10), {}, { yesterday: row(7240000, 6), lastWeek: row(10970000, 9) });
  for (const form of [t.text, t.rich]) {
    assert.ok(form.includes('ធៀបម្សិលមិញ: ៛ ↗️ +52%'));
    assert.ok(form.includes('ធៀបថ្ងៃអង្គារមុន: ៛ → 0%'));
  }
  assert.ok(!R.dayTable(day, row(100, 1), {}, { yesterday: [], lastWeek: [] }).text.includes('ធៀប'));
  assert.ok(R.dayReport(day, row(10970000, 10), {}, [], { yesterday: row(7240000, 6) }).text.includes('ធៀបម្សិលមិញ: ៛ ↗️ +52%'));
}
// lib/rich.js: one Doc, two forms.
{
  const { Doc, col } = await import(`${L}/rich.js`);
  const cols = [col('ថ្ងៃ', 'Day', 6), col('ចាក់', 'Bet', 10)];
  const { text, rich } = new Doc().title('T').line('a').line('').gap().table(cols, [['02', '1,000']], { total: ['Total', '1,000'], fold: 'F' }).rule().out();
  assert.equal(text, '<b>T</b>\na\n\n\n<blockquote expandable><pre>Day          Bet\n────────────────\n02         1,000\n────────────────\nTotal      1,000</pre></blockquote>\n\n━━━━━━━━━━━━');
  assert.equal(rich, '<h3>T</h3><p>a</p><p><br></p><details><summary>F</summary><table bordered striped compact><tr><th>ថ្ងៃ</th><th align="right">ចាក់</th></tr><tr><td>02</td><td align="right">1,000</td></tr><tr><td><b>សរុប</b></td><td align="right"><b>1,000</b></td></tr></table></details><hr/>');
  // Cell text is escaped in both forms.
  assert.ok(new Doc().table(cols, [['<b>', '&']]).out().rich.includes('<td>&lt;b&gt;</td><td align="right">&amp;</td>'));
}
console.log('ALL OK');

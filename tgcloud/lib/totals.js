// 💰 សរុប: the group's bound member's totals for a day, a week (Mon–Sun) or
// a month, beside the 📥 by-draw report. The numbers are the member's rows of
// report/ and send/total-report/all, saved per day in agent_daily_totals (lib/agents.js)
// and shared with the agent Excel; a period adds its days up.
//
// Buttons: TOT (period picker), TOT_D_<YYYY-MM-DD>, TOT_W_<monday>, TOT_M_<YYYY-MM>;
// a trailing '!' (🔄) fetches today again instead of using its 5-minute-old row.

import { memberTotals } from './agents.js';
import { addDays, addMonths, dayKey, monthKey, parseDayKey, parseMonthKey, startOf, today } from './dates.js';
import { REPORT_NAME } from './daily.js';

const btn = (text, callback_data) => ({ text, callback_data });
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const riel = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const dm = (key) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
const profit = (wl) => (wl < 0 ? `📉 ខាត ៛${riel(-wl)}` : `📈 ចំណេញ ៛${riel(wl)}`);

/** Monday of the week containing a day ('YYYY-MM-DD'). */
function mondayOf(key) {
  const day = parseDayKey(key);
  const weekday = new Date((startOf(day) + 7 * 3600) * 1000).getUTCDay(); // 0 = Sunday
  return dayKey(addDays(day, weekday === 0 ? -6 : 1 - weekday));
}

const daysFrom = (first, count) => Array.from({ length: count }, (_, i) => dayKey(addDays(parseDayKey(first), i)));

/**
 * A period from its button: { kind, key, days (up to today), label, prev, next }.
 * prev/next are the neighbouring periods' button data (next is null past today).
 */
export function periodOf(data) {
  const todayKey = dayKey(today());
  let m = /^TOT_D_(\d{4}-\d\d-\d\d)$/.exec(data);
  if (m && parseDayKey(m[1]) && m[1] <= todayKey) {
    const key = m[1];
    const next = dayKey(addDays(parseDayKey(key), 1));
    return {
      kind: 'day', key, days: [key],
      label: `ថ្ងៃ ${key.split('-').reverse().join('/')}`,
      prev: `TOT_D_${dayKey(addDays(parseDayKey(key), -1))}`, next: next <= todayKey ? `TOT_D_${next}` : null,
      prevLabel: 'ធៀបម្សិលមិញ',
    };
  }
  m = /^TOT_W_(\d{4}-\d\d-\d\d)$/.exec(data);
  if (m && parseDayKey(m[1]) && m[1] <= todayKey) {
    const key = mondayOf(m[1]);
    const days = daysFrom(key, 7).filter((d) => d <= todayKey);
    const next = dayKey(addDays(parseDayKey(key), 7));
    return {
      kind: 'week', key, days,
      label: `សប្ដាហ៍ ${dm(key)} – ${dm(daysFrom(key, 7)[6])}/${key.slice(0, 4)}`,
      prev: `TOT_W_${dayKey(addDays(parseDayKey(key), -7))}`, next: next <= todayKey ? `TOT_W_${next}` : null,
      prevLabel: 'ធៀបសប្ដាហ៍មុន',
    };
  }
  m = /^TOT_M_(\d{4}-\d\d)$/.exec(data);
  if (m && parseMonthKey(m[1]) && m[1] <= todayKey.slice(0, 7)) {
    const mo = parseMonthKey(m[1]);
    const last = new Date(Date.UTC(mo.y, mo.m, 0)).getUTCDate();
    const days = daysFrom(`${m[1]}-01`, last).filter((d) => d <= todayKey);
    const next = monthKey(addMonths(mo, 1));
    return {
      kind: 'month', key: m[1], days,
      label: `ខែ ${m[1].slice(5)}/${m[1].slice(0, 4)}${days.length < last ? ` (01–${days.at(-1).slice(8)})` : ''}`,
      prev: `TOT_M_${monthKey(addMonths(mo, -1))}`, next: next <= todayKey.slice(0, 7) ? `TOT_M_${next}` : null,
      prevLabel: 'ធៀបខែមុន',
    };
  }
  return null;
}

/** The comparison period's days: the previous one, cut to as many days as this one has so far. */
function previousDays(p) {
  const q = periodOf(p.prev);
  return q ? q.days.slice(0, p.days.length) : [];
}

/** TOT: pick a period. Plus a way back to the by-draw report. */
export function totalsPicker() {
  const t = dayKey(today());
  const y = dayKey(addDays(today(), -1));
  const thisMonday = mondayOf(t);
  const month = t.slice(0, 7);
  return {
    text: `<b>💰 សរុប</b>\nជ្រើសរើសរយៈពេល:`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [btn('ថ្ងៃនេះ', `TOT_D_${t}`), btn('ម្សិលមិញ', `TOT_D_${y}`)],
        [btn('សប្ដាហ៍នេះ', `TOT_W_${thisMonday}`), btn('សប្ដាហ៍មុន', `TOT_W_${dayKey(addDays(parseDayKey(thisMonday), -7))}`)],
        [btn('ខែនេះ', `TOT_M_${month}`), btn('ខែមុន', `TOT_M_${monthKey(addMonths(parseMonthKey(month), -1))}`)],
        [btn(`📋 ${REPORT_NAME} (ប្រចាំវេន)`, 'DREPORT')],
        [btn('⬅️ ត្រឡប់ក្រោយ', 'BACK')],
      ],
    },
  };
}

/** One period's totals for the group's bound member (`refresh`: today fetched again). */
export async function totalsScreen(group, cfg, data, { refresh = false } = {}) {
  const p = periodOf(data);
  if (!p) return totalsPicker();
  const [cur, prev] = await Promise.all([memberTotals(group, cfg, p.days, { refresh }), memberTotals(group, cfg, previousDays(p)).catch(() => null)]);
  const r = cur.report;
  const s = cur.send;
  const lines = [
    `<b>💰 សរុប · ${p.label}</b>`,
    `🏪 ${escape(group.name ?? group.tgId)} · 👤 ${escape(cfg.memberName || cfg.memberCode)}`,
    '',
  ];
  if (!r.commissionKhr && !r.winLoseAmountKhr && !s.commissionKhr) {
    lines.push('មិនទាន់មានការចាក់ទេ។');
  } else {
    lines.push(
      `<b>${profit(r.winLoseAmountKhr)}</b>`,
      `ចាក់ ៛${riel(r.commissionKhr)}${[['2D', r.betAmount2DKhr], ['3D', r.betAmount3DKhr], ['4D', r.betAmount4DKhr]].filter(([, v]) => v).map(([k, v]) => ` · ${k} ៛${riel(v)}`).join('')}`,
      `សង ៛${riel(r.rewardAmountKhr)}`,
    );
    if (r.winLoseAmountUsd) lines.push(`💵 USD: $${Number(r.winLoseAmountUsd).toFixed(2)}`);
    const before = prev && !prev.missing ? prev.report.winLoseAmountKhr : null;
    if (before) {
      const pct = Math.round(((r.winLoseAmountKhr - before) / Math.abs(before)) * 100);
      lines.push(`${p.prevLabel} (៛${riel(before)}): ${pct > 0 ? '↗️ +' : pct < 0 ? '↘️ ' : '→ '}${pct}%`);
    }
    if (s.commissionKhr || s.winLoseAmountKhr) {
      lines.push('', `<b>📤 សាង · ${profit(s.winLoseAmountKhr)}</b>`, `ចាក់ ៛${riel(s.commissionKhr)} · សង ៛${riel(s.rewardAmountKhr)}`);
    }
    // A week or month: the days, folded.
    if (p.kind !== 'day') {
      const line = (a, b, c) => `${String(a).padEnd(7)}${String(b).padStart(12)}${String(c).padStart(12)}`;
      const rule = '─'.repeat(31);
      const rows = cur.perDay.filter((d) => d.report || d.send).map((d) => line(dm(d.day), riel(d.report?.commissionKhr), riel(d.report?.winLoseAmountKhr)));
      if (rows.length) {
        lines.push('', `<blockquote expandable><pre>${escape([line('Day', 'Bet', 'W/L'), rule, ...rows, rule, line('Total', riel(r.commissionKhr), riel(r.winLoseAmountKhr))].join('\n'))}</pre></blockquote>`);
      }
    }
  }
  if (cur.missing) lines.push('', `⏳ ទាញបាន ${p.days.length - cur.missing}/${p.days.length} ថ្ងៃ — ចុច «🔄 ទាញថ្មី» ដើម្បីបន្ត។${cur.error ? `\n⚠️ ${escape(cur.error.slice(0, 160))}` : ''}`);
  const nav = [btn(`◀`, p.prev)];
  nav.push(btn('🔄 ទាញថ្មី', `${data}!`));
  if (p.next) nav.push(btn('▶', p.next));
  return {
    text: lines.join('\n'),
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [nav, [btn('📅 រយៈពេលផ្សេង', 'TOT'), btn('⬅️ ត្រឡប់ក្រោយ', 'BACK')]] },
  };
}

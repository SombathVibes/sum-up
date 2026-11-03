// A small SVG bar chart: one bar per day, height = that day's amount in the
// chosen currency. No chart library — a Mini App should load fast on phones.

import { amount, shortDay } from '../format.js';

export default function BarChart({ days, currency = 'KHR', height = 120, compact = false }) {
  const max = Math.max(1, ...days.map((d) => d[currency]));
  const w = 100 / Math.max(days.length, 1);
  const total = days.reduce((t, d) => t + d[currency], 0);
  return (
    <figure className={compact ? 'chart compact' : 'chart'}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label={`${currency} per day`}>
        {days.map((d, i) => {
          const h = (d[currency] / max) * (height - 4);
          return (
            <rect key={d.day} x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={Math.max(h, d[currency] ? 1 : 0)} rx="0.6">
              <title>{`${shortDay(d.day)} · ${amount(d[currency], currency)} · ${d.ops}`}</title>
            </rect>
          );
        })}
      </svg>
      {!compact && (
        <figcaption className="muted small">
          <span>{shortDay(days[0]?.day ?? '')}</span>
          <span>{currency} · {amount(total, currency)}</span>
          <span>{shortDay(days.at(-1)?.day ?? '')}</span>
        </figcaption>
      )}
    </figure>
  );
}

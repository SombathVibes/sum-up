// Loading placeholders. Each one is the real card's own markup with sample
// text in place of the numbers, and that text painted as a shimmering bar
// (.skt: transparent text on a shimmer), so a placeholder is exactly as tall
// as the card that replaces it and the page doesn't jump when data arrives.
// Labels that don't depend on the data stay readable. Sample text has no
// emoji: colour emoji ignore `color: transparent`.

import BarChart from './BarChart.jsx';

/** Sample text shown as a shimmering bar of its own size. */
export const Skt = ({ as: Tag = 'span', className = '', children = '៛000,000' }) => <Tag className={`skt ${className}`}>{children}</Tag>;

// A chart with no bars, for the chart's exact height (its labels shimmer too).
const blankDays = (n) => Array.from({ length: n }, (_, i) => ({ day: `0000-00-${String(i).padStart(2, '0')}`, KHR: 0, USD: 0, ops: 0 }));

const busy = { 'aria-busy': 'true', 'aria-label': 'កំពុងផ្ទុក' };

/** A group card on the list (Groups.jsx). */
export function GroupCardSkeleton() {
  return (
    <div className="card group skeleton" {...busy}>
      <div className="row">
        <Skt as="strong" className="name">Group name here</Skt>
        <Skt className="badge">00 ថ្ងៃ</Skt>
      </div>
      <BarChart days={blankDays(30)} compact height={40} />
      <div className="row muted small">
        <Skt>៣០ ថ្ងៃ: ៛000,000</Skt>
        <Skt>00 ប្រតិ.</Skt>
      </div>
    </div>
  );
}

/** The bank part of a group's report (Group.jsx): totals, the daily chart, the banks. */
export function GroupReportSkeleton() {
  return (
    <>
      <section className="card totals skeleton" {...busy}>
        <div><div className="muted small">KHR</div><Skt as="strong">៛000,000</Skt></div>
        <div><div className="muted small">USD</div><Skt as="strong">$000</Skt></div>
        <div><div className="muted small">ប្រតិ.</div><Skt as="strong">000</Skt></div>
      </section>
      <p className="muted small">ធៀបនឹងរយៈពេលស្មើគ្នាមុននេះ</p>
      <section className="card skeleton" {...busy}>
        <div className="row">
          <strong>ប្រចាំថ្ងៃ</strong>
          <div className="segmented small"><button type="button" className="on" disabled>KHR</button><button type="button" disabled>USD</button></div>
        </div>
        <BarChart days={blankDays(30)} />
      </section>
      <section className="card skeleton" {...busy}>
        <strong>ធនាគារ</strong>
        <table className="table">
          <thead><tr><th>Bank</th><th>Ops</th><th>KHR</th><th>USD</th></tr></thead>
          <tbody><tr><td><Skt>ABA</Skt></td><td><Skt>00</Skt></td><td><Skt>៛000,000</Skt></td><td><Skt>$0</Skt></td></tr></tbody>
        </table>
      </section>
    </>
  );
}

const SideSkeleton = ({ title }) => (
  <div className="side">
    <div className="small"><strong>{title}</strong></div>
    <div className="totals">
      <div><div className="muted small">ចាក់</div><Skt as="strong">៛000,000</Skt></div>
      <div><div className="muted small">សង</div><Skt as="strong">៛000,000</Skt></div>
      <div><div className="muted small">ចំណេញ</div><Skt as="strong">៛000,000</Skt></div>
    </div>
  </div>
);

/** A group's lottery summary (LotteryCard.jsx). */
export function LotterySkeleton() {
  return (
    <section className="card lottery skeleton" {...busy}>
      <div className="row">
        <strong>🎰 របាយការណ៍ឆ្នោត</strong>
        <Skt className="muted small">DLAAAAAA000</Skt>
      </div>
      <div className="final">
        <div className="muted small">💵 សរុបចុងក្រោយ</div>
        <Skt as="strong" className="big">ចំណេញ ៛000,000</Skt>
        <Skt as="div" className="muted small">៛000,000 − សាង ៛00,000</Skt>
      </div>
      <SideSkeleton title="🎰 ឆ្នោត" />
      <SideSkeleton title="📤 សាង" />
      <details className="days"><summary className="small"><Skt>ប្រចាំថ្ងៃ (0)</Skt></summary></details>
    </section>
  );
}

/** A generic card: a title bar and `lines` text bars (screens with no fixed shape). */
export function SkeletonCard({ lines = 3, className = '' }) {
  return (
    <section className={`card skeleton ${className}`} {...busy}>
      <div className="sk sk-title" />
      {Array.from({ length: lines }, (_, i) => <div key={i} className="sk sk-line" style={{ width: `${[92, 76, 84, 60, 70][i % 5]}%` }} />)}
    </section>
  );
}

/** `cards` generic placeholder cards. */
export default function Skeleton({ cards = 2, ...card }) {
  return <>{Array.from({ length: cards }, (_, i) => <SkeletonCard key={i} {...card} />)}</>;
}

// Loading placeholders: cards with shimmering bars in the shape of what's
// coming (a title, an optional chart, a few lines), instead of a
// 'កំពុងផ្ទុក…' line. Screen readers hear one "loading" per card.

const WIDTHS = [92, 76, 84, 60, 70];

/** One placeholder card: a title bar, an optional chart block, `lines` text bars. */
export function SkeletonCard({ lines = 3, chart = false, className = '' }) {
  return (
    <section className={`card skeleton ${className}`} aria-busy="true" aria-label="កំពុងផ្ទុក">
      <div className="sk sk-title" />
      {chart && <div className="sk sk-chart" />}
      {Array.from({ length: lines }, (_, i) => <div key={i} className="sk sk-line" style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }} />)}
    </section>
  );
}

/** `cards` placeholder cards in a row of the page. */
export default function Skeleton({ cards = 2, ...card }) {
  return <>{Array.from({ length: cards }, (_, i) => <SkeletonCard key={i} {...card} />)}</>;
}

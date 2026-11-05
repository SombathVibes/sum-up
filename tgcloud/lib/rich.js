// Report screens as rich messages (Bot API 10.1+): real tables with Khmer
// headers, folding sections and live time stamps. Each screen is built once
// with a Doc, which gives both forms:
//   - rich: rich-message HTML, sent with editMessageText({ rich_message })
//   - text: the ordinary HTML message (monospace <pre> tables, expandable
//     quotes), used when a rich edit fails (telegram.js edit) and for alerts.

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A table column: `en` heads the monospace fallback (Khmer isn't fixed-width),
 * `kh` the rich table; `width` is the fallback's width, `left` aligns it left
 * (the first column always is).
 */
const col = (kh, en, width, left = false) => ({ kh, en, width, left });
export { col };

export class Doc {
  constructor() {
    this.text = [];
    this.rich = [];
  }

  /** A paragraph of inline HTML; '' is a blank line in the text form only. Several lines with \n. */
  line(html) {
    this.text.push(html);
    if (html !== '') this.rich.push(...String(html).split('\n').map((l) => `<p>${l}</p>`));
    return this;
  }

  /** The screen's title. */
  title(html) {
    this.text.push(`<b>${html}</b>`);
    this.rich.push(`<h3>${html}</h3>`);
    return this;
  }

  /** A sub-heading in bold. */
  bold(html) {
    this.text.push(`<b>${html}</b>`);
    this.rich.push(`<h4>${html}</h4>`);
    return this;
  }

  /** A divider. */
  rule() {
    this.text.push('', '━━━━━━━━━━━━');
    this.rich.push('<hr/>');
    return this;
  }

  /**
   * A table: `cols` from col(), `rows` and `total` (optional) as arrays of
   * plain strings. `fold`: folded (expandable quote / <details> with that
   * summary) rather than shown open.
   */
  table(cols, rows, { total = null, fold = null } = {}) {
    if (!rows.length) return this;
    const pad = (v, c, i) => (i === 0 || c.left ? String(v).padEnd(c.width) : String(v).padStart(c.width));
    const mono = (cells) => cells.map((v, i) => pad(v, cols[i], i)).join('');
    const rule = '─'.repeat(cols.reduce((n, c) => n + c.width, 0));
    const lines = [mono(cols.map((c) => c.en)), rule, ...rows.map(mono), ...(total ? [rule, mono(total)] : [])];
    const pre = `<pre>${escape(lines.join('\n'))}</pre>`;
    this.text.push(fold ? `<blockquote expandable>${pre}</blockquote>` : pre);

    const cell = (tag, v, i, bold) => {
      const align = i === 0 || cols[i].left ? '' : ' align="right"';
      return `<${tag}${align}>${bold ? `<b>${escape(v)}</b>` : escape(v)}</${tag}>`;
    };
    const tr = (cells, tag = 'td', bold = false) => `<tr>${cells.map((v, i) => cell(tag, v, i, bold)).join('')}</tr>`;
    const table = `<table bordered striped compact>${tr(cols.map((c) => c.kh), 'th')}${rows.map((r) => tr(r)).join('')}${total ? tr(total, 'td', true) : ''}</table>`;
    this.rich.push(fold ? `<details><summary>${fold}</summary>${table}</details>` : table);
    return this;
  }

  /** Lines folded under a summary: an expandable quote, or <details>. */
  fold(summary, lines) {
    if (!lines.length) return this;
    this.text.push(`<blockquote expandable>${summary}\n${lines.join('\n')}</blockquote>`);
    this.rich.push(`<details><summary>${summary}</summary>${lines.map((l) => `<p>${l}</p>`).join('')}</details>`);
    return this;
  }

  /** Another Doc's content after this one's. */
  add(doc) {
    this.text.push(...doc.text);
    this.rich.push(...doc.rich);
    return this;
  }

  /** { text, rich }: the two forms of the screen. */
  out() {
    return { text: this.text.join('\n'), rich: this.rich.join('') };
  }
}

/**
 * A time the reader sees in their own time zone: `format` 't' (22:45), 'r'
 * (relative: '5 minutes ago') or '' (the fallback text as written). The
 * fallback shows where tg-time isn't supported.
 */
export const time = (unix, fallback, format = 't') => `<tg-time unix="${Math.floor(unix)}" format="${format}">${escape(fallback)}</tg-time>`;

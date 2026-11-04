// Editing an .xlsx at the XML level, ported from the lottery report tool's
// fill_day.py: the workbook is never round-tripped through a spreadsheet
// library (that drops the Data Validation extension and breaks tables), only
// existing cells are rewritten in xl/worksheets/*.xml, keeping their style,
// and Excel recalculates every formula on open (fullCalcOnLoad).

import { readZip, writeZip } from './zip.js';

const dec = new TextDecoder();
const enc = new TextEncoder();
const EPOCH = Date.UTC(1899, 11, 30);

/** Excel's day number for 'YYYY-MM-DD'. */
export const serial = (day) => Math.round((Date.parse(`${day}T00:00:00Z`) - EPOCH) / 86400000);

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');

const cellRe = (ref) => new RegExp(`<c r="${ref}"([^>]*?)(/>|>[\\s\\S]*?</c>)`);
const styleOf = (attrs) => attrs.match(/ s="\d+"/)?.[0] ?? '';

export class Book {
  /** files: [{ name, bytes }] from readZip. */
  constructor(files) {
    this.files = files;
    this.xml = new Map(); // edited / decoded parts
    const wb = this.get('xl/workbook.xml');
    const rels = this.get('xl/_rels/workbook.xml.rels');
    this.parts = new Map();
    for (const [, name, rid] of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
      const rel = rels.match(new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*Target="([^"]+)"`))
        ?? rels.match(new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${rid}"`));
      this.parts.set(unescapeXml(name), `xl/${rel[1].replace(/^\//, '').replace(/^xl\//, '')}`);
    }
  }

  static async open(bytes) {
    return new Book(await readZip(bytes));
  }

  get(part) {
    if (!this.xml.has(part)) {
      const f = this.files.find((x) => x.name === part);
      if (!f) throw new Error(`xlsx: no part ${part}`);
      this.xml.set(part, dec.decode(f.bytes));
    }
    return this.xml.get(part);
  }

  has(sheetName) { return this.parts.has(sheetName); }
  sheet(name) { return this.get(this.parts.get(name)); }
  setSheet(name, s) { this.xml.set(this.parts.get(name), s); }

  get sharedStrings() {
    if (!this._ss) {
      const ss = this.files.some((f) => f.name === 'xl/sharedStrings.xml') ? this.get('xl/sharedStrings.xml') : '';
      this._ss = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescapeXml(m[1].replace(/<[^>]+>/g, '')));
    }
    return this._ss;
  }

  /** Text of a string cell (shared or inline), '' if empty. */
  textOf(s, ref) {
    const m = s.match(cellRe(ref));
    if (!m) return '';
    if (m[1].includes('t="s"')) {
      const v = m[2].match(/<v>(\d+)<\/v>/);
      return v ? this.sharedStrings[Number(v[1])] ?? '' : '';
    }
    const t = m[2].match(/<t[^>]*>([^<]*)<\/t>/);
    return t ? unescapeXml(t[1]) : '';
  }

  async save() {
    const wb = this.get('xl/workbook.xml');
    if (!wb.includes('fullCalcOnLoad')) this.xml.set('xl/workbook.xml', wb.replace(/<calcPr ([^>]*?)\/>/, '<calcPr $1 fullCalcOnLoad="1"/>'));
    return writeZip(this.files.map((f) => ({ name: f.name, bytes: this.xml.has(f.name) ? enc.encode(this.xml.get(f.name)) : f.bytes })));
  }
}

export const hasValue = (s, ref) => {
  const m = s.match(cellRe(ref));
  return !!m && /<v>[^<]|<is>/.test(m[0]);
};

export function getNum(s, ref) {
  const m = s.match(cellRe(ref));
  const v = m?.[0].match(/<v>([^<]*)<\/v>/);
  return v && !m[1].includes('t="s"') && !m[1].includes('t="str"') ? Number(v[1]) : null;
}

/** Number / text / null (blank) into an EXISTING cell, keeping its style; never over a formula. */
export function put(s, ref, value) {
  const m = s.match(cellRe(ref));
  if (!m && value == null) return s;
  if (!m) throw new Error(`xlsx: cell ${ref} does not exist in the sheet`);
  if (m[0].includes('<f')) throw new Error(`xlsx: refusing to overwrite formula cell ${ref}`);
  const st = styleOf(m[1]);
  let cell;
  if (value == null) cell = `<c r="${ref}"${st}/>`;
  else if (typeof value === 'string') cell = `<c r="${ref}"${st} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  else cell = `<c r="${ref}"${st}><v>${value}</v></c>`;
  return s.replace(m[0], () => cell);
}

/** An empty, non-formula cell becomes a formula (e.g. MainPage!BJ = -BI). */
export function putFormulaIfEmpty(s, ref, formula) {
  const m = s.match(cellRe(ref));
  if (!m || m[0].includes('<f') || /<v>[^<]|<is>/.test(m[0])) return [s, false];
  return [s.replace(m[0], () => `<c r="${ref}"${styleOf(m[1])}><f>${formula}</f></c>`), true];
}

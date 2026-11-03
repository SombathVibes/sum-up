// Local stand-in for Telegram Serverless's `sdk/db`, backed by node:sqlite.
// It covers only the slice of the Drizzle-like API this project uses — enough
// to exercise the handlers locally, not a full reimplementation.

import { DatabaseSync } from 'node:sqlite';

// ---------- sql fragments ----------

class Sql {
  constructor(text, params) {
    this.text = text;
    this.params = params;
  }
}

const quote = (name) => `"${name.replace(/"/g, '""')}"`;

function render(value, out) {
  if (value instanceof Sql) {
    out.params.push(...value.params);
    return value.text;
  }
  if (value instanceof Column) return quote(value.name);
  out.params.push(toSqlValue(value));
  return '?';
}

const toSqlValue = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof Date ? Math.floor(v / 1000) : v);

export function sql(strings, ...values) {
  const out = { params: [] };
  let text = strings[0];
  values.forEach((v, i) => {
    text += render(v, out) + strings[i + 1];
  });
  return new Sql(text, out.params);
}
sql.raw = (text) => new Sql(text, []);

const op = (symbol) => (col, value) => sql`${col} ${sql.raw(symbol)} ${value}`;
export const eq = op('=');
export const ne = op('<>');
export const gt = op('>');
export const gte = op('>=');
export const lt = op('<');
export const lte = op('<=');

function join(parts, glue) {
  const kept = parts.filter(Boolean);
  const out = { params: [] };
  const text = kept.map((p) => `(${render(p, out)})`).join(glue);
  return new Sql(text, out.params);
}
export const and = (...parts) => join(parts, ' AND ');
export const or = (...parts) => join(parts, ' OR ');
export const desc = (col) => sql`${col} DESC`;
export const asc = (col) => sql`${col} ASC`;

// ---------- schema DSL ----------

class Column {
  constructor(name, type, mode) {
    this.name = name;
    this.type = type;
    this.mode = mode;
    this.mods = [];
  }
  primaryKey(opts) {
    this.mods.push(opts?.autoIncrement ? 'PRIMARY KEY AUTOINCREMENT' : 'PRIMARY KEY');
    return this;
  }
  notNull() { this.mods.push('NOT NULL'); return this; }
  unique() { this.mods.push('UNIQUE'); return this; }
  default(value) {
    const text = value instanceof Sql ? value.text : typeof value === 'string' ? `'${value.replace(/'/g, "''")}'` : String(toSqlValue(value));
    this.mods.push(`DEFAULT ${text}`);
    return this;
  }
  fromDb(v) {
    if (v == null) return v;
    if (this.mode === 'boolean') return !!v;
    if (this.mode === 'json') return JSON.parse(v);
    if (this.mode === 'timestamp') return new Date(v * 1000);
    return v;
  }
  toDb(v) {
    if (v == null) return v;
    if (this.mode === 'json') return JSON.stringify(v);
    return toSqlValue(v);
  }
}

const factory = (type, defaultMode) => (name, opts) => new Column(name, type, opts?.mode ?? defaultMode);
export const integer = factory('INTEGER');
export const text = factory('TEXT');
export const real = factory('REAL');
export const boolean = factory('INTEGER', 'boolean');
export const json = factory('TEXT', 'json');

const indexBuilder = (unique) => (name) => ({ on: (...cols) => ({ name, unique, cols }) });
export const index = indexBuilder(false);
export const uniqueIndex = indexBuilder(true);

const TABLE = Symbol('table');

export function table(name, columns, extras) {
  for (const [key, col] of Object.entries(columns)) col.name ??= key;
  const t = { ...columns, [TABLE]: { name, columns, indexes: extras ? Object.values(extras(columns)) : [] } };
  return t;
}

function ddl(t) {
  const { name, columns, indexes } = t[TABLE];
  const cols = Object.values(columns).map((c) => [quote(c.name), c.type, ...c.mods].join(' '));
  return [
    `CREATE TABLE IF NOT EXISTS ${quote(name)} (${cols.join(', ')})`,
    ...indexes.map((i) => `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quote(i.name)} ON ${quote(name)} (${i.cols.map((c) => quote(c.name)).join(', ')})`),
  ];
}

// ---------- query builder ----------

let sqlite;

/**
 * Opens the local database file and brings it up to the schema: creates
 * missing tables and indexes, and adds columns new to schema.js (what
 * `tgcloud migrate` does for additive changes).
 */
export function open(file, schema) {
  sqlite = new DatabaseSync(file);
  for (const t of Object.values(schema)) {
    if (!t?.[TABLE]) continue;
    const [create, ...indexes] = ddl(t);
    sqlite.exec(create);
    const existing = new Set(sqlite.prepare(`PRAGMA table_info(${quote(t[TABLE].name)})`).all().map((c) => c.name));
    for (const col of Object.values(t[TABLE].columns)) {
      if (existing.has(col.name)) continue;
      const mods = col.mods.filter((m) => !m.startsWith('PRIMARY KEY') && m !== 'UNIQUE');
      sqlite.exec(`ALTER TABLE ${quote(t[TABLE].name)} ADD COLUMN ${[quote(col.name), col.type, ...mods].join(' ')}`);
      console.log(`  added column ${t[TABLE].name}.${col.name}`);
    }
    // SQLite can't ADD COLUMN ... UNIQUE, so unique columns get a unique index (created either way, harmless).
    for (const col of Object.values(t[TABLE].columns)) {
      if (col.mods.includes('UNIQUE')) {
        sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${quote(`uq_${t[TABLE].name}_${col.name}`)} ON ${quote(t[TABLE].name)} (${quote(col.name)})`);
      }
    }
    // Indexes no longer in schema.js are dropped (the platform's migrate asks first).
    const wanted = new Set(t[TABLE].indexes.map((i) => i.name));
    for (const { name } of sqlite.prepare(`PRAGMA index_list(${quote(t[TABLE].name)})`).all()) {
      if (name.startsWith('sqlite_autoindex') || name.startsWith('uq_' + t[TABLE].name + '_') || wanted.has(name)) continue;
      sqlite.exec(`DROP INDEX ${quote(name)}`);
      console.log(`  dropped index ${name}`);
    }
    for (const stmt of indexes) sqlite.exec(stmt);
  }
}

const fromRow = (t, row) => {
  if (!row) return row ?? null;
  const out = {};
  for (const [key, col] of Object.entries(t[TABLE].columns)) out[key] = col.fromDb(row[col.name]);
  return out;
};

const exec = (q, mode) => {
  const stmt = sqlite.prepare(q.text);
  if (mode === 'all') return stmt.all(...q.params);
  if (mode === 'get') return stmt.get(...q.params);
  const r = stmt.run(...q.params);
  return { rowsAffected: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid), rows: [] };
};

class Select {
  constructor() { this.parts = {}; }
  from(t) { this.t = t; return this; }
  where(...conds) { this.parts.where = and(...conds); return this; }
  orderBy(...cols) { this.parts.orderBy = cols; return this; }
  limit(n) { this.parts.limit = n; return this; }
  build(limitOverride) {
    const out = { params: [] };
    let text = `SELECT * FROM ${quote(this.t[TABLE].name)}`;
    if (this.parts.where) text += ` WHERE ${render(this.parts.where, out)}`;
    if (this.parts.orderBy) text += ` ORDER BY ${this.parts.orderBy.map((c) => render(c, out)).join(', ')}`;
    const limit = limitOverride ?? this.parts.limit;
    if (limit != null) text += ` LIMIT ${Number(limit)}`;
    return new Sql(text, out.params);
  }
  async all() { return exec(this.build(), 'all').map((r) => fromRow(this.t, r)); }
  async get() { return fromRow(this.t, exec(this.build(1), 'get')); }
}

class Insert {
  constructor(t) { this.t = t; }
  values(rows) { this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  onConflictDoNothing() { this.conflict = ' ON CONFLICT DO NOTHING'; return this; }
  onConflictDoUpdate({ target, set }) {
    const targets = (Array.isArray(target) ? target : [target]).map((c) => quote(c.name)).join(', ');
    const cols = this.t[TABLE].columns;
    const out = { params: [] };
    const sets = Object.entries(set).map(([key, v]) => `${quote(cols[key].name)} = ${render(cols[key].toDb(v), out)}`);
    this.conflict = ` ON CONFLICT (${targets}) DO UPDATE SET ${sets.join(', ')}`;
    this.conflictParams = out.params;
    return this;
  }
  returning() { this.ret = true; return this; }
  async run() {
    // SQLite has no DEFAULT inside VALUES, so rows are grouped by the keys they set.
    const cols = Object.entries(this.t[TABLE].columns);
    const groups = new Map();
    for (const r of this.rows) {
      const used = cols.filter(([key]) => r[key] !== undefined);
      const sig = used.map(([key]) => key).join(',');
      if (!groups.has(sig)) groups.set(sig, { used, rows: [] });
      groups.get(sig).rows.push(r);
    }

    const returned = [];
    let rowsAffected = 0;
    for (const { used, rows } of groups.values()) {
      const params = [];
      const tuples = rows.map((r) => `(${used.map(([key, col]) => {
        params.push(col.toDb(r[key]));
        return '?';
      }).join(', ')})`);
      const columns = used.length ? `(${used.map(([, c]) => quote(c.name)).join(', ')}) VALUES ${tuples.join(', ')}` : 'DEFAULT VALUES';
      const text = `INSERT INTO ${quote(this.t[TABLE].name)} ${columns}${this.conflict ?? ''}${this.ret ? ' RETURNING *' : ''}`;
      const q = new Sql(text, [...params, ...(this.conflictParams ?? [])]);
      if (this.ret) returned.push(...exec(q, 'all').map((r) => fromRow(this.t, r)));
      else rowsAffected += exec(q, 'run').rowsAffected;
    }
    return this.ret ? returned : { rowsAffected, lastInsertRowid: 0, rows: [] };
  }
}

class Update {
  constructor(t) { this.t = t; }
  set(values) { this.values = values; return this; }
  where(...conds) { this.cond = and(...conds); return this; }
  async run() {
    const out = { params: [] };
    const cols = this.t[TABLE].columns;
    const sets = Object.entries(this.values).map(([key, v]) => `${quote(cols[key].name)} = ${render(cols[key].toDb(v), out)}`);
    let text = `UPDATE ${quote(this.t[TABLE].name)} SET ${sets.join(', ')}`;
    if (this.cond) text += ` WHERE ${render(this.cond, out)}`;
    return exec(new Sql(text, out.params), 'run');
  }
}

class Delete {
  constructor(t) { this.t = t; }
  where(...conds) { this.cond = and(...conds); return this; }
  async run() {
    const out = { params: [] };
    let text = `DELETE FROM ${quote(this.t[TABLE].name)}`;
    if (this.cond) text += ` WHERE ${render(this.cond, out)}`;
    return exec(new Sql(text, out.params), 'run');
  }
}

const plain = (rows) => rows.map((r) => ({ ...r }));

export const db = {
  select: () => new Select(),
  insert: (t) => new Insert(t),
  update: (t) => new Update(t),
  delete: (t) => new Delete(t),
  all: async (q) => plain(exec(q, 'all')),
  get: async (q) => { const r = exec(q, 'get'); return r ? { ...r } : null; },
  run: async (q) => exec(q, 'run'),
};

export default { ...db, table, integer, text, real, boolean, json, index, uniqueIndex, sql, eq, ne, gt, gte, lt, lte, and, or, asc, desc };

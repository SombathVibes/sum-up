// Telegram Serverless's `sdk/db` on Cloudflare D1: the same Drizzle-like
// slice of the API the bot uses, built the same way as dev/sdk/db.js (keep
// the two in step), with queries run on the D1 binding (async). bindDb(env.DB)
// is called by the Worker before each request. Tables come from
// cloudflare/migrations (npm run cf:gen writes them from schema.js); there's
// no open() here.

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
  /** Marks the column for removal (terminal, as on the platform): invisible at runtime, dropped by open(). */
  deprecated(reason = '') { this.deprecatedReason = reason || 'deprecated'; return this; }
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

export const TABLE = Symbol('table');

export function table(name, columns, extras) {
  for (const [key, col] of Object.entries(columns)) col.name ??= key;
  // Deprecated columns are left out at runtime and dropped by open().
  const live = Object.fromEntries(Object.entries(columns).filter(([, c]) => !c.deprecatedReason));
  const dropped = Object.values(columns).filter((c) => c.deprecatedReason);
  const t = { ...live, [TABLE]: { name, columns: live, dropped, indexes: extras ? Object.values(extras(live)) : [] } };
  return t;
}

/** CREATE TABLE and CREATE INDEX statements for a table (cloudflare/gen.mjs). */
export function ddl(t) {
  const { name, columns, indexes } = t[TABLE];
  const cols = Object.values(columns).map((c) => [quote(c.name), c.type, ...c.mods].join(' '));
  return [
    `CREATE TABLE IF NOT EXISTS ${quote(name)} (${cols.join(', ')})`,
    ...indexes.map((i) => `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quote(i.name)} ON ${quote(name)} (${i.cols.map((c) => quote(c.name)).join(', ')})`),
  ];
}

// ---------- query builder ----------

let sqlite;

const fromRow = (t, row) => {
  if (!row) return row ?? null;
  const out = {};
  for (const [key, col] of Object.entries(t[TABLE].columns)) out[key] = col.fromDb(row[col.name]);
  return out;
};

let d1;
/** The D1 database this request uses (env.DB). */
export const bindDb = (database) => { d1 = database; };

// D1 takes null, not undefined.
const params = (q) => q.params.map((v) => (v === undefined ? null : v));

/** How many queries ran and how long they took (the Worker logs it per update). */
export const dbStats = { n: 0, ms: 0 };

// A short read cache for the small tables every tap and Mini App call reads
// (who's an admin, the group, its subscription, its lottery settings): each D1
// query costs ~20 ms, and one tap read the same rows up to three times. Any
// write through this Worker instance empties it; a change made by another
// instance shows within CACHE_MS. Payments, reports and saved days aren't cached.
const CACHED = new Set(['groups', 'subscriptions', 'admins', 'admin_groups', 'lottery_logins', 'group_lottery_settings', 'agents']);
const CACHE_MS = 5000;
const cache = new Map(); // mode + sql + params → { at, rows: Promise }

/** Empties the read cache (every write does). */
export const clearCache = () => cache.clear();

const cachedExec = (table, q, mode) => {
  if (!CACHED.has(table)) return exec(q, mode);
  const key = `${mode}\n${q.text}\n${JSON.stringify(q.params)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const rows = exec(q, mode);
  cache.set(key, { at: Date.now(), rows });
  rows.catch(() => cache.delete(key));
  return rows;
};

const exec = async (q, mode) => {
  if (!d1) throw new Error('sdk/db: no D1 binding (bindDb not called)');
  if (!/^\s*SELECT\b/i.test(q.text)) cache.clear();
  const started = Date.now();
  try {
    const stmt = d1.prepare(q.text).bind(...params(q));
    if (mode === 'all') return (await stmt.all()).results ?? [];
    if (mode === 'get') return (await stmt.first()) ?? undefined;
    const r = await stmt.run();
    return { rowsAffected: Number(r.meta?.changes ?? 0), lastInsertRowid: Number(r.meta?.last_row_id ?? 0), rows: [] };
  } finally {
    dbStats.n += 1;
    dbStats.ms += Date.now() - started;
  }
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
  // Rows are rebuilt from the cached raw rows on every call, so callers can change them.
  async all() { return (await cachedExec(this.t[TABLE].name, this.build(), 'all')).map((r) => fromRow(this.t, r)); }
  async get() { return fromRow(this.t, await cachedExec(this.t[TABLE].name, this.build(1), 'get')); }
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
      if (this.ret) returned.push(...(await exec(q, 'all')).map((r) => fromRow(this.t, r)));
      else rowsAffected += (await exec(q, 'run')).rowsAffected;
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
  all: async (q) => plain(await exec(q, 'all')),
  get: async (q) => { const r = await exec(q, 'get'); return r ? { ...r } : null; },
  run: async (q) => exec(q, 'run'),
};

export default { ...db, table, integer, text, real, boolean, json, index, uniqueIndex, sql, eq, ne, gt, gte, lt, lte, and, or, asc, desc };

// Локальная заглушка 'sdk/db' для тестов: DSL схемы → DDL SQLite, тег sql → параметризованный запрос.
const tables = [];

function column(type) {
  return (name, opts = {}) => {
    const col = { name, type, mods: [] };
    const api = {
      _col: col,
      primaryKey(o = {}) { col.mods.push(o.autoIncrement ? 'PRIMARY KEY AUTOINCREMENT' : 'PRIMARY KEY'); return api; },
      notNull() { col.mods.push('NOT NULL'); return api; },
      unique() { col.mods.push('UNIQUE'); return api; },
      default(v) { col.mods.push(`DEFAULT ${typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v}`); return api; },
    };
    return api;
  };
}
export const text = column('TEXT');
export const integer = column('INTEGER');
export const real = column('REAL');

function idx(unique) {
  return (name) => ({ on: (...cols) => ({ name, unique, cols: cols.map((c) => c._col.name) }) });
}
export const index = idx(false);
export const uniqueIndex = idx(true);

export function table(name, columns, extras) {
  const t = { name, columns, indexes: extras ? Object.values(extras(columns)) : [] };
  tables.push(t);
  return t;
}

export function ddl() {
  const out = [];
  for (const t of tables) {
    const cols = Object.values(t.columns).map((c) => `${c._col.name} ${c._col.type} ${c._col.mods.join(' ')}`);
    out.push(`CREATE TABLE ${t.name} (${cols.join(', ')})`);
    for (const i of t.indexes) out.push(`CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${i.name} ON ${t.name} (${i.cols.join(', ')})`);
  }
  return out;
}

export function sql(strings, ...values) {
  return { text: strings.join('?'), values };
}

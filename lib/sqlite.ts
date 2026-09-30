import { isSecretKey } from "./adapters/collector.ts";

/**
 * A small read-only SQLite reader for Ignition 8.1's internal database
 * (`db_backup_sqlite.idb`). It walks table b-trees in the file format
 * documented at https://www.sqlite.org/fileformat2.html and decodes only the
 * columns a caller names; there is no SQL engine, and nothing is executed.
 *
 * The input is untrusted: page numbers, sizes and cell counts are
 * bounds-checked, loops are refused, and any inconsistency throws
 * `SqliteError` rather than reading outside the file.
 */

export class SqliteError extends Error {}

export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export interface SqliteTable {
  name: string;
  columns: string[];
  rootPage: number;
  /** Index of a column declared INTEGER PRIMARY KEY, which is stored as the rowid. */
  rowidColumn: number;
  /** Tables declared WITHOUT ROWID are stored differently and aren't read. */
  withoutRowid: boolean;
}

const MAX_CELLS = 5_000_000;
const MAX_PAYLOAD = 64 * 1024 * 1024;

export class SqliteDb {
  private readonly view: DataView;
  private readonly pageSize: number;
  private readonly usable: number;
  private readonly pageCount: number;
  private readonly decoder: TextDecoder;
  readonly tables = new Map<string, SqliteTable>();

  constructor(private readonly bytes: Uint8Array) {
    if (bytes.length < 100 || new TextDecoder().decode(bytes.subarray(0, 16)) !== "SQLite format 3\0") throw new SqliteError("Not a SQLite database.");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ps = this.view.getUint16(16);
    this.pageSize = ps === 1 ? 65536 : ps;
    if (this.pageSize < 512 || this.pageSize & (this.pageSize - 1)) throw new SqliteError("Invalid page size.");
    this.usable = this.pageSize - bytes[20]!;
    if (this.usable < 480) throw new SqliteError("Invalid reserved space.");
    this.pageCount = Math.floor(bytes.length / this.pageSize);
    const enc = this.view.getUint32(56);
    this.decoder = new TextDecoder(enc === 2 ? "utf-16le" : enc === 3 ? "utf-16be" : "utf-8");
    this.readSchema();
  }

  private readSchema() {
    // sqlite_schema: type, name, tbl_name, rootpage, sql.
    for (const { values } of this.scan(1, [0, 1, 3, 4])) {
      const [type, name, root, sql] = values;
      if (type !== "table" || typeof name !== "string" || typeof root !== "number" || typeof sql !== "string") continue;
      const defs = columnDefs(sql);
      this.tables.set(name.toUpperCase(), {
        name,
        rootPage: root,
        columns: defs.map((d) => d.name),
        rowidColumn: defs.findIndex((d) => /^\S+\s+INTEGER\s+PRIMARY\s+KEY\b/i.test(d.def)),
        withoutRowid: /\)\s*WITHOUT\s+ROWID\s*;?\s*$/i.test(sql),
      });
    }
  }

  table(name: string): SqliteTable | undefined {
    return this.tables.get(name.toUpperCase());
  }

  hasColumn(table: string, column: string): boolean {
    return !!this.table(table)?.columns.some((c) => c.toUpperCase() === column.toUpperCase());
  }

  /** Rows in a table without decoding any values. */
  count(table: string): number {
    const t = this.table(table);
    if (!t || t.withoutRowid) return 0;
    let n = 0;
    for (const _ of this.scan(t.rootPage, [])) n++;
    return n;
  }

  /**
   * Named columns of every row, in rowid order. Columns that don't exist come
   * back as null. Asking for a credential column is a programming error.
   */
  select(table: string, columns: string[]): SqlRow[] {
    for (const c of columns) if (isSecretKey(c)) throw new SqliteError(`Refusing to read credential column ${table}.${c}.`);
    const t = this.table(table);
    if (!t || t.withoutRowid) return [];
    const upper = t.columns.map((c) => c.toUpperCase());
    const idx = columns.map((c) => upper.indexOf(c.toUpperCase()));
    const rows: SqlRow[] = [];
    for (const { rowid, values } of this.scan(t.rootPage, idx.filter((i) => i >= 0))) {
      const row: SqlRow = {};
      let k = 0;
      columns.forEach((c, j) => {
        if (idx[j]! < 0) row[c] = null;
        else {
          const v = values[k++] ?? null;
          row[c] = v === null && idx[j] === t.rowidColumn ? rowid : v;
        }
      });
      rows.push(row);
    }
    return rows;
  }

  /* ------------------------------ file format ------------------------------ */

  private pageOffset(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > this.pageCount) throw new SqliteError(`Page ${n} is outside the file.`);
    return (n - 1) * this.pageSize;
  }

  /** In-order walk of a table b-tree, decoding the given column indexes of each record. */
  private *scan(root: number, want: number[]): Generator<{ rowid: number; values: SqlValue[] }> {
    const seen = new Set<number>();
    const stack: number[] = [root];
    let cells = 0;
    while (stack.length) {
      const page = stack.pop()!;
      if (seen.has(page)) throw new SqliteError("The database has a page loop.");
      seen.add(page);
      const base = this.pageOffset(page);
      const hdr = base + (page === 1 ? 100 : 0);
      const type = this.bytes[hdr];
      const n = this.view.getUint16(hdr + 3);
      cells += n;
      if (cells > MAX_CELLS) throw new SqliteError("The database has too many rows.");
      if (type === 0x05) {
        // Interior: push children right to left so the leftmost is walked first.
        const kids = [this.view.getUint32(hdr + 8)];
        for (let i = n - 1; i >= 0; i--) kids.push(this.view.getUint32(base + this.view.getUint16(hdr + 12 + i * 2)));
        stack.push(...kids);
      } else if (type === 0x0d) {
        for (let i = 0; i < n; i++) {
          let p = base + this.view.getUint16(hdr + 8 + i * 2);
          const [size, a] = this.varint(p);
          const [rowid, b] = this.varint(a);
          p = b;
          yield { rowid, values: want.length ? this.record(this.payload(p, size), want) : [] };
        }
      } else throw new SqliteError(`Unexpected page type ${type} in a table.`);
    }
  }

  /** A cell's payload, following overflow pages when it doesn't fit on the page. */
  private payload(at: number, size: number): Uint8Array {
    if (size > MAX_PAYLOAD) throw new SqliteError("A row is too large.");
    const u = this.usable;
    const x = u - 35;
    if (size <= x) return this.slice(at, size);
    const m = Math.floor(((u - 12) * 32) / 255) - 23;
    const k = m + ((size - m) % (u - 4));
    const local = k <= x ? k : m;
    const out = new Uint8Array(size);
    out.set(this.slice(at, local), 0);
    let got = local;
    let next = this.view.getUint32(at + local);
    const seen = new Set<number>();
    while (got < size) {
      if (seen.has(next)) throw new SqliteError("The database has an overflow loop.");
      seen.add(next);
      const o = this.pageOffset(next);
      const take = Math.min(u - 4, size - got);
      out.set(this.slice(o + 4, take), got);
      got += take;
      next = this.view.getUint32(o);
    }
    return out;
  }

  private slice(at: number, n: number): Uint8Array {
    if (at < 0 || at + n > this.bytes.length) throw new SqliteError("A row points outside the file.");
    return this.bytes.subarray(at, at + n);
  }

  private varint(at: number): [number, number] {
    let v = 0;
    for (let i = 0; i < 9; i++) {
      if (at + i >= this.bytes.length) throw new SqliteError("Truncated varint.");
      const b = this.bytes[at + i]!;
      if (i === 8) return [v * 256 + b, at + 9];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return [v, at + i + 1];
    }
    return [v, at + 9];
  }

  /** Decode the wanted columns of a record; the others are skipped by size alone. */
  private record(p: Uint8Array, want: number[]): SqlValue[] {
    const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
    const varint = (at: number): [number, number] => {
      let x = 0;
      for (let i = 0; i < 9 && at + i < p.length; i++) {
        const b = p[at + i]!;
        if (i === 8) return [x * 256 + b, at + 9];
        x = x * 128 + (b & 0x7f);
        if (!(b & 0x80)) return [x, at + i + 1];
      }
      throw new SqliteError("Truncated record header.");
    };
    const [hsize, h0] = varint(0);
    if (hsize > p.length) throw new SqliteError("Record header is larger than the record.");
    const types: number[] = [];
    for (let h = h0; h < hsize; ) {
      const [t, next] = varint(h);
      types.push(t);
      h = next;
    }
    const wanted = new Map(want.map((w, i) => [w, i]));
    const out: SqlValue[] = new Array(want.length).fill(null);
    let at = hsize;
    for (let col = 0; col < types.length; col++) {
      const t = types[col]!;
      const len = t >= 12 ? Math.floor((t - 12) / 2) : ([0, 1, 2, 3, 4, 6, 8, 8, 0, 0][t] ?? -1);
      if (len < 0) throw new SqliteError("Invalid column type.");
      if (at + len > p.length) throw new SqliteError("A column runs past the end of its record.");
      const slot = wanted.get(col);
      if (slot !== undefined) {
        if (t === 0) out[slot] = null;
        else if (t === 8 || t === 9) out[slot] = t - 8;
        else if (t === 7) out[slot] = v.getFloat64(at);
        else if (t < 7) out[slot] = int(v, at, len);
        else if (t % 2) out[slot] = this.decoder.decode(p.subarray(at, at + len));
        else out[slot] = p.slice(at, at + len);
      }
      at += len;
    }
    return out;
  }
}

function int(v: DataView, at: number, len: number): number {
  if (len === 8) return Number(v.getBigInt64(at));
  let x = v.getInt8(at);
  for (let i = 1; i < len; i++) x = x * 256 + v.getUint8(at + i);
  return x;
}

/** Column names and definitions from a CREATE TABLE statement. Table constraints are skipped. */
export function columnDefs(sql: string): { name: string; def: string }[] {
  const open = sql.indexOf("(");
  if (open < 0) return [];
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = open + 1; i < sql.length; i++) {
    const ch = sql[i]!;
    if (quote) {
      cur += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "[") quote = "]";
    else if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) break;
      depth--;
    } else if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts
    .filter((p) => !/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(p))
    .map((def) => {
      const m = def.match(/^"((?:[^"]|"")*)"|^`([^`]*)`|^\[([^\]]*)\]|^(\S+)/);
      return { name: (m?.[1]?.replace(/""/g, '"') ?? m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim(), def };
    })
    .filter((d) => d.name);
}

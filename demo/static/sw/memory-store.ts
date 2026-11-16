import type { Store, Table } from './types'

/** The same store in memory, for the contract test. */
export function memoryStore(): Store {
  const tables = new Map<Table, Map<string, unknown>>()
  const of = (table: Table) => tables.get(table) ?? tables.set(table, new Map()).get(table)!
  const keyOf = (table: Table, row: { key?: string; id?: string }) => (table === 'versions' || table === 'progress' ? row.id : row.key)!
  return {
    all: async (table) => [...of(table).values()] as never,
    get: async (table, key) => of(table).get(key) as never,
    put: async (table, row) => void of(table).set(keyOf(table, row as never), row),
    del: async (table, key) => void of(table).delete(key),
  }
}

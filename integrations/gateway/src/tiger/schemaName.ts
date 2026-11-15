// integrations/gateway/src/tiger/schemaName.ts
// The one helper through which a schema name enters SQL (TIGER_TELEMETRY_AND_INGESTION_RFC.md §7; evaluation §3,
// T33). Production uses `encore`; live tests use `tig_test_<12 lower-case hex>`. Nothing else is accepted.

export const SCHEMA_NAME_PATTERN = /^(encore|tig_test_[0-9a-f]{12})$/;

export class SchemaNameError extends Error {
  constructor() {
    // Never echoes the rejected value: it may come from a hostile source.
    super('schema name must be "encore" or "tig_test_" followed by 12 lower-case hex digits');
    this.name = 'SchemaNameError';
  }
}

/**
 * Returns `name` if it matches `^(encore|tig_test_[0-9a-f]{12})$`, else throws. Such a name is lower-case letters,
 * digits and underscores, starting with a letter, and is not a reserved word, so PostgreSQL's `format('%I', name)`
 * returns it unchanged: the runner may pass it to `format('CREATE SCHEMA IF NOT EXISTS %I', $1)` or use it as the
 * `set_config('search_path', $1, true)` value, and it is never interpolated from unchecked input.
 */
export function checkSchemaName(name: unknown): string {
  if (typeof name !== 'string' || !SCHEMA_NAME_PATTERN.test(name)) throw new SchemaNameError();
  return name;
}

/**
 * The statements the runner issues around the migration files for a checked schema (§7, §13): the schema itself,
 * created before 000, and the three schema-level grants of 006, which name the schema and so cannot live in the
 * schema-independent file. Each is a `format(%I)` call with the name as a bind parameter, so even a name that got
 * past the check could not change the statement.
 */
export function schemaStatements(name: string): { create: SqlCall; grants: SqlCall[] } {
  const schema = checkSchemaName(name);
  const call = (template: string): SqlCall => ({ text: `SELECT format('${template}', $1::text) AS sql`, values: [schema] });
  return {
    create: call('CREATE SCHEMA IF NOT EXISTS %I'),
    grants: [
      call('GRANT USAGE ON SCHEMA %I TO encore_importer, encore_reader'),
      call('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO encore_reader'),
      call('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO encore_reader'),
    ],
  };
}

/** A parameterised query: the runner executes it and then runs the returned `sql` text. */
export interface SqlCall { readonly text: string; readonly values: readonly string[] }

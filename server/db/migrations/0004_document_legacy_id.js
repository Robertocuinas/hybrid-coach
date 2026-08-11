export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS legacy_id text;`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_legacy_id
    ON documents (legacy_id) WHERE legacy_id IS NOT NULL;`);
}

export async function down(pgm) {
  pgm.sql(`DROP INDEX IF EXISTS idx_documents_legacy_id;`);
  pgm.sql(`ALTER TABLE documents DROP COLUMN IF EXISTS legacy_id;`);
}

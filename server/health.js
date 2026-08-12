export function isReady({ db, pgvector }, env = process.env) {
  const vectorRequired = env.PGVECTOR_ENABLED !== "false";
  return db === true && (!vectorRequired || pgvector === true);
}

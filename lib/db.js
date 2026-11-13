// Postgres-Anbindung für die Serverless-Funktionen. Verbindung über DATABASE_URL (Neon, Supabase, jede Postgres-Instanz).
import pg from 'pg';

let pool = null;
let schemaReady = null;

export function dbConfigured() { return !!process.env.DATABASE_URL; }

export function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    const local = /localhost|127\.0\.0\.1/.test(url) || /sslmode=disable/.test(url);
    pool = new pg.Pool({ connectionString: url, max: 1, idleTimeoutMillis: 10000, ssl: local ? false : { rejectUnauthorized: false } });
  }
  return pool;
}

export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(`
      CREATE TABLE IF NOT EXISTS events (
        id bigserial PRIMARY KEY,
        ts timestamptz NOT NULL DEFAULT now(),
        client_id text NOT NULL,
        type text NOT NULL,
        props jsonb NOT NULL DEFAULT '{}'::jsonb,
        app_version text,
        platform text
      );
      CREATE INDEX IF NOT EXISTS events_ts_idx ON events (ts);
      CREATE INDEX IF NOT EXISTS events_type_ts_idx ON events (type, ts);
    `).catch(e => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

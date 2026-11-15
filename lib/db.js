// Postgres-Anbindung für die Serverless-Funktionen. Verbindung über DATABASE_URL (Neon, Supabase, jede Postgres-Instanz).
import pg from 'pg';

let pool = null;
let schemaReady = null;

export function dbConfigured() { return !!process.env.DATABASE_URL; }

/** Nur für Tests: eigenen Pool (z. B. pg-mem) einsetzen und das Schema neu anlegen lassen. */
export function setPool(p) { pool = p; schemaReady = null; }

export function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    // Lokal ohne TLS; sonst TLS mit Zertifikatsprüfung (Neon, Supabase & Co. haben gültige CA-Zertifikate).
    // Für eine eigene Instanz mit selbstsigniertem Zertifikat DATABASE_SSL_NO_VERIFY=1 setzen (nicht empfohlen).
    const local = /localhost|127\.0\.0\.1/.test(url) || /sslmode=disable/.test(url);
    const ssl = local ? false : process.env.DATABASE_SSL_NO_VERIFY === '1' ? { rejectUnauthorized: false } : true;
    pool = new pg.Pool({ connectionString: url, max: 1, idleTimeoutMillis: 10000, ssl });
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
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        email text NOT NULL UNIQUE,
        pw_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash text PRIMARY KEY,
        user_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
      CREATE SEQUENCE IF NOT EXISTS items_seq;
      CREATE TABLE IF NOT EXISTS items (
        user_id text NOT NULL,
        store text NOT NULL,
        id text NOT NULL,
        data jsonb,
        updated_at bigint NOT NULL,
        deleted boolean NOT NULL DEFAULT false,
        seq bigint NOT NULL,
        PRIMARY KEY (user_id, store, id)
      );
      CREATE INDEX IF NOT EXISTS items_user_seq_idx ON items (user_id, seq);
    `).catch(e => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

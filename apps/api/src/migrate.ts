import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './core.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing. On Windows, run DATABASE_SETUP.bat before db:migrate.');
const migrations = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
const db = await pool.connect();
try {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const filename of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    if ((await db.query('SELECT 1 FROM schema_migrations WHERE filename=$1',[filename])).rowCount) continue;
    await db.query('BEGIN');
    try {
      await db.query(readFileSync(resolve(migrations,filename),'utf8'));
      await db.query('INSERT INTO schema_migrations(filename) VALUES($1)',[filename]);
      await db.query('COMMIT'); console.log('Applied', filename);
    } catch (error) {await db.query('ROLLBACK'); throw error;}
  }
} finally {db.release(); await pool.end();}

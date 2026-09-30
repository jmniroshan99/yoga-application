#!/usr/bin/env node
import {randomBytes} from 'node:crypto';
import {existsSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');
const requireApi = createRequire(resolve(root, 'apps/api/package.json'));
const {Client} = requireApi('pg');
const bcrypt = requireApi('bcryptjs');
const dotenv = requireApi('dotenv');

async function main() {
  if (!existsSync(envFile)) throw new Error('No .env found. First run npm run setup:local.');
  const original = readFileSync(envFile, 'utf8');
  const env = dotenv.parse(original);
  const example = dotenv.parse(readFileSync(resolve(root, '.env.example')));
  const password = example.ADMIN_PASSWORD;
  const email = (env.ADMIN_EMAIL || example.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!password || password.length < 12 || password.includes('REPLACE_')) throw new Error('Set a valid local demo ADMIN_PASSWORD in .env.example.');
  if (!email || !env.DATABASE_URL || !/^ADMIN_PASSWORD=.*$/m.test(original)) throw new Error('Configure ADMIN_EMAIL, DATABASE_URL and ADMIN_PASSWORD in .env first.');
  let database;
  try {database = new URL(env.DATABASE_URL);}
  catch {throw new Error('DATABASE_URL is invalid.');}
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) || env.SANDBOX_PAYMENTS !== 'true') {
    throw new Error('The documented demo password can only be applied to a local database with SANDBOX_PAYMENTS=true.');
  }

  const updated = original.replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${password}`);
  const pending = `${envFile}.pending-${randomBytes(6).toString('hex')}`;
  if (updated !== original) writeFileSync(pending, updated, {encoding: 'utf8', mode: 0o600, flag: 'wx'});

  const client = new Client({connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000});
  let committed = false;
  try {
    await client.connect();
    await client.query('BEGIN');
    const hashed = await bcrypt.hash(password, 12);
    const result = await client.query("UPDATE users SET password_hash=$1 WHERE email=$2 AND role='admin' AND active=true RETURNING id", [hashed, email]);
    if (result.rowCount !== 1) throw new Error(`No active administrator with email ${email} was found. Run npm run setup:local to seed a new database.`);
    await client.query('DELETE FROM auth_sessions WHERE user_id=$1', [result.rows[0].id]);
    await client.query('COMMIT');
    committed = true;
    if (updated !== original) renameSync(pending, envFile);
    console.log(`Administrator: ${email}`);
    console.log(`Password: ${password}`);
    console.log('Existing administrator sessions were signed out. Use this password only for local development.');
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    if (committed) console.error(`Database password changed, but .env could not be updated. Set ADMIN_PASSWORD=${password} in .env manually.`);
    throw error;
  } finally {
    await client.end().catch(() => {});
    if (existsSync(pending)) unlinkSync(pending);
  }
}

main().catch(error => {
  console.error(`Admin reset stopped: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exitCode = 1;
});

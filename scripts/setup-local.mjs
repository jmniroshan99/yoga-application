#!/usr/bin/env node
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {constants, copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');
const templateFile = resolve(root, '.env.example');
const requireApi = createRequire(resolve(root, 'apps/api/package.json'));
const {Client} = requireApi('pg');
const dotenv = requireApi('dotenv');
const fresh = process.argv.includes('--new-database');
const demoAdminPassword = dotenv.parse(readFileSync(templateFile)).ADMIN_PASSWORD;

if (process.argv.includes('--help')) {
  console.log(`Sahana local PostgreSQL setup

  npm run setup:local                 Create a private .env and database on first run;
                                      verify, migrate and seed on later runs.
  node scripts/setup-local.mjs --new-database
                                      Back up an existing .env, then create a
                                      separate empty database and new credentials.

Requires a running local PostgreSQL server and its administrator password.
Optional: SAHANA_PG_HOST (localhost), SAHANA_PG_PORT (5432),
          SAHANA_PG_ADMIN_USER (postgres). No administrator password is saved.`);
  process.exit(0);
}
if (process.argv.length > 2 && (process.argv.slice(2).some(arg => !['--new-database'].includes(arg)))) {
  console.error('Unknown option. Run npm run setup:local -- --help for usage.');
  process.exit(1);
}

function validateEnv(env) {
  const issues = [];
  if (!env.DATABASE_URL || env.DATABASE_URL.includes('REPLACE_')) issues.push('DATABASE_URL');
  else {
    try {
      const url = new URL(env.DATABASE_URL);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || !url.username) issues.push('DATABASE_URL');
    } catch {issues.push('DATABASE_URL');}
  }
  if (!/^[a-f0-9]{64}$/i.test(env.DATA_ENCRYPTION_KEY ?? '')) issues.push('DATA_ENCRYPTION_KEY');
  for (const key of ['ADMIN_PASSWORD', 'DEMO_PASSWORD']) {
    if (!env[key] || env[key].length < 12 || env[key].includes('REPLACE_')) issues.push(key);
  }
  return issues;
}

function describeConnection(error) {
  const code = error?.code;
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENETUNREACH')
    return 'PostgreSQL is not reachable. Start its Windows service, check the host and port, then retry.';
  if (code === '28P01' || code === '28000') return 'PostgreSQL rejected the user/password. Check the administrator password or DATABASE_URL in .env.';
  if (code === '3D000') return 'The configured PostgreSQL database does not exist.';
  if (code === '42501') return 'The PostgreSQL user lacks permission. Connect with an administrator that can create roles and databases.';
  return `PostgreSQL connection failed (${code ?? 'unknown error'}). Check the local server settings.`;
}

async function checkConnection(connectionString) {
  const client = new Client({connectionString, connectionTimeoutMillis: 5000});
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {await client.end().catch(() => {});}
}

function runNpm(script, configuredEnv) {
  const npmCli = process.env.npm_execpath;
  const result = spawnSync(npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm', npmCli ? [npmCli, 'run', script] : ['run', script], {
    cwd: root, stdio: 'inherit', shell: !npmCli && process.platform === 'win32', env: {...process.env, ...configuredEnv}
  });
  if (result.error || result.status !== 0) throw new Error(`${script} failed. Correct the message above, then rerun npm run setup:local.`);
}

function secretPrompt(label) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('Run this setup interactively in Command Prompt or PowerShell to enter the PostgreSQL administrator password.'));
      return;
    }
    let password = '';
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {cleanup(); process.stdout.write('\n'); resolve(password); return;}
        if (ch === '\u0003' || ch === '\u0004') {cleanup(); process.stdout.write('\n'); reject(new Error('Setup cancelled.')); return;}
        if (ch === '\u0008' || ch === '\u007f') password = password.slice(0, -1);
        else if (ch >= ' ') password += ch;
      }
    };
    process.stdout.write(label);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

function setTemplateValue(template, key, value) {
  const line = new RegExp(`^${key}=.*$`, 'm');
  if (!line.test(template)) throw new Error(`Missing ${key} in .env.example.`);
  return template.replace(line, `${key}=${value}`);
}

function saveEnv(contents) {
  if (!existsSync(envFile)) {
    writeFileSync(envFile, contents, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    return;
  }
  const suffix = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(3).toString('hex');
  const backup = `${envFile}.backup-${suffix}`;
  const pending = `${envFile}.pending-${suffix}`;
  copyFileSync(envFile, backup, constants.COPYFILE_EXCL);
  try {
    writeFileSync(pending, contents, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    renameSync(pending, envFile);
  } catch (error) {
    if (existsSync(pending)) unlinkSync(pending);
    throw error;
  }
  console.log(`Previous configuration saved as ${backup}. Keep it private.`);
}

async function provision() {
  if (!demoAdminPassword || demoAdminPassword.length < 12 || demoAdminPassword.includes('REPLACE_'))
    throw new Error('Set a valid local demo ADMIN_PASSWORD in .env.example before provisioning.');
  const host = process.env.SAHANA_PG_HOST || 'localhost';
  const port = Number(process.env.SAHANA_PG_PORT || 5432);
  const adminUser = process.env.SAHANA_PG_ADMIN_USER || 'postgres';
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Use a local PostgreSQL host and a valid SAHANA_PG_PORT (1–65535).');
  console.log(`Connecting to local PostgreSQL at ${host}:${port} as ${adminUser}.`);
  const adminPassword = await secretPrompt('PostgreSQL administrator password (hidden): ');
  const admin = new Client({host, port, user: adminUser, password: adminPassword, database: 'postgres', connectionTimeoutMillis: 5000});
  try {
    try {await admin.connect(); await admin.query('SELECT 1');}
    catch (error) {throw new Error(describeConnection(error));}
    const name = `sahana_${randomBytes(7).toString('hex')}`;
    const dbPassword = randomBytes(24).toString('hex');
    // All SQL identifiers and literals here are generated from ASCII hex only.
    await admin.query(`CREATE ROLE "${name}" LOGIN PASSWORD '${dbPassword}'`);
    await admin.query(`CREATE DATABASE "${name}" OWNER "${name}"`);
    const url = new URL(`postgres://${host === '::1' ? '[::1]' : host}:${port}/${name}`);
    url.username = name;
    url.password = dbPassword;
    try {await checkConnection(url.toString());}
    catch (error) {throw new Error(`New database was created but cannot be reached: ${describeConnection(error)}`);}
    let env = readFileSync(templateFile, 'utf8');
    const demoPassword = randomBytes(24).toString('hex');
    for (const [key, value] of Object.entries({
      DATABASE_URL: url.toString(),
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      ADMIN_PASSWORD: demoAdminPassword,
      DEMO_PASSWORD: demoPassword
    })) env = setTemplateValue(env, key, value);
    saveEnv(env);
    console.log('Created an app database, role and private .env. Running migrations and seed…');
    runNpm('db:migrate', dotenv.parse(env));
    runNpm('db:seed', dotenv.parse(env));
    await checkConnection(url.toString());
    console.log('\nSetup complete. Run npm run dev and open http://localhost:5173/');
    console.log('Administrator: admin@example.test');
    console.log(`Administrator password: ${demoAdminPassword}`);
    console.log(`Demo staff password: ${demoPassword}`);
    console.log('Keep the staff password private; it is stored in .env. Change the documented admin password before deployment.');
  } finally {await admin.end().catch(() => {});}
}

async function existing() {
  const env = dotenv.parse(readFileSync(envFile));
  const issues = validateEnv(env);
  if (issues.length) throw new Error(`Fix these settings in .env: ${issues.join(', ')}. Run notepad .env, or run node scripts/setup-local.mjs --new-database to create an empty database and back up this configuration.`);
  try {await checkConnection(env.DATABASE_URL);}
  catch (error) {throw new Error(`${describeConnection(error)} If this is an old, unusable database setting, run node scripts/setup-local.mjs --new-database to create a separate empty database; your existing .env will be backed up.`);}
  console.log('PostgreSQL connection verified. Applying pending migrations and seed…');
  runNpm('db:migrate', env);
  runNpm('db:seed', env);
  console.log('\nSetup complete. Run npm run dev and open http://localhost:5173/');
  console.log(`Administrator login is ${env.ADMIN_EMAIL || 'admin@sahana.test'} with the password stored in .env.`);
  console.log('If you need to set the documented local demo password, run npm run admin:reset.');
}

try {
  if (fresh || !existsSync(envFile)) await provision();
  else await existing();
} catch (error) {
  console.error(`\nSetup stopped: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exitCode = 1;
}

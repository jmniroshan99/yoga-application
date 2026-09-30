// API smoke-test substitute when a PostgreSQL server cannot run. btree_gist
// exclusion constraints are unavailable in PGlite, so this is NOT a migration
// or concurrency-equivalence test for deployment PostgreSQL.
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';

const db=await PGlite.create();
const source=fs.readFileSync(new URL('../apps/api/migrations/001_initial.sql',import.meta.url),'utf8');
const schema=source.replace('CREATE EXTENSION IF NOT EXISTS btree_gist;','')
  .replace(/,\n  CONSTRAINT practitioner_no_overlap EXCLUDE USING gist[\s\S]*?WHERE\(status = 'open'\)/,'')
  .replace(/,\n  CONSTRAINT room_no_overlap EXCLUDE USING gist[\s\S]*?WHERE\(status = 'open' AND room_id IS NOT NULL\)/,'');
await db.exec(schema);
const server=new PGLiteSocketServer({db,port:Number(process.env.TEST_DB_PORT||5544),host:'127.0.0.1'});
await server.start();
console.log('Embedded test database listening. PostgreSQL exclusion constraints omitted.');
process.on('SIGINT',async()=>{await server.stop();await db.close();process.exit(0);});

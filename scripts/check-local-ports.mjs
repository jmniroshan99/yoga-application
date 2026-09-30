import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createConnection} from 'node:net';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const requireApi=createRequire(resolve(root,'apps/api/package.json'));
const env=requireApi('dotenv').parse(readFileSync(resolve(root,'.env')));
if(env.PORT&&env.PORT!=='4000') {
  console.error('This development setup expects PORT=4000 in .env because Vite proxies API requests to port 4000.');
  process.exit(1);
}
if(env.WEB_ORIGIN&&env.WEB_ORIGIN!=='http://localhost:5173') {
  console.error('This development setup expects WEB_ORIGIN=http://localhost:5173 in .env.');
  process.exit(1);
}

const occupied=port=>new Promise(resolve=>{
  const socket=createConnection({port,host:'127.0.0.1'});
  socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('error',()=>resolve(false));
  socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});
});
const ports=(await Promise.all([4000,5173].map(async port=>(await occupied(port))?port:null))).filter(Boolean);
if(ports.length) {
  console.error(`Port ${ports.join(' and ')} already in use. Stop the older Sahana terminal (Ctrl+C) and run RUN_SYSTEM.bat again.`);
  process.exitCode=1;
} else console.log('API and website ports are available.');

import {constants, copyFileSync, existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=join(project,'.env');
const requireApi=createRequire(join(project,'apps/api/package.json'));
const dotenv=requireApi('dotenv');

function candidates() {
  return readdirSync(dirname(project),{withFileTypes:true})
    .filter(entry=>entry.isDirectory()&&entry.name!==project.split(/[\\/]/).at(-1)&&/^Sahana_Yoga_/i.test(entry.name))
    .map(entry=>join(dirname(project),entry.name))
    .filter(dir=>existsSync(join(dir,'.env'))&&existsSync(join(dir,'package.json')))
    .sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
}

function resolveSource(selection,found) {
  const clean=selection.trim().replace(/^(["'])(.*)\1$/,'$2');
  const index=Number(clean);
  const raw=Number.isInteger(index)&&index>0&&index<=found.length?found[index-1]:clean;
  const path=resolve(raw);
  return existsSync(path)&&statSync(path).isDirectory()?join(path,'.env'):path;
}

async function main() {
  if(existsSync(target)) {
    console.log('This folder already has .env. The existing database connection will be verified.');
    return;
  }
  console.log('This project folder has no .env. Running migrations now would make PostgreSQL use your Windows username.');
  console.log('To keep bookings and users from an older Sahana folder, reuse its private .env.');
  const found=candidates();
  if(found.length) {
    console.log('\nOther Sahana project folders with a private .env:');
    found.forEach((path,index)=>console.log(`  ${index+1}. ${path}`));
  }
  console.log('\nEnter a number above or paste the full path to an older Sahana folder or its .env.');
  console.log('Enter N only if you want to create a separate, empty local database.');
  const prompt=createInterface({input:process.stdin,output:process.stdout});
  let selection;
  try {selection=(await prompt.question('Existing folder / .env path, or N for new: ')).trim();}
  finally {prompt.close();}
  if(/^n$/i.test(selection)) {
    console.log('A new database will be created. Your older database will remain untouched.');
    return;
  }
  if(!selection) throw new Error('No selection was made. Run DATABASE_SETUP.bat again and choose an existing configuration or N.');
  const source=resolveSource(selection,found);
  if(!existsSync(source)||!statSync(source).isFile()) throw new Error(`No .env file was found at ${source}. Nothing was changed.`);
  if(resolve(source)===target) throw new Error('This folder already has the selected .env.');
  const env=dotenv.parse(readFileSync(source));
  if(!env.DATABASE_URL||!env.DATA_ENCRYPTION_KEY)
    throw new Error('The selected .env is missing DATABASE_URL or DATA_ENCRYPTION_KEY. Nothing was copied.');
  copyFileSync(source,target,constants.COPYFILE_EXCL);
  console.log(`Copied the existing private configuration from ${dirname(source)}. Verifying its database connection next.`);
}

try {await main();}
catch(error) {console.error(`Configuration stopped: ${error instanceof Error?error.message:'Unknown error'}`);process.exitCode=1;}

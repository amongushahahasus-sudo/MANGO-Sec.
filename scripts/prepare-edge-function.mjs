import {copyFile,mkdir} from 'node:fs/promises';
const folder=new URL('../supabase/functions/mango-sec-api/',import.meta.url);
await mkdir(folder,{recursive:true});
await copyFile(new URL('../public/trading.js',import.meta.url),new URL('trading.js',folder));
await copyFile(new URL('../src/market.js',import.meta.url),new URL('market.js',folder));
console.log('Prepared shared trading and market modules for the account Edge Function');

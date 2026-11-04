import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
const root=new URL('../',import.meta.url);
const sql=await readFile(new URL('db/schema.sql',root),'utf8');
const db=new DatabaseSync(':memory:');
db.exec(sql);
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name).sort();
if(JSON.stringify(tables)!==JSON.stringify(['mango_accounts','mango_login_codes','mango_sessions']))throw new Error('Unexpected account schema');
db.close();
const migration=new URL('drizzle/0000_mango_accounts.sql',root);
let prior;
try {prior=await readFile(migration,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
if(prior!==undefined){if(prior!==sql)throw new Error('Existing migration is immutable; append a new migration for schema changes.');console.log('Account migration unchanged');}
else{
 await mkdir(new URL('drizzle/meta/',root),{recursive:true});
 await writeFile(migration,sql);
 await writeFile(new URL('drizzle/meta/_journal.json',root),JSON.stringify({version:'7',dialect:'sqlite',entries:[{idx:0,version:'6',when:Date.now(),tag:'0000_mango_accounts',breakpoints:true}]},null,2)+'\n');
 console.log('Generated initial account schema migration');
}

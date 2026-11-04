import {readFile,mkdir,writeFile} from 'node:fs/promises';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
function moduleWrapper(name,source,exports,injected='') {
 source=source.replace(/^import[^;]+;\s*$/gm,'').replace(/^export\s+(?=(?:async\s+)?function|class|const|let)/gm,'');
 if(/^import\s|^export\s/m.test(source))throw new Error('Unsupported import/export in '+name);
 return `const ${name}=(()=>{\n${injected}\n${source}\nreturn {${exports.join(',')}};\n})();\n`;
}
let source=moduleWrapper('Trading',await read('public/trading.js'),['createAccount','executeTrade','validateAccount']);
source+=moduleWrapper('Market',await read('src/market.js'),['STOCKS','getMarket','handleApi']);
source+=moduleWrapper('Auth',await read('src/auth.js'),['handleAuthRoutes','resolveIdentity']);
source+=moduleWrapper('Accounts',await read('src/accounts.js'),['handleAccountApi'],'const {createAccount,executeTrade,validateAccount}=Trading; const {STOCKS,getMarket}=Market;');
source+=moduleWrapper('Gateway',await read('src/gateway.js'),['handleApplicationRequest'],'const {handleApi}=Market; const {handleAccountApi}=Accounts; const {handleAuthRoutes,resolveIdentity}=Auth;');
const assets={};
for(const [route,file,type] of [['/','index.html','text/html; charset=utf-8'],['/index.html','index.html','text/html; charset=utf-8'],['/styles.css','styles.css','text/css; charset=utf-8'],...['app.js','trading.js','auth-client.js','charts.js','theme.js'].map(file=>['/'+file,file,'text/javascript; charset=utf-8'])]) assets[route]={body:await read('public/'+file),type};
source+='\nconst ASSETS='+JSON.stringify(assets)+';\n'+`
const WORKER_SECURITY_HEADERS={
 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://mango-sec-trading.azumaishow781.chatgpt.site; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com"
};
export default { async fetch(request,env,ctx){
 const url=new URL(request.url);
 let response=await Gateway.handleApplicationRequest(request,env);
 if(!response){
  if(!['GET','HEAD'].includes(request.method))response=new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  else{const asset=Object.hasOwn(ASSETS,url.pathname)?ASSETS[url.pathname]:null;
   response=asset?new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache'}}):new Response('Not found',{status:404});}
 }
 const headers=new Headers(response.headers);
 for(const [key,value] of Object.entries(WORKER_SECURITY_HEADERS))headers.set(key,value);
 return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
}};
`;
await mkdir(new URL('../worker/',import.meta.url),{recursive:true});
await writeFile(new URL('../worker/index.js',import.meta.url),source);
console.log('Embedded market, authenticated accounts and browser assets into Worker ESM');

import {readFile,mkdir,writeFile} from 'node:fs/promises';
const market = await readFile(new URL('../src/market.js',import.meta.url),'utf8');
if (/^import\s/m.test(market)) throw new Error('Worker market module must be dependency-free');
const files = [['/','index.html','text/html; charset=utf-8'],['/index.html','index.html','text/html; charset=utf-8'],['/styles.css','styles.css','text/css; charset=utf-8'],['/app.js','app.js','text/javascript; charset=utf-8'],['/trading.js','trading.js','text/javascript; charset=utf-8']];
const assets={};
for (const [route,file,type] of files) assets[route]={body:await readFile(new URL('../public/'+file,import.meta.url),'utf8'),type};
const source = market + '\nconst ASSETS = '+JSON.stringify(assets)+';\n'+`
const WORKER_SECURITY_HEADERS = {
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'strict-origin-when-cross-origin',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com",
};
export default {
 async fetch(request,env,ctx) {
  const url = new URL(request.url);
  let response;
  if (url.pathname.startsWith('/api/')) response = await handleApi(request);
  else if (!['GET','HEAD'].includes(request.method)) response = new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  else {
   const asset=Object.hasOwn(ASSETS,url.pathname)?ASSETS[url.pathname]:null;
   response=asset ? new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache'}}) : new Response('Not found',{status:404});
  }
  const headers = new Headers(response.headers);
  for (const [key,value] of Object.entries(WORKER_SECURITY_HEADERS)) headers.set(key,value);
  return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
 }
};
`;
await mkdir(new URL('../worker/',import.meta.url),{recursive:true});
await writeFile(new URL('../worker/index.js',import.meta.url),source);
console.log('Embedded browser assets and market API into Worker ESM');

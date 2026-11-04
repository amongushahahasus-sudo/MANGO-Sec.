import { handleApi } from './market.js';
import { handleAccountApi } from './accounts.js';
import { handleAuthRoutes, resolveIdentity } from './auth.js';

const PUBLIC_ORIGIN = 'https://amongushahahasus-sudo.github.io';
const ACCOUNT_PATHS = new Set(['/api/account','/api/trades','/api/account/reset','/api/watchlist']);
const gatewayJson = (error,status) => new Response(JSON.stringify({error}),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

/** CORS permits the published Pages origin; authentication remains mandatory per record. */
export async function handleApplicationRequest(request,env={}) {
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/')) return null;
  const origin=request.headers.get('Origin');
  const allowedOrigin=env.PUBLIC_APP_ORIGIN||PUBLIC_ORIGIN;
  const originAllowed=!origin||origin===allowedOrigin||origin===url.origin;
  let response;
  if(!originAllowed) response=gatewayJson('許可されていない送信元です。',403);
  else if(request.method==='OPTIONS') response=new Response(null,{status:204});
  else if(!['GET','HEAD'].includes(request.method)&&!origin) response=gatewayJson('送信元を確認できませんでした。',403);
  else {
    try{
      response=await handleAuthRoutes(request,env);
      if(!response) response=ACCOUNT_PATHS.has(url.pathname)
        ? await handleAccountApi(request,env,await resolveIdentity(request,env))
        : await handleApi(request);
    }catch{response=gatewayJson('サービスに接続できませんでした。時間をおいてから再試行してください。',503);}
  }
  const headers=new Headers(response.headers);
  headers.set('Vary','Origin');
  headers.set('Cache-Control','no-store');
  if(origin&&originAllowed){
    headers.set('Access-Control-Allow-Origin',origin);
    headers.set('Access-Control-Allow-Methods','GET, HEAD, POST, PATCH, OPTIONS');
    headers.set('Access-Control-Allow-Headers','Authorization, Content-Type');
    headers.set('Access-Control-Max-Age','600');
  }
  return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
}

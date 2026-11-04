import { handleApi } from './market.js';
import { handleAccountApi } from './accounts.js';
import { handleAuthRoutes, resolveIdentity } from './auth.js';
import { resolveProviderIdentity } from './provider-auth.js';
import { AUTH_CONFIG } from '../public/auth-config.js';

const PUBLIC_ORIGIN = 'https://amongushahahasus-sudo.github.io';
const ACCOUNT_PATHS = new Set(['/api/account','/api/trades','/api/account/reset','/api/watchlist']);
const gatewayJson = (error,status) => new Response(JSON.stringify({error}),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

async function applicationIdentity(request,env){
  const credential=request.headers.get('Authorization')||'';
  if(/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(credential))return resolveProviderIdentity(request,{PUBLIC_SUPABASE_URL:AUTH_CONFIG.url,PUBLIC_SUPABASE_PUBLISHABLE_KEY:AUTH_CONFIG.publishableKey,...env});
  return resolveIdentity(request,env);
}

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
      response=url.pathname==='/api/session'&&!['GET','HEAD'].includes(request.method) ? gatewayJson('この操作は利用できません。',405) : url.pathname==='/api/session' ? new Response(JSON.stringify(await applicationIdentity(request,env).then(user=>user?{authenticated:true,user:{id:user.userId,displayName:user.displayName,email:user.email}}:{authenticated:false,user:null})),{headers:{'Content-Type':'application/json; charset=utf-8'}}) : await handleAuthRoutes(request,env);
      if(!response) response=ACCOUNT_PATHS.has(url.pathname)
        ? await handleAccountApi(request,env,await applicationIdentity(request,env))
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

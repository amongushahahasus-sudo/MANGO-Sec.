import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthAdapter, createApiRequester, apiRequest, apiUrl, ApiError } from '../public/auth-client.js';

const config = {url:'https://example.supabase.co',publishableKey:'public-test-key',storageKey:'mango-sec:supabase:v3',redirectUrl:'https://example.github.io/MANGO-Sec./'};
const user = {id:'user-1',email:'mango@example.test',user_metadata:{display_name:'Mango'}};
const session = (token='jwt-one') => ({access_token:token,expires_at:Math.floor(Date.now()/1000)+3600,user});
function mockAdapter({initial=session(),url=config.redirectUrl,verifier=null}={}) {
  let cached=initial,callback,options;
  const events=[],calls=[],replaced=[];
  const auth={
    async initialize(){calls.push(['initialize']);return {error:null};},
    onAuthStateChange(fn){callback=fn;return {data:{subscription:{unsubscribe(){}}}};},
    async getSession(){calls.push(['getSession']);return {data:{session:cached},error:null};},
    async signInWithPassword(body){calls.push(['signInWithPassword',body]);return {data:{session:cached,user},error:null};},
    async signUp(body){calls.push(['signUp',body]);return {data:{session:null,user},error:null};},
    async signInWithOAuth(body){calls.push(['signInWithOAuth',body]);return {data:{url:'https://example.supabase.co/auth/v1/authorize'},error:null};},
    async resetPasswordForEmail(...args){calls.push(['resetPasswordForEmail',...args]);return {data:{},error:null};},
    async updateUser(body){calls.push(['updateUser',body]);return {data:{user},error:null};},
    async signOut(body){calls.push(['signOut',body]);cached=null;callback('SIGNED_OUT',null);return {error:null};},
  };
  const adapter=createAuthAdapter(config,{createClient:(...args)=>{options=args;return {auth};},dispatch:(...args)=>events.push(args),location:()=>url,replaceUrl:value=>replaced.push(value),readCodeVerifier:()=>verifier});
  return {adapter,auth,calls,events,replaced,get options(){return options;},setSession:value=>{cached=value;},emit:(event,value)=>callback(event,value)};
}
const tick = () => new Promise(resolve=>queueMicrotask(resolve));

test('Supabase uses separate Sec PKCE persistence and refresh configuration',async()=>{
  const mock=mockAdapter();
  assert.deepEqual(mock.options,[config.url,config.publishableKey,{auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true,storageKey:config.storageKey}}]);
  const result=await mock.adapter.completeSignIn();
  assert.equal(result.user.displayName,'Mango');
  assert.equal(mock.adapter.hasSession(),true);
});

test('API requests obtain a fresh SDK JWT rather than a cached bearer',async()=>{
  const mock=mockAdapter();
  await mock.adapter.completeSignIn();
  const authorizations=[];
  const request=createApiRequester({authAdapter:mock.adapter,fetcher:async(_url,options)=>{authorizations.push(options.headers.Authorization);return new Response('{}',{status:200});}});
  await request('/api/account');
  mock.setSession(session('jwt-refreshed'));
  await request('/api/account');
  await request('/api/stocks',{auth:false});
  assert.deepEqual(authorizations,['Bearer jwt-one','Bearer jwt-refreshed',undefined]);
});

test('auth callback stays synchronous and broadcasts refreshed sessions after it returns',async()=>{
  const mock=mockAdapter({initial:null});
  const returned=mock.emit('TOKEN_REFRESHED',session('jwt-new'));
  assert.equal(returned,undefined);
  assert.equal(mock.events.length,0);
  assert.equal(mock.adapter.getSessionUser().id,user.id);
  await tick();
  assert.equal(mock.events[0][0],'mango:authchange');
  assert.equal(mock.events[0][1].event,'TOKEN_REFRESHED');
  assert.equal(mock.events[0][1].authenticated,true);
});

test('sign-out revokes only the Sec session and prevents a stale refresh restoring it',async()=>{
  const mock=mockAdapter();
  await mock.adapter.completeSignIn();
  let resolveRefresh;
  mock.auth.getSession=()=>new Promise(resolve=>{resolveRefresh=resolve;});
  const pending=mock.adapter.getAccessToken();
  await mock.adapter.signOut();
  resolveRefresh({data:{session:session('old')},error:null});
  assert.equal(await pending,null);
  assert.equal(mock.adapter.hasSession(),false);
  assert.deepEqual(mock.calls.find(call=>call[0]==='signOut'),['signOut',{scope:'local'}]);
});

test('email registration validates inputs and sets the correct confirmation destination',async()=>{
  const mock=mockAdapter();
  await assert.rejects(mock.adapter.signUp('bad','password123','name'),/メールアドレス/);
  await assert.rejects(mock.adapter.signIn('mango@example.test',''),/パスワードを入力/);
  await assert.rejects(mock.adapter.signUp('mango@example.test','short','name'),/8文字/);
  const result=await mock.adapter.signUp(' MANGO@example.test ','password123',' Mango ');
  assert.equal(result.confirmationRequired,true);
  assert.deepEqual(mock.calls.find(call=>call[0]==='signUp')[1],{email:'mango@example.test',password:'password123',options:{emailRedirectTo:config.redirectUrl,data:{display_name:'Mango'}}});
  await mock.adapter.sendPasswordReset('Mango@example.test');
  assert.deepEqual(mock.calls.find(call=>call[0]==='resetPasswordForEmail').slice(1),['mango@example.test',{redirectTo:config.redirectUrl}]);
});

test('Google OAuth and password changes propagate provider errors instead of reporting success',async()=>{
  const mock=mockAdapter();
  mock.auth.signInWithOAuth=async()=>({error:{message:'Unsupported provider: provider is not enabled',status:400}});
  await assert.rejects(mock.adapter.startGoogleSignIn(),/Googleログイン/);
  mock.auth.updateUser=async()=>({error:{code:'weak_password',status:400}});
  await assert.rejects(mock.adapter.updatePassword('password123'),/8文字/);
});

test('recovery callback is retained until the app can show password update UI; URL tokens are cleared',async()=>{
  const mock=mockAdapter({url:config.redirectUrl+'#access_token=secret&refresh_token=secret&type=recovery'});
  const result=await mock.adapter.completeSignIn();
  await tick();
  assert.equal(result.recovery,true);
  assert.deepEqual(mock.replaced,['/MANGO-Sec./#market']);
  assert.ok(mock.events.some(([name])=>name==='mango:passwordrecovery'));
  const errorMock=mockAdapter({url:config.redirectUrl+'?error=access_denied&error_description=expired'});
  await assert.rejects(errorMock.adapter.completeSignIn(),/期限/);
  assert.equal(errorMock.calls.length,0);
});

test('API paths cannot move a bearer to another origin or outside API routes',()=>{
  for(const path of ['https://evil.test/api/account','//evil.test/api/account','/api/../auth/start','/api\\evil'])assert.throws(()=>apiUrl(path));
});

test('unreadable successful API response leaves a mutation outcome uncertain',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response('not JSON',{status:200});
  try {
    await assert.rejects(apiRequest('/api/trades',{method:'POST',body:{},auth:false}),error=>{
      assert.ok(error instanceof ApiError);assert.equal(error.status,200);assert.equal(error.uncertain,true);return true;
    });
  } finally {globalThis.fetch=originalFetch;}
});

test('an unreadable explicit client rejection remains definitive',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response('invalid request',{status:400});
  try {
    await assert.rejects(apiRequest('/api/trades',{method:'POST',body:{},auth:false}),error=>{
      assert.equal(error.status,400);assert.equal(error.uncertain,false);return true;
    });
  } finally {globalThis.fetch=originalFetch;}
});


test('an immediate sign-in waits for queued local cleanup and retains the new session',async()=>{
  const mock=mockAdapter();
  await mock.adapter.completeSignIn();
  let finishSignOut,started=false;
  mock.auth.signOut=()=>new Promise(resolve=>{finishSignOut=()=>resolve({error:null});});
  mock.auth.signInWithPassword=async()=>{started=true;return {data:{session:session('new-login'),user},error:null};};
  mock.adapter.clearAuth();
  const signingIn=mock.adapter.signIn('mango@example.test','password123');
  assert.equal(started,false);
  await tick();await tick();
  finishSignOut();
  await signingIn;
  assert.equal(mock.adapter.hasSession(),true);
  assert.equal(started,true);
});


test('a rejected refresh token clears only the current app and reports expired login',async()=>{
  const mock=mockAdapter();
  await mock.adapter.completeSignIn();
  mock.auth.getSession=async()=>({data:{session:null},error:{code:'refresh_token_not_found',status:400}});
  await assert.rejects(mock.adapter.getAccessToken(),error=>error.status===401&&/ログイン期限/.test(error.message));
  assert.equal(mock.adapter.hasSession(),false);
  await tick();await tick();
  assert.ok(mock.calls.some(call=>call[0]==='signOut'&&call[1].scope==='local'));
});


test('existing shared-project accounts may sign in with a legacy six-character password',async()=>{
  const mock=mockAdapter();
  await mock.adapter.signIn('mango@example.test','old123');
  assert.deepEqual(mock.calls.find(call=>call[0]==='signInWithPassword')[1],{email:'mango@example.test',password:'old123'});
  await assert.rejects(mock.adapter.updatePassword('old123'),/8文字/);
});


test('PKCE initialization errors are surfaced and callback query codes are removed even on failure',async()=>{
  const mock=mockAdapter({url:config.redirectUrl+'?code=expired-code',verifier:'original-browser-proof'});
  mock.auth.initialize=async()=>({error:{code:'flow_state_expired',message:'flow state expired',status:400}});
  await assert.rejects(mock.adapter.completeSignIn(),error=>error.code==='flow_state_expired'&&/期限/.test(error.message));
  assert.equal(mock.adapter.getSessionUser(),null);
  assert.equal(mock.calls.some(call=>call[0]==='getSession'),false);
  assert.deepEqual(mock.replaced,['/MANGO-Sec./']);
});

test('a code link without the original browser verifier cannot reuse an older account session',async()=>{
  const mock=mockAdapter({url:config.redirectUrl+'?code=unverifiable-code'});
  await assert.rejects(mock.adapter.completeSignIn(),error=>error.code==='PKCE_VERIFIER_MISSING'&&/元のブラウザー/.test(error.message));
  mock.emit('INITIAL_SESSION',session('old-account-token'));
  await tick();
  assert.equal(mock.adapter.hasSession(),false);
  assert.equal(mock.calls.some(call=>call[0]==='getSession'),false);
  assert.deepEqual(mock.replaced,['/MANGO-Sec./']);
});

test('a late account A API rejection cannot sign out the newly signed-in account B',async()=>{
  const mock=mockAdapter();
  await mock.adapter.completeSignIn();
  let respond;
  const request=createApiRequester({authAdapter:mock.adapter,fetcher:()=>new Promise(resolve=>{respond=resolve;})});
  const pending=request('/api/account');
  await tick();await tick();
  assert.equal(typeof respond,'function');
  await mock.adapter.signOut();
  const userB={id:'user-2',email:'other@example.test',user_metadata:{display_name:'Other'}};
  const sessionB={...session('jwt-account-b'),user:userB};
  mock.setSession(sessionB);
  await mock.adapter.signIn(userB.email,'legacy');
  respond(new Response(JSON.stringify({error:'old token rejected'}),{status:401}));
  await assert.rejects(pending,error=>error.status===401);
  assert.equal(mock.adapter.getSessionUser().id,userB.id);
  assert.equal(mock.calls.filter(call=>call[0]==='signOut').length,1);
});

test('a login waits for an explicit pending SDK logout so its finally cannot erase the new session',async()=>{
  const mock=mockAdapter();
  await mock.adapter.completeSignIn();
  let finishSignOut,started=false;
  mock.auth.signOut=()=>new Promise(resolve=>{finishSignOut=()=>resolve({error:null});});
  mock.auth.signInWithPassword=async()=>{started=true;return {data:{session:session('new-after-logout'),user},error:null};};
  const loggingOut=mock.adapter.signOut();
  const signingIn=mock.adapter.signIn('mango@example.test','legacy');
  await tick();
  assert.equal(started,false);
  finishSignOut();
  await loggingOut;await signingIn;
  assert.equal(mock.adapter.hasSession(),true);
  assert.equal(started,true);
});

test('a cross-tab identity change during token lookup prevents an old account mutation being sent as the new user',async()=>{
  const mock=mockAdapter();
  await mock.adapter.completeSignIn();
  let resolveSession,sent=false;
  mock.auth.getSession=()=>new Promise(resolve=>{resolveSession=resolve;});
  const request=createApiRequester({authAdapter:mock.adapter,fetcher:async()=>{sent=true;return new Response('{}');}});
  const pending=request('/api/trades',{method:'POST',body:{}});
  const userB={id:'user-2',email:'other@example.test',user_metadata:{display_name:'Other'}};
  mock.emit('SIGNED_IN',{...session('jwt-b'),user:userB});
  resolveSession({data:{session:session('jwt-a-old')},error:null});
  await assert.rejects(pending,error=>error.status===409&&error.code==='AUTH_CHANGED');
  assert.equal(sent,false);
  assert.equal(mock.adapter.getSessionUser().id,userB.id);
});


test('a scoped SDK 2.118 flow verifier is captured before initialization without a legacy proof',async()=>{
  const flowId='flow-id-12345678';
  const scopedKey=`${config.storageKey}-flow-${flowId}-code-verifier`;
  const proofs=new Map([[scopedKey,'original-scoped-browser-proof']]);
  const reads=[],replaced=[];
  const auth={
    onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
    async initialize(){return {error:null};},
    async getSession(){return {data:{session:session('verified-scoped-session')},error:null};},
  };
  const adapter=createAuthAdapter(config,{
    location:()=>config.redirectUrl+'?code=valid-code&sb_flow_id='+flowId,
    readCodeVerifier:key=>{reads.push(key);return proofs.get(key)||null;},
    createClient:()=>{proofs.clear();return {auth};},
    replaceUrl:value=>replaced.push(value),
  });
  const result=await adapter.completeSignIn();
  assert.equal(result.session.access_token,'verified-scoped-session');
  assert.equal(adapter.getSessionUser().id,user.id);
  assert.deepEqual(reads,[scopedKey]);
  assert.deepEqual(replaced,['/MANGO-Sec./']);
});

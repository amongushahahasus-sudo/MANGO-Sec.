import { AUTH_CONFIG } from './auth-config.js';

const DEFAULT_API_BASE = 'https://mango-sec-trading.azumaishow781.chatgpt.site';
const browser = typeof window !== 'undefined' && typeof document !== 'undefined';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const defer = callback => typeof queueMicrotask === 'function' ? queueMicrotask(callback) : Promise.resolve().then(callback);

function configuredBase() {
  const configured = browser ? document.querySelector('meta[name="mango-api-base"]')?.content : null;
  try {
    const url = new URL(configured || DEFAULT_API_BASE);
    return url.origin === DEFAULT_API_BASE && url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : DEFAULT_API_BASE;
  } catch { return DEFAULT_API_BASE; }
}
export const API_BASE = configuredBase();

export class ApiError extends Error {
  constructor(message, status = 0, code = null, uncertain = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.uncertain = uncertain;
  }
}

function authError(error, fallback = '認証処理を完了できませんでした。再度お試しください。') {
  if (error instanceof ApiError) return error;
  const code = typeof error?.code === 'string' ? error.code : null;
  const message = String(error?.message || '').toLowerCase();
  let translated = fallback;
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) translated = 'メールアドレスまたはパスワードが正しくありません。';
  else if (code === 'email_not_confirmed' || message.includes('email not confirmed')) translated = '確認メールのリンクを開いてからログインしてください。';
  else if (['user_already_exists','user_already_registered','email_exists'].includes(code)) translated = 'このメールアドレスは登録済みです。ログインしてください。';
  else if (code === 'weak_password' || message.includes('password should')) translated = 'パスワードは8文字以上で設定してください。';
  else if (code === 'email_address_invalid') translated = '有効なメールアドレスを入力してください。';
  else if (['over_email_send_rate_limit','over_request_rate_limit'].includes(code) || error?.status === 429) translated = '送信回数が多いため、時間をおいてからお試しください。';
  else if (['refresh_token_not_found','refresh_token_already_used','session_not_found','user_not_found','bad_jwt','jwt_expired'].includes(code)) translated = 'ログイン期限が切れました。もう一度ログインしてください。';
  else if (code === 'signup_disabled') translated = '現在、新規登録を受け付けていません。';
  else if (message.includes('provider is not enabled') || message.includes('unsupported provider')) translated = 'Googleログインは現在利用できません。メールアドレスでログインしてください。';
  else if (message.includes('expired') || ['otp_expired','flow_state_expired','flow_state_not_found'].includes(code)) translated = '認証リンクの期限が切れています。もう一度手続きを行ってください。';
  else if (message.includes('fetch') || message.includes('network')) translated = '認証サーバーに接続できませんでした。通信環境を確認してください。';
  return new ApiError(translated, Number.isInteger(error?.status) ? error.status : 0, code);
}
function normaliseEmail(email) {
  const value = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new ApiError('有効なメールアドレスを入力してください。', 400, 'INVALID_EMAIL');
  return value;
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 1024) throw new ApiError('パスワードは8文字以上で入力してください。', 400, 'INVALID_PASSWORD');
  return password;
}
function normaliseUser(user) {
  if (!isRecord(user) || typeof user.id !== 'string') return null;
  const email = typeof user.email === 'string' ? user.email : '';
  const metadata = isRecord(user.user_metadata) ? user.user_metadata : {};
  const display = [metadata.display_name,metadata.full_name,metadata.name].find(value => typeof value === 'string' && value.trim());
  return {id:user.id,email,displayName:(display?.trim() || email.split('@')[0] || 'アカウント').slice(0,100)};
}
function callbackDetails(locationValue) {
  try {
    const url = new URL(locationValue || AUTH_CONFIG.redirectUrl);
    const hash = new URLSearchParams(url.hash.slice(1));
    const flowId=url.searchParams.get('sb_flow_id')||hash.get('sb_flow_id');
    return {
      flowId:typeof flowId==='string'&&/^[a-zA-Z0-9_-]{8,64}$/.test(flowId)?flowId:null,
      url,
      recovery:url.searchParams.get('type') === 'recovery' || hash.get('type') === 'recovery',
      error:url.searchParams.get('error') || hash.get('error'),
      errorDescription:url.searchParams.get('error_description') || hash.get('error_description'),
      hasCode:url.searchParams.has('code'),
      hasCallback:url.searchParams.has('code') || hash.has('access_token') || hash.has('refresh_token') || hash.has('error') || url.searchParams.has('error') || hash.get('type') === 'recovery',
    };
  } catch { return {url:null,flowId:null,recovery:false,error:null,errorDescription:null,hasCode:false,hasCallback:false}; }
}
function callbackError(details) {
  const message = String(details.errorDescription || details.error || '').toLowerCase();
  if (message.includes('expired')) return new ApiError('認証リンクの期限が切れています。もう一度手続きを行ってください。',400,'AUTH_LINK_EXPIRED');
  if (message.includes('provider') && (message.includes('not enabled') || message.includes('unsupported'))) return new ApiError('Googleログインは現在利用できません。メールアドレスでログインしてください。',400,'AUTH_PROVIDER_UNAVAILABLE');
  if (message.includes('access_denied') || message.includes('cancel')) return new ApiError('ログインがキャンセルされました。',400,'AUTH_CANCELLED');
  return new ApiError('認証リンクを確認できませんでした。もう一度ログインしてください。',400,'AUTH_CALLBACK_ERROR');
}

/** SDK adapter owns only the Sec storage key; MANGO FX keeps its own session. */
export function createAuthAdapter(config, {
  createClient,
  dispatch = () => {},
  location = () => config.redirectUrl,
  replaceUrl = () => {},
  removeCachedSession = () => {},
  readCodeVerifier = () => null,
  clock = Date.now,
} = {}) {
  if (typeof createClient !== 'function') throw new ApiError('認証機能を読み込めませんでした。ページを再読み込みしてください。');
  const callback = callbackDetails(location());
  // createClient starts SDK initialization immediately, so inspect the original
  // browser's PKCE proof before the SDK can consume or remove it.
  let verifierPresent = !callback.hasCode;
  if (callback.hasCode) {
    // Match SDK 2.118's validated flow-id namespace, then its legacy proof.
    const keys=callback.flowId?[`${config.storageKey}-flow-${callback.flowId}-code-verifier`,`${config.storageKey}-code-verifier`]:[`${config.storageKey}-code-verifier`];
    for(const key of keys){
      try{const value=readCodeVerifier(key);verifierPresent=typeof value==='string'?value.trim().length>0:value===true;}catch{verifierPresent=false;}
      if(verifierPresent)break;
    }
  }
  let currentSession = null;
  let recovery = callback.recovery;
  let recoveryAnnounced = false;
  let generation = 0;
  let sessionEpoch = 0;
  let clearing = false;
  let callbackPending = callback.hasCallback;
  let callbackBlocked = false;
  let initialising = null;
  let pendingLogout = null;
  const client = createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true,storageKey:config.storageKey}});
  if (!client?.auth) throw new ApiError('認証機能を読み込めませんでした。ページを再読み込みしてください。');
  const validSession = session => isRecord(session) && typeof session.access_token === 'string' && session.access_token.length > 0 && normaliseUser(session.user)
    && (!Number.isFinite(session.expires_at) || session.expires_at * 1000 > clock());
  function setSession(value) {
    const next = validSession(value) ? value : null;
    if ((next?.access_token || null) !== (currentSession?.access_token || null) || (next?.user?.id || null) !== (currentSession?.user?.id || null)) sessionEpoch++;
    currentSession = next;
  }
  const hasSession = () => Boolean(validSession(currentSession));
  const getSessionUser = () => hasSession() ? normaliseUser(currentSession.user) : null;
  const emit = event => {
    const eventGeneration = generation,eventEpoch = sessionEpoch;
    defer(() => {
      if (eventGeneration !== generation || eventEpoch !== sessionEpoch) return;
      dispatch('mango:authchange',{authenticated:hasSession(),user:getSessionUser(),event});
      if (recovery && !recoveryAnnounced && hasSession()) {
        recoveryAnnounced = true;
        dispatch('mango:passwordrecovery',{user:getSessionUser()});
      }
    });
  };
  // Supabase callbacks must stay synchronous: awaiting another auth method here
  // can deadlock the SDK's storage lock.
  const listener = client.auth.onAuthStateChange((event,session) => {
    if ((!clearing && !callbackPending && !callbackBlocked) || event === 'SIGNED_OUT') setSession(session);
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    emit(event);
  });
  function cleanupCallbackUrl() {
    if (!callback.hasCallback || !callback.url) return;
    const url = new URL(callback.url.href);
    for (const key of ['code','sb_flow_id','error','error_code','error_description','type']) url.searchParams.delete(key);
    const hash = new URLSearchParams(url.hash.slice(1));
    if (['access_token','refresh_token','error','type'].some(key => hash.has(key))) url.hash = '#market';
    replaceUrl(`${url.pathname}${url.search}${url.hash}`);
  }
  async function refreshSession() {
    if (clearing || callbackPending || callbackBlocked) return null;
    const requestGeneration = generation,requestEpoch = sessionEpoch,requestToken = currentSession?.access_token || null;
    try {
      const result = await client.auth.getSession();
      if (result.error) throw authError(result.error);
      if (requestGeneration !== generation || clearing) return null;
      const next = validSession(result.data?.session) ? result.data.session : null;
      // A delayed SDK read must not replace a newer session announced by another tab.
      if (requestEpoch !== sessionEpoch && (next?.access_token || null) !== (currentSession?.access_token || null)) return null;
      setSession(next);
      return currentSession;
    } catch(error) {
      const failure = authError(error);
      if (['refresh_token_not_found','refresh_token_already_used','session_not_found','user_not_found','bad_jwt','jwt_expired'].includes(failure.code)) {
        clearAuth(requestToken,requestEpoch);failure.status = 401;
      }
      throw failure;
    }
  }
  async function completeSignIn() {
    if (!initialising) initialising = (async () => {
      try {
        if (callback.error || callback.errorDescription) throw callbackError(callback);
        if (callback.hasCode && !verifierPresent) throw new ApiError('このブラウザーでは認証リンクを確認できません。手続きを始めた元のブラウザーでリンクを開くか、メールアドレスでログインしてください。',400,'PKCE_VERIFIER_MISSING');
        // getSession alone can hide an initialization error from a failed PKCE exchange.
        if (typeof client.auth.initialize === 'function') {
          const initialized = await client.auth.initialize();
          if (initialized?.error) throw authError(initialized.error);
        }
        callbackPending = false;callbackBlocked = false;
        const session = await refreshSession();
        emit('INITIAL_SESSION');
        return {session,user:getSessionUser(),recovery};
      } catch(error) {
        if (callback.hasCallback) { callbackBlocked = true;setSession(null); }
        throw authError(error);
      } finally { callbackPending = false;cleanupCallbackUrl(); }
    })();
    return initialising;
  }
  async function waitForLogout() {
    if (pendingLogout) await pendingLogout.catch(() => {});
  }
  async function signIn(email,password) {
    const value = normaliseEmail(email);
    if (typeof password !== 'string' || password.length === 0 || password.length > 1024) throw new ApiError('パスワードを入力してください。',400,'INVALID_PASSWORD');
    await waitForLogout();
    const requestGeneration = ++generation;
    clearing = false;callbackPending = false;callbackBlocked = false;recovery = false;recoveryAnnounced = false;
    try {
      const result = await client.auth.signInWithPassword({email:value,password});
      if (result.error) throw authError(result.error);
      if (requestGeneration !== generation) throw new ApiError('ログイン状態が変わりました。もう一度お試しください。');
      setSession(result.data?.session);
      if (!currentSession) throw new ApiError('ログインの応答を確認できませんでした。もう一度お試しください。');
      emit('SIGNED_IN');
      return {session:currentSession,user:getSessionUser()};
    } catch(error) { throw authError(error); }
  }
  async function signUp(email,password,displayName = '') {
    const value = normaliseEmail(email);validatePassword(password);
    const name = typeof displayName === 'string' ? displayName.trim() : '';
    if (name.length > 50) throw new ApiError('表示名は50文字以内で入力してください。',400,'INVALID_DISPLAY_NAME');
    await waitForLogout();
    const requestGeneration = ++generation;
    clearing = false;callbackPending = false;callbackBlocked = false;recovery = false;recoveryAnnounced = false;
    try {
      const result = await client.auth.signUp({email:value,password,options:{emailRedirectTo:config.redirectUrl,data:{display_name:name}}});
      if (result.error) throw authError(result.error);
      if (requestGeneration !== generation) throw new ApiError('ログイン状態が変わりました。もう一度お試しください。');
      setSession(result.data?.session);
      emit(currentSession ? 'SIGNED_IN' : 'SIGNUP_CONFIRMATION_REQUIRED');
      return {confirmationRequired:!currentSession,user:normaliseUser(result.data?.user),session:currentSession};
    } catch(error) { throw authError(error); }
  }
  async function startGoogleSignIn() {
    await waitForLogout();
    try {
      const result = await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:config.redirectUrl,queryParams:{prompt:'select_account'}}});
      if (result.error) throw authError(result.error);
      if (!result.data?.url) throw new ApiError('Googleログインを開始できませんでした。メールアドレスでお試しください。');
      return result.data;
    } catch(error) { throw authError(error); }
  }
  async function sendPasswordReset(email) {
    try {
      const result = await client.auth.resetPasswordForEmail(normaliseEmail(email),{redirectTo:config.redirectUrl});
      if (result.error) throw authError(result.error);
      return true;
    } catch(error) { throw authError(error); }
  }
  async function updatePassword(password) {
    validatePassword(password);
    try {
      const result = await client.auth.updateUser({password});
      if (result.error) throw authError(result.error);
      if (!result.data?.user) throw new ApiError('パスワードの更新を確認できませんでした。もう一度お試しください。');
      recovery = false;recoveryAnnounced = false;
      return normaliseUser(result.data.user);
    } catch(error) { throw authError(error); }
  }
  function forgetSession() {
    setSession(null);
    try { removeCachedSession(config.storageKey); } catch { /* The in-memory account is still cleared. */ }
  }
  function beginLogout(suppressErrors) {
    if (pendingLogout) return pendingLogout;
    const logoutGeneration = ++generation;
    clearing = true;forgetSession();emit('SIGNED_OUT');
    // Always start outside SDK subscription callbacks; explicit sign-in waits for this promise.
    const operation = Promise.resolve().then(() => client.auth.signOut({scope:'local'})).then(result => {
      if (result?.error) throw authError(result.error);
    }).catch(error => { if (!suppressErrors) throw authError(error); }).finally(() => {
      if (logoutGeneration === generation) { clearing = false;forgetSession();emit('SIGNED_OUT'); }
      if (pendingLogout === operation) pendingLogout = null;
    });
    pendingLogout = operation;
    return operation;
  }
  function signOut() { return beginLogout(false); }
  function clearAuth(expectedToken,expectedEpoch) {
    if (arguments.length > 0 && ((currentSession?.access_token || null) !== expectedToken || (expectedEpoch !== undefined && expectedEpoch !== sessionEpoch))) return false;
    beginLogout(true);
    return true;
  }
  async function getRequestContext() {
    const requestGeneration = generation,requestUser = currentSession?.user?.id || null;
    const session = await refreshSession();
    if (requestGeneration !== generation || (requestUser && session?.user?.id !== requestUser)) return {token:null,generation:sessionEpoch,stale:true};
    return {token:session?.access_token || null,generation:sessionEpoch,stale:false};
  }
  return {
    completeSignIn,signIn,signUp,startGoogleSignIn,sendPasswordReset,updatePassword,
    signOut,clearAuth,hasSession,getSessionUser,getRequestContext,
    getSessionGeneration:() => sessionEpoch,
    getAccessToken:async () => (await getRequestContext()).token,
    destroy:() => listener?.data?.subscription?.unsubscribe?.(),
  };
}

let adapter = null;
function singleton() {
  if (adapter) return adapter;
  if (!browser || typeof globalThis.supabase?.createClient !== 'function') throw new ApiError('認証機能を読み込めませんでした。ページを再読み込みしてください。');
  for (const key of ['mango-sec:session:v2','mango-sec:login:v2']) {
    try { sessionStorage.removeItem(key); } catch { /* Ignore legacy device storage. */ }
  }
  adapter = createAuthAdapter(AUTH_CONFIG,{
    createClient:(...args) => globalThis.supabase.createClient(...args),
    dispatch:(name,detail) => window.dispatchEvent(new CustomEvent(name,{detail})),
    location:() => window.location.href,
    replaceUrl:value => history.replaceState(null,'',value),
    removeCachedSession:key => {localStorage.removeItem(key);localStorage.removeItem(`${key}-code-verifier`);},
    readCodeVerifier:key => {const raw=localStorage.getItem(key);if(raw===null)return null;try{return JSON.parse(raw);}catch{return raw;}},
  });
  return adapter;
}
export const completeSignIn = () => singleton().completeSignIn();
export const signIn = (email,password) => singleton().signIn(email,password);
export const signUp = (email,password,name) => singleton().signUp(email,password,name);
export const startGoogleSignIn = () => singleton().startGoogleSignIn();
export const beginSignIn = startGoogleSignIn;
export const sendPasswordReset = email => singleton().sendPasswordReset(email);
export const updatePassword = password => singleton().updatePassword(password);
export const signOut = () => singleton().signOut();
export function clearAuth(...args) { return adapter?.clearAuth(...args); }
export const hasSession = () => adapter?.hasSession() || false;
export const getSessionUser = () => adapter?.getSessionUser() || null;

/** API callers may pass only a path on this app's backend, never another origin. */
export function apiUrl(path) {
  if (typeof path !== 'string' || !/^\/api(?:\/|\?|$)/.test(path) || path.includes('\\')) throw new TypeError('APIパスが不正です。');
  const url = new URL(path,API_BASE);
  if (url.origin !== API_BASE || !/^\/api(?:\/|$)/.test(url.pathname)) throw new TypeError('APIパスが不正です。');
  return url.href;
}

export function createApiRequester({authAdapter,fetcher = (...args) => fetch(...args)} = {}) {
  return async function request(path,{method='GET',body,auth=true,signal}={}) {
    const url = apiUrl(path);
    const headers = {Accept:'application/json'};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const selected = auth ? (typeof authAdapter === 'function' ? authAdapter() : authAdapter) : null;
    let requestContext = null;
    if (auth) {
      requestContext = typeof selected?.getRequestContext === 'function' ? await selected.getRequestContext() : {token:await selected?.getAccessToken(),generation:selected?.getSessionGeneration?.()};
      if (requestContext?.stale) throw new ApiError('ログイン状態が変わりました。内容を確認してからもう一度お試しください。',409,'AUTH_CHANGED');
      if (requestContext?.token) headers.Authorization = `Bearer ${requestContext.token}`;
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort',abort,{once:true});
    const timer = setTimeout(() => controller.abort(),20_000);
    try {
      const response = await fetcher(url,{method,headers,body:body === undefined ? undefined : JSON.stringify(body),credentials:'omit',cache:'no-store',signal:controller.signal});
      let data;
      try { data = await response.json(); }
      catch { throw new ApiError('サーバーの応答を読み取れませんでした。処理結果を確認してください。',response.status,null,response.ok); }
      if (!response.ok) {
        if (response.status === 401 && auth) {
          selected?.clearAuth(requestContext?.token || null,requestContext?.generation);
        }
        const message = typeof data?.error === 'string' ? data.error : typeof data?.error?.message === 'string' ? data.error.message : '処理を完了できませんでした。再度お試しください。';
        throw new ApiError(message,response.status,typeof data?.code === 'string' ? data.code : null);
      }
      return data;
    } catch(error) {
      if (error instanceof ApiError) throw error;
      if (error?.name === 'AbortError') throw new ApiError('通信に時間がかかっています。処理結果を確認してから再試行してください。');
      throw new ApiError('サーバーに接続できませんでした。通信環境を確認してください。');
    } finally { clearTimeout(timer);signal?.removeEventListener('abort',abort); }
  };
}
const requestApi = createApiRequester({authAdapter:() => singleton()});
export const apiRequest = (path,options) => requestApi(path,options);

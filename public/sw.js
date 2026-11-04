/* Public app shell only. Account, authentication and market responses stay online. */
const CACHE_NAME = 'mango-sec-v3-static-1';
const APP_SCOPE = new URL(self.registration.scope);
const SHELL_FILES = [
  './', './index.html', './styles.css', './app.js', './theme.js', './charts.js',
  './trading.js', './auth-client.js', './account-ui.js', './onboarding.js',
  './pwa.js', './auth-config.js', './account-ui.css', './onboarding.css', './vendor/supabase-2.118.0.js', './manifest.webmanifest', './icons/icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
const SHELL_URLS = new Set(SHELL_FILES.map(path => new URL(path, APP_SCOPE).href));
const DOCUMENT_URLS = new Set(['./', './index.html'].map(path => new URL(path, APP_SCOPE).href));

function cacheableRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  return url.origin === APP_SCOPE.origin && url.pathname.startsWith(APP_SCOPE.pathname)
    && !url.search && !url.hash && SHELL_URLS.has(url.href);
}

function cacheableResponse(response, url) {
  if (!response || !response.ok || response.status !== 200 || response.redirected) return false;
  if (response.type !== 'basic' && response.type !== 'default') return false;
  const type = (response.headers.get('content-type') || '').split(';')[0].trim();
  const pathname = new URL(url).pathname;
  if (DOCUMENT_URLS.has(url)) return type === 'text/html';
  if (pathname.endsWith('.js')) return ['text/javascript', 'application/javascript'].includes(type);
  if (pathname.endsWith('.css')) return type === 'text/css';
  if (pathname.endsWith('.webmanifest')) return ['application/manifest+json', 'application/json'].includes(type);
  if (pathname.endsWith('.svg')) return type === 'image/svg+xml';
  if (pathname.endsWith('.png')) return type === 'image/png';
  return false;
}

async function storeResponse(cache, request, response) {
  if (cacheableRequest(request) && cacheableResponse(response, request.url)) {
    await cache.put(request, response.clone());
  }
}

const offlineDocument = () => new Response(`<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f7f8fa"><title>MANGO Sec. — オフライン</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8fa;color:#182327;font:16px/1.8 system-ui,sans-serif}main{max-width:32rem;padding:2rem}h1{font-size:1.6rem}a{color:#37634f}</style>
<main><h1>MANGO Sec.</h1><p>現在オフラインです。</p><p>保存済みの画面がありません。インターネットに接続してもう一度開いてください。売買・ログインには接続が必要です。</p><a href="${APP_SCOPE.pathname}">接続を確認して再読み込み</a></main></html>`, {
  status: 503,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function documentResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    await storeResponse(cache, request, response);
    return response;
  } catch {
    return await cache.match(request) || await cache.match(new URL('./', APP_SCOPE).href)
      || await cache.match(new URL('./index.html', APP_SCOPE).href) || offlineDocument();
  }
}

async function staticResponse(event) {
  const cache = await caches.open(CACHE_NAME);
  const saved = await cache.match(event.request);
  const fresh = fetch(event.request).then(async response => {
    await storeResponse(cache, event.request, response);
    return response;
  });
  // Refresh public assets in the background, without caching failed or redirected responses.
  if (saved) {
    event.waitUntil(fresh.catch(() => {}));
    return saved;
  }
  return fresh;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL_FILES.map(async path => {
      const request = new Request(new URL(path, APP_SCOPE).href, { cache: 'reload', credentials: 'same-origin' });
      try { await storeResponse(cache, request, await fetch(request)); }
      catch { /* A missing optional module never turns a 404 into an offline script. */ }
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('mango-sec-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'MANGO_SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (!cacheableRequest(event.request)) return;
  const url = new URL(event.request.url);
  if (event.request.mode === 'navigate' && DOCUMENT_URLS.has(url.href)) {
    event.respondWith(documentResponse(event.request));
  } else if (event.request.mode !== 'navigate' && !DOCUMENT_URLS.has(url.href)) {
    event.respondWith(staticResponse(event));
  }
});

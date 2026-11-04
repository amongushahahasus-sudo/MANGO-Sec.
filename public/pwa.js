let activeController;

export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function initPwa({ mount = '#install-control' } = {}) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  if (activeController) return activeController;
  const target = typeof mount === 'string' ? document.querySelector(mount) : mount;
  const cleanups = [];
  const listen = (object, type, callback, options) => {
    object.addEventListener(type, callback, options);
    cleanups.push(() => object.removeEventListener(type, callback, options));
  };
  const displayMode = window.matchMedia?.('(display-mode: standalone)');
  const standalone = () => Boolean(displayMode?.matches || navigator.standalone === true);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent || '')
    || (/Macintosh/.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1);
  let pendingPrompt;
  let registration;
  let updateRequested = false;
  let destroyed = false;
  let installed = standalone();
  let guide;
  let restoreFocus;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary pwa-install-button';
  button.textContent = 'ホーム画面に追加';
  button.title = 'MANGO Sec. をアイコン付きのアプリとして追加';
  button.hidden = installed;
  target?.append(button);

  const updateButton = document.createElement('button');
  updateButton.type = 'button';
  updateButton.className = 'btn btn-secondary pwa-update-button';
  updateButton.textContent = '新しいバージョンに更新';
  updateButton.title = '画面を再読み込みして更新します';
  updateButton.hidden = true;
  target?.append(updateButton);

  const connectivity = document.createElement('div');
  connectivity.className = 'pwa-offline-banner';
  connectivity.setAttribute('role', 'status');
  connectivity.setAttribute('aria-live', 'polite');
  connectivity.textContent = 'オフラインです。保存済み画面の閲覧のみ利用できます。売買・ログインにはインターネット接続が必要です。';
  Object.assign(connectivity.style, {
    padding: '12px 20px', background: '#fff1d9', color: '#5e3b17', fontSize: '13px',
    lineHeight: '1.7', textAlign: 'center', borderBottom: '1px solid #edc99a',
  });
  document.body.prepend(connectivity);
  const updateConnectivity = () => {
    const online = isOnline();
    connectivity.hidden = online;
    document.documentElement.dataset.connection = online ? 'online' : 'offline';
    window.dispatchEvent(new CustomEvent('mango:connectivitychange', { detail: { online } }));
  };
  listen(window, 'online', updateConnectivity);
  listen(window, 'offline', updateConnectivity);
  updateConnectivity();

  const closeGuide = () => {
    if (typeof guide?.close === 'function' && guide.open) guide.close();
    else if (guide) guide.removeAttribute('open');
  };
  const showGuide = () => {
    if (!guide) {
      guide = document.createElement('dialog');
      guide.className = 'modal pwa-install-guide';
      guide.id = 'mango-install-guide';
      guide.setAttribute('aria-labelledby', 'mango-install-title');
      guide.setAttribute('aria-describedby', 'mango-install-description');
      const icon = new URL('./icons/icon-192.png', import.meta.url).href;
      guide.innerHTML = `<div class="modal-heading"><img src="${icon}" alt="" width="64" height="64" style="border-radius:16px;margin-bottom:16px"><p class="eyebrow">MANGO SEC. APP</p><h2 id="mango-install-title">ホーム画面から、すぐに。</h2><p id="mango-install-description">MANGO Sec. をアイコン付きで追加すると、アプリのように開けます。</p></div>`;
      const steps = document.createElement('ol');
      Object.assign(steps.style, { paddingLeft: '22px', lineHeight: '1.9', margin: '20px 0' });
      const instructions = ios
        ? ['このページをSafariで開きます。', '共有ボタン（四角から上向きの矢印）を押します。', '「ホーム画面に追加」を選び、「追加」を押します。']
        : ['ChromeまたはEdgeでこのページを開きます。', 'アドレスバーのインストールアイコン、またはブラウザーのメニューを開きます。', '「アプリをインストール」または「ホーム画面に追加」を選びます。'];
      for (const text of instructions) {
        const step = document.createElement('li');
        step.textContent = text;
        steps.append(step);
      }
      const note = document.createElement('p');
      note.className = 'order-disclaimer';
      note.textContent = '追加後も、株価の更新・ログイン・仮想取引にはインターネット接続が必要です。';
      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'btn btn-primary';
      close.textContent = 'わかりました';
      actions.append(close);
      guide.append(steps, note, actions);
      document.body.append(guide);
      listen(close, 'click', closeGuide);
      listen(guide, 'close', () => restoreFocus?.focus?.());
      listen(guide, 'click', event => { if (event.target === guide) closeGuide(); });
    }
    restoreFocus = document.activeElement;
    if (guide.open) return;
    if (typeof guide.showModal === 'function') guide.showModal();
    else { guide.setAttribute('open', ''); guide.querySelector('button')?.focus(); }
  };

  listen(window, 'beforeinstallprompt', event => {
    event.preventDefault();
    pendingPrompt = event;
    button.hidden = installed || standalone();
  });
  const markInstalled = () => {
    installed = true;
    pendingPrompt = undefined;
    button.hidden = true;
    closeGuide();
  };
  listen(window, 'appinstalled', markInstalled);
  if (displayMode?.addEventListener) listen(displayMode, 'change', () => {
    installed = standalone();
    button.hidden = installed;
  });
  listen(button, 'click', async () => {
    if (!pendingPrompt) { showGuide(); return; }
    const prompt = pendingPrompt;
    pendingPrompt = undefined;
    button.disabled = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch { showGuide(); }
    finally { button.disabled = false; }
  });

  const showUpdate = () => {
    if (!destroyed && registration?.waiting && navigator.serviceWorker.controller) updateButton.hidden = false;
  };
  listen(updateButton, 'click', () => {
    if (!registration?.waiting) return;
    updateRequested = true;
    updateButton.disabled = true;
    updateButton.textContent = '更新しています…';
    registration.waiting.postMessage({ type: 'MANGO_SKIP_WAITING' });
  });
  if (location.protocol === 'https:' && 'serviceWorker' in navigator) {
    listen(navigator.serviceWorker, 'controllerchange', () => {
      if (updateRequested) window.location.reload();
    });
    const worker = new URL('./sw.js', import.meta.url);
    navigator.serviceWorker.register(worker.href, {
      scope: new URL('./', import.meta.url).pathname,
      updateViaCache: 'none',
    }).then(result => {
      if (destroyed) return;
      registration = result;
      showUpdate();
      listen(registration, 'updatefound', () => {
        const incoming = registration.installing;
        if (incoming) listen(incoming, 'statechange', () => {
          if (incoming.state === 'installed') showUpdate();
        });
      });
    }).catch(() => {
      // The web application and browser's manual installation remain available.
    });
  }

  activeController = {
    get online() { return isOnline(); },
    get installed() { return installed; },
    showInstallGuide: showGuide,
    destroy() {
      destroyed = true;
      cleanups.forEach(cleanup => cleanup());
      button.remove();
      updateButton.remove();
      connectivity.remove();
      guide?.remove();
      delete document.documentElement.dataset.connection;
      activeController = undefined;
    },
  };
  return activeController;
}

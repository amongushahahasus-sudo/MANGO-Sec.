export const ONBOARDING_STORAGE_KEY = 'mango-sec:onboarding:v1';
export const TUTORIAL_PAGE_COUNT = 4;
export const ACCOUNT_STEP = TUTORIAL_PAGE_COUNT;

const clampStep = step => Number.isFinite(Number(step))
  ? Math.max(0, Math.min(ACCOUNT_STEP, Math.trunc(Number(step)))) : 0;

/** Navigation never marks the introduction complete; only an explicit finish does. */
export function createTutorialState(startAt = 0) {
  return { step: clampStep(startAt), status: 'active' };
}

export function transitionTutorial(state, action) {
  const current = { ...createTutorialState(state?.step), status: state?.status || 'active' };
  const event = typeof action === 'string' ? { type: action } : action || {};
  if (event.type === 'open') return createTutorialState(event.startAt ?? current.step);
  if (event.type === 'complete') return { ...current, status: 'completed' };
  if (current.status !== 'active') return current;
  if (event.type === 'next') return { ...current, step: clampStep(current.step + 1) };
  if (event.type === 'back') return { ...current, step: clampStep(current.step - 1) };
  if (event.type === 'go') return { ...current, step: clampStep(event.step) };
  if (event.type === 'dismiss') return { ...current, status: 'dismissed' };
  return current;
}

const mango = '<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#ffad42" d="M49 16C34 5 11 18 10 36c-1 20 25 24 37 9 9-12 10-23 2-29Z"/><path fill="#3e7760" d="M35 13C39 0 51 1 56 4c-2 10-12 14-21 9Z"/></svg>';
const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
const cloud = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18a4 4 0 0 1-.8-7.9A7 7 0 0 1 19 9a4.5 4.5 0 0 1-.5 9H6Z"/><path d="m9 13 2 2 4-4"/></svg>';
const google = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.3 2.9-7.5Z"/><path fill="#34a853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6c-.9.6-2 .9-3.4.9-2.6 0-4.9-1.8-5.7-4.2H2.9v2.7A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.3 13.7a6 6 0 0 1 0-3.4V7.6H2.9a10 10 0 0 0 0 8.8l3.4-2.7Z"/><path fill="#ea4335" d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-9.1 5.6l3.4 2.7C7.1 7.9 9.4 6.1 12 6.1Z"/></svg>';
const email = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>';

const pages = [
  {
    eyebrow: 'WELCOME TO MANGO SEC.',
    title: '投資のはじめの一歩を、\nここから。',
    description: 'MANGO Sec. へようこそ。日本株も米国株も、実際の相場を見ながら、自分のペースで株取引を練習できます。',
    points: ['実際の市場データで学ぶ', '仮想資金で売買を体験', 'あなた専用の口座で続ける'],
    visual: 'welcome',
  },
  {
    eyebrow: '01 / FIND YOUR OPPORTUNITY',
    title: '気になる企業の、\n値動きを見てみよう。',
    description: 'キオクシア、任天堂、NVIDIA、Apple など、日本と米国の銘柄を探せます。チャートは折れ線とローソク足を切り替えられます。',
    points: ['銘柄名・コードで検索', '折れ線とローソク足を切り替え', '取得元と更新時刻を確認'],
    note: '市場データには遅延があります。休場中は直近の取引価格を表示します。',
    visual: 'market',
  },
  {
    eyebrow: '02 / MAKE YOUR FIRST TRADE',
    title: 'まずは1株。\n仮想資金で試してみよう。',
    description: '日本株用に1,000万円、米国株用に1万ドルの仮想資金からスタート。銘柄と株数を選び、内容を確認して注文します。',
    points: ['日本株も1株から練習', '「買う」「売る」を体験', '注文前に金額を確認'],
    note: '学習用のシミュレーターです。実際の金銭や株式は移動しません。',
    visual: 'trade',
  },
  {
    eyebrow: '03 / GROW AT YOUR OWN PACE',
    title: '経験を積み重ねて、\n自分の投資スタイルへ。',
    description: '保有株と資産の変化をポートフォリオで確認。気になる銘柄を保存して、取引履歴から自分の判断を振り返りましょう。',
    points: ['保有株・損益をまとめて確認', 'ウォッチリストで銘柄を保存', '会員登録で口座を保存'],
    visual: 'portfolio',
  },
];

function visualMarkup(type) {
  if (type === 'market') return `<div class="mango-intro-quote"><div class="mango-intro-mini-heading"><span>MARKET EXPLORER</span><span class="mango-intro-live">日本株・米国株</span></div><div class="mango-intro-symbols"><span>NVDA</span><span>AAPL</span><span>285A</span><span>7974</span></div><div class="mango-intro-chart-label">値動きの見方を、あなた好みに。</div><svg class="mango-intro-chart" viewBox="0 0 340 166" aria-hidden="true"><path class="mango-intro-grid" d="M0 30h340M0 76h340M0 122h340"/><path class="mango-intro-area" d="M0 143 25 127 48 133 75 97 99 108 125 86 151 95 176 56 200 70 224 34 250 45 273 23 302 36 340 8V166H0Z"/><path class="mango-intro-line" d="m0 143 25-16 23 6 27-36 24 11 26-22 26 9 25-39 24 14 24-36 26 11 23-22 29 13 38-28"/></svg><div class="mango-intro-chart-types"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 17 6-6 4 3 8-9"/></svg>折れ線</span><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v18m10-18v18"/><path d="M4 7h6v8H4zm10 2h6v8h-6z"/></svg>ローソク足</span></div><p class="mango-intro-art-caption">チャート表示のイメージ</p></div>`;
  if (type === 'trade') return `<div class="mango-intro-wallet"><div class="mango-intro-mini-heading"><span>YOUR PRACTICE ACCOUNT</span><span class="mango-intro-leaf">✦</span></div><div class="mango-intro-balance"><span>日本株の仮想資金</span><strong><small>¥</small>10,000,000</strong><span class="mango-intro-currency">JPY</span></div><div class="mango-intro-balance mango-intro-dollar"><span>米国株の仮想資金</span><strong><small>$</small>10,000</strong><span class="mango-intro-currency">USD</span></div><div class="mango-intro-order"><span class="mango-intro-order-icon">${check}</span><div><strong>1株から、経験に。</strong><span>銘柄を選ぶ → 株数を入力 → 注文確認</span></div></div></div>`;
  if (type === 'portfolio') return `<div class="mango-intro-portfolio"><div class="mango-intro-mini-heading"><span>YOUR INVESTING JOURNEY</span><span class="mango-intro-leaf">✦</span></div><div class="mango-intro-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="mango-intro-portfolio-row"><span class="mango-intro-portfolio-icon">${check}</span><div><strong>ポートフォリオ</strong><small>あなたの投資の現在地</small></div></div><div class="mango-intro-portfolio-row"><span class="mango-intro-portfolio-icon">${cloud}</span><div><strong>あなた専用の口座</strong><small>ログインして、続きから</small></div></div></div>`;
  return `<div class="mango-intro-welcome-art"><div class="mango-intro-orbit mango-intro-orbit-one"></div><div class="mango-intro-orbit mango-intro-orbit-two"></div><div class="mango-intro-floating-tag mango-intro-tag-jp">日本株 <span>JAPAN</span></div><div class="mango-intro-mango">${mango}</div><div class="mango-intro-floating-tag mango-intro-tag-us">米国株 <span>UNITED STATES</span></div><div class="mango-intro-art-brand">MANGO<span> Sec.</span><small>INVESTING, YOUR WAY.</small></div><p class="mango-intro-art-message">小さな一歩から、投資を。</p></div>`;
}

let instanceCount = 0;

/**
 * Auth handlers receive {method, onCancel, onComplete}. They may call these
 * callbacks after their own dialog closes, or return true (success) / false
 * (cancel). Opening auth does not mark onboarding complete.
 */
export function createOnboarding({ onRegister, onLogin, onFinish, mount } = {}) {
  const doc = mount?.ownerDocument || globalThis.document;
  if (!doc) return { open: () => false, complete() {}, destroy() {} };
  const target = typeof mount === 'string' ? doc.querySelector(mount) : mount || doc.body;
  if (!target) throw new Error('Onboarding mount was not found.');
  const view = doc.defaultView;
  const id = `mango-intro-${++instanceCount}`;
  const dialog = doc.createElement('dialog');
  dialog.className = 'mango-onboarding';
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-description`);
  dialog.setAttribute('aria-modal', 'true');
  target.append(dialog);
  let state = createTutorialState();
  let destroyed = false;
  let previousFocus = null;
  let authAttempt = 0;
  let errorMessage = '';
  let completed = false;
  let finishNotified = false;
  try { completed = view.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'complete'; } catch { /* The tutorial remains usable without storage. */ }

  function closeDialog({ restoreFocus = true } = {}) {
    if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    doc.documentElement.classList.remove('mango-onboarding-open');
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  function complete(reason = 'complete') {
    if (destroyed) return;
    completed = true;
    state = transitionTutorial(state, 'complete');
    try { view.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'complete'); } catch { /* Remember completion for this visit even if storage is unavailable. */ }
    closeDialog();
    if (!finishNotified) {
      finishNotified = true;
      onFinish?.({ reason: typeof reason === 'string' ? reason : reason?.reason || 'complete', completed: true });
    }
  }

  function render({ focus = false } = {}) {
    const account = state.step === ACCOUNT_STEP;
    const page = pages[state.step] || pages[0];
    const title = account ? 'さあ、あなたの口座を\nはじめよう。' : page.title;
    const description = account ? 'Google またはメールアドレスで会員登録。あなた専用の口座で、投資の練習を続けましょう。' : page.description;
    dialog.innerHTML = `<div class="mango-intro-shell"><header class="mango-intro-header"><div class="mango-intro-brand">${mango}<span>MANGO <b>Sec.</b></span></div><button type="button" class="mango-intro-skip" data-intro-action="skip">あとで見る<span aria-hidden="true"> ↗</span></button></header><div class="mango-intro-layout"><div class="mango-intro-visual" aria-hidden="true">${visualMarkup(account ? 'welcome' : page.visual)}<div class="mango-intro-visual-foot"><span>LEARN. PRACTICE. GROW.</span><span>✦</span></div></div><section class="mango-intro-content"><div class="mango-intro-copy"><p class="mango-intro-eyebrow">${account ? 'YOUR NEXT CHAPTER STARTS HERE' : page.eyebrow}</p><h2 id="${id}-title" class="mango-intro-title" tabindex="-1">${title.replace('\n', '<br>')}</h2><p id="${id}-description" class="mango-intro-description">${description}</p>${account ? `<div class="mango-intro-account-actions"><button type="button" class="mango-intro-auth mango-intro-google" data-intro-action="google">${google}<span>Google で会員登録</span></button><button type="button" class="mango-intro-auth mango-intro-email" data-intro-action="email">${email}<span>メールアドレスで会員登録</span>${arrow}</button><p class="mango-intro-login">すでにアカウントをお持ちの方<button type="button" data-intro-action="login">ログイン</button></p></div><p class="mango-intro-account-note">${cloud}<span>口座・保有株・取引履歴を、あなたのアカウントに保存します。</span></p><p class="mango-intro-error" role="alert" ${errorMessage ? '' : 'hidden'}>${errorMessage}</p>` : `<ul class="mango-intro-points">${page.points.map(point => `<li><span>${check}</span>${point}</li>`).join('')}</ul>${page.note ? `<p class="mango-intro-note">${page.note}</p>` : ''}`}</div><footer class="mango-intro-footer">${account ? `<button type="button" class="mango-intro-back" data-intro-action="back"><span aria-hidden="true">←</span> 案内に戻る</button><button type="button" class="mango-intro-guest" data-intro-action="guest">今は登録せずに見る ${arrow}</button>` : `<div class="mango-intro-progress" aria-label="チュートリアルの進行状況">${pages.map((_, index) => `<button type="button" class="mango-intro-dot ${index === state.step ? 'is-current' : ''}" data-intro-step="${index}" aria-label="案内の${index + 1}ページ目へ" ${index === state.step ? 'aria-current="step"' : ''}></button>`).join('')}<span>${state.step + 1} / ${TUTORIAL_PAGE_COUNT}</span></div><div class="mango-intro-navigation"><button type="button" class="mango-intro-back" data-intro-action="back" ${state.step === 0 ? 'disabled' : ''}><span aria-hidden="true">←</span> 前に戻る</button><button type="button" class="mango-intro-next" data-intro-action="next">${state.step === TUTORIAL_PAGE_COUNT - 1 ? '会員登録へ' : '次へ'} ${arrow}</button></div>`}</footer><p class="mango-intro-screen-reader" aria-live="polite">${account ? '会員登録・ログイン' : `チュートリアル ${state.step + 1} / ${TUTORIAL_PAGE_COUNT}`}</p></section></div></div>`;
    if (focus && dialog.open) dialog.querySelector('h2').focus({ preventScroll: true });
  }

  function open({ force = false, startAt = 0 } = {}) {
    if (destroyed || (completed && !force)) return false;
    if (!dialog.open) previousFocus = doc.activeElement;
    state = transitionTutorial(state, { type: 'open', startAt });
    errorMessage = '';
    render();
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); }
    }
    doc.documentElement.classList.add('mango-onboarding-open');
    dialog.querySelector('h2').focus({ preventScroll: true });
    return true;
  }

  async function beginAuth(kind, method) {
    const callback = kind === 'login' ? onLogin : onRegister;
    if (typeof callback !== 'function') {
      errorMessage = 'アカウント画面を開けませんでした。もう一度お試しください。';
      render({ focus: true });
      return;
    }
    const attempt = ++authAttempt;
    let authFinished = false;
    closeDialog({ restoreFocus: false });
    const resume = () => {
      if (!destroyed && !authFinished && attempt === authAttempt) open({ force: true, startAt: ACCOUNT_STEP });
    };
    const finishAuth = () => {
      if (!destroyed && attempt === authAttempt) {
        authFinished = true;
        complete('registered');
      }
    };
    try {
      const result = await callback({ method, onCancel: resume, onComplete: finishAuth });
      if (result === true) finishAuth();
      else if (result === false) resume();
    } catch {
      if (!destroyed && attempt === authAttempt && !authFinished) {
        resume();
        errorMessage = 'アカウント画面を開けませんでした。もう一度お試しください。';
        render({ focus: true });
      }
    }
  }

  function onClick(event) {
    const button = event.target.closest('button');
    if (!button || !dialog.contains(button)) return;
    if (button.dataset.introStep !== undefined) {
      state = transitionTutorial(state, { type: 'go', step: button.dataset.introStep });
      render({ focus: true });
      return;
    }
    const action = button.dataset.introAction;
    if (action === 'next' || action === 'back') {
      state = transitionTutorial(state, action);
      render({ focus: true });
    } else if (action === 'skip' || action === 'guest') complete(action === 'skip' ? 'skipped' : 'guest');
    else if (action === 'google' || action === 'email') void beginAuth('register', action);
    else if (action === 'login') void beginAuth('login', 'email');
  }

  function onKeydown(event) {
    if (event.key !== 'Tab' || !dialog.open) return;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')].filter(element => !element.hidden);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (doc.activeElement === first || doc.activeElement === dialog.querySelector('h2'))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function onCancel(event) {
    event.preventDefault();
    state = transitionTutorial(state, 'dismiss');
    closeDialog();
  }

  dialog.addEventListener('click', onClick);
  dialog.addEventListener('keydown', onKeydown);
  dialog.addEventListener('cancel', onCancel);
  return {
    open,
    complete,
    get step() { return state.step; },
    get isOpen() { return dialog.open; },
    destroy() {
      if (destroyed) return;
      closeDialog();
      destroyed = true;
      authAttempt += 1;
      dialog.removeEventListener('click', onClick);
      dialog.removeEventListener('keydown', onKeydown);
      dialog.removeEventListener('cancel', onCancel);
      dialog.remove();
    },
  };
}

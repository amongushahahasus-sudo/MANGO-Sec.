const THEME_KEY = 'mango-sec:theme:v1';
const THEME_MODES = new Set(['light', 'dark', 'auto']);
const normaliseMode = mode => THEME_MODES.has(mode) ? mode : 'auto';

/** Automatic mode follows the visitor's local clock: light 07:00–18:59. */
export function resolveTheme(mode = 'auto', date = new Date()) {
  const selected = normaliseMode(mode);
  if (selected !== 'auto') return selected;
  const hour = date instanceof Date && Number.isFinite(date.getTime()) ? date.getHours() : 12;
  return hour >= 7 && hour < 19 ? 'light' : 'dark';
}

/** Set up a device-local preference; no account or market data is stored here. */
export function initTheme({ mount = '#theme-control', clock = () => new Date() } = {}) {
  if (typeof document === 'undefined') return null;
  let mode = 'auto';
  try { mode = normaliseMode(localStorage.getItem(THEME_KEY)); } catch { /* Preference remains usable for this visit. */ }
  const root = document.documentElement;
  const target = typeof mount === 'string' ? document.querySelector(mount) : mount;
  let select;
  let previousMode;
  let previousTheme;
  const apply = () => {
    const theme = resolveTheme(mode, clock());
    root.dataset.theme = theme;
    root.dataset.themeMode = mode;
    root.style.colorScheme = theme;
    const metadata = document.querySelector('meta[name="theme-color"]');
    if (metadata) metadata.content = theme === 'dark' ? '#111820' : '#f7f8fa';
    if (select) select.value = mode;
    if (theme !== previousTheme || mode !== previousMode) {
      previousTheme = theme;
      previousMode = mode;
      window.dispatchEvent(new CustomEvent('mango:themechange', { detail: { mode, theme } }));
    }
    return theme;
  };
  // Apply before constructing the control so the first render uses the selected palette.
  apply();
  if (target) {
    target.classList.add('theme-control');
    const label = document.createElement('label');
    label.className = 'theme-picker';
    label.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><span class="theme-visually-hidden">表示テーマ</span>';
    select = document.createElement('select');
    select.id = 'mango-theme';
    select.setAttribute('aria-label', '表示テーマ');
    select.title = '時間帯で自動：端末の時刻で7:00〜18:59はライト、19:00〜6:59はダーク';
    for (const [value, text] of [['light', 'ライト'], ['dark', 'ダーク'], ['auto', '時間帯で自動']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    select.value = mode;
    label.append(select);
    target.replaceChildren(label);
    select.addEventListener('change', () => {
      mode = normaliseMode(select.value);
      try { localStorage.setItem(THEME_KEY, mode); } catch { /* Applying the preference does not require browser storage. */ }
      apply();
    });
  }
  const refresh = () => { if (mode === 'auto') apply(); };
  const onStorage = event => {
    if (event.key === THEME_KEY) { mode = normaliseMode(event.newValue); apply(); }
  };
  const interval = window.setInterval(refresh, 60_000);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('storage', onStorage);
  return {
    get mode() { return mode; },
    get theme() { return root.dataset.theme; },
    refresh,
    destroy() {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', onStorage);
    },
  };
}

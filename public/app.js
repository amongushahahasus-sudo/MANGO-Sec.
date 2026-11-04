import { createAccount, executeTrade, calculatePortfolio, validateAccount } from './trading.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const STORAGE_KEY = 'mango-sec:account:v1';
const WATCH_KEY = 'mango-sec:watchlist:v1';
const catalog = [
  {symbol:'285A.T',name:'キオクシア',currency:'JPY',market:'JP',code:'285A',googleFinanceUrl:'https://www.google.com/finance/quote/285A:TYO',color:'#7f65a9',mark:'K'},
  {symbol:'9020.T',name:'JR東日本',currency:'JPY',market:'JP',code:'9020',googleFinanceUrl:'https://www.google.com/finance/quote/9020:TYO',color:'#2e8b62',mark:'JR'},
  {symbol:'7974.T',name:'任天堂',currency:'JPY',market:'JP',code:'7974',googleFinanceUrl:'https://www.google.com/finance/quote/7974:TYO',color:'#d75252',mark:'N'},
  {symbol:'NVDA',name:'NVIDIA',currency:'USD',market:'US',code:'NVDA',googleFinanceUrl:'https://www.google.com/finance/quote/NVDA:NASDAQ',color:'#70a533',mark:'N'},
  {symbol:'QCOM',name:'Qualcomm',currency:'USD',market:'US',code:'QCOM',googleFinanceUrl:'https://www.google.com/finance/quote/QCOM:NASDAQ',color:'#4b79c9',mark:'Q'},
  {symbol:'AAPL',name:'Apple',currency:'USD',market:'US',code:'AAPL',googleFinanceUrl:'https://www.google.com/finance/quote/AAPL:NASDAQ',color:'#647080',mark:'A'},
  {symbol:'MSFT',name:'Microsoft',currency:'USD',market:'US',code:'MSFT',googleFinanceUrl:'https://www.google.com/finance/quote/MSFT:NASDAQ',color:'#5b8fbc',mark:'M'},
];
const state = {stocks:catalog, market:'JP', view:'market', selected:'285A.T', range:'1mo', side:'buy', orderPreparing:false, orderGeneration:0, quotes:{}, data:null, loading:false, error:null, watched:new Set(), detailRequest:0, pending:null, toastTimer:null};
let account=createAccount();
let accountRecoveryRequired=false;
let storageIssue=null;
function showStorageIssue(kind) {
  storageIssue=kind;
  const banner=$('#storage-error');
  banner.hidden=false;
  if(kind==='corrupt') banner.innerHTML='保存された口座データを読み込めませんでした。元の保存内容は変更せず、初期口座を表示しています。取引を始めるには口座をリセットしてください。 <button class="btn btn-ghost" data-reset-account>口座をリセット</button>';
  else banner.textContent='ブラウザーへの保存が利用できません。取引内容はこの画面を閉じると失われる場合があります。';
}
let savedAccount=null;
try { savedAccount=localStorage.getItem(STORAGE_KEY); }
catch { showStorageIssue('unavailable'); }
if(savedAccount) {
  try {
    const parsed=JSON.parse(savedAccount);
    if(!validateAccount(parsed))throw new Error('invalid account');
    account=parsed;
  } catch { accountRecoveryRequired=true;showStorageIssue('corrupt'); }
}
try {
  const watched=JSON.parse(localStorage.getItem(WATCH_KEY)||'[]');
  if(Array.isArray(watched))state.watched=new Set(watched.filter((item)=>typeof item==='string'));
} catch { /* A damaged watchlist does not replace a valid trading account. */ }

const iconStar = (filled = false) => `<svg viewBox="0 0 24 24" ${filled ? 'class="star-filled"' : ''} aria-hidden="true"><path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L2.8 9.7l6.4-.9Z"/></svg>`;
const currencyFormat = (value, currency = 'JPY', compact = false) => {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ja-JP', {style:'currency',currency,minimumFractionDigits:currency === 'JPY' ? 0 : 2,maximumFractionDigits:currency === 'JPY' ? 2 : 2, ...(compact ? {notation:'compact',maximumFractionDigits:1} : {})}).format(value);
};
const formatNumber = (value, digits = 0) => Number.isFinite(value) ? new Intl.NumberFormat('ja-JP',{maximumFractionDigits:digits}).format(value) : '—';
const parseTime = (value) => typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
const formatTime = (value, includeDate = true) => {
  const date = parseTime(value);
  return Number.isNaN(date.getTime()) ? '時刻不明' : new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',...(includeDate ? {month:'2-digit',day:'2-digit'} : {}),hour:'2-digit',minute:'2-digit',hour12:false}).format(date) + ' JST';
};
const changeClass = (value) => value > 0 ? 'positive' : value < 0 ? 'negative' : 'muted';
const changeLabel = (value) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '—';
const selectedStock = () => state.stocks.find((stock) => stock.symbol === state.selected) || catalog[0];
const stockCode = (stock) => stock.code || stock.symbol.replace('.T','');
const heldQuantity = (symbol = state.selected) => account.positions.find((position) => position.symbol === symbol)?.quantity || 0;
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => $('#toast').hidden = true, 4200);
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify(account));storageIssue=null;$('#storage-error').hidden=true;return true; }
  catch { showStorageIssue('unavailable');return false; }
}
function saveWatchlist() {
  try { localStorage.setItem(WATCH_KEY,JSON.stringify([...state.watched])); }
  catch { notify('ウォッチリストをブラウザーに保存できませんでした。'); }
}
async function fetchMarket(symbol, range = '1mo') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),18000);
  try {
    const response = await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`,{signal:controller.signal,cache:'no-store'});
    let data;
    try { data = await response.json(); } catch { throw new Error('市場データの応答を読み取れませんでした。'); }
    if (!response.ok || data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || '市場データを取得できませんでした。');
    if (!data.quote || !Number.isFinite(data.quote.price) || data.quote.price <= 0) throw new Error('有効な市場価格がありません。時間をおいて再試行してください。');
    state.quotes[symbol] = data;
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('データ取得に時間がかかっています。再取得をお試しください。');
    throw error;
  } finally { clearTimeout(timer); }
}
function logo(stock, size = '') {
  const fallback = catalog.find((entry) => entry.symbol === stock.symbol) || {color:'#63758b',mark:stock.symbol.slice(0,1)};
  return `<span class="stock-logo ${size}" style="--stock-color:${fallback.color}" aria-hidden="true">${fallback.mark}</span>`;
}
function visibleStocks() {
  const search = $('#stock-search').value.trim().toLowerCase();
  return state.stocks.filter((stock) => (stock.market === state.market || (state.market === 'JP' && stock.currency === 'JPY') || (state.market === 'US' && stock.currency === 'USD')) && (state.view !== 'watchlist' || state.watched.has(stock.symbol)) && (!search || `${stock.name} ${stock.shortName || ''} ${stock.fullName || ''} ${stock.symbol} ${stockCode(stock)} ${stock.englishName || ''}`.toLowerCase().includes(search)));
}
function renderList() {
  const list = visibleStocks();
  $('#stock-list').innerHTML = list.length ? list.map((stock) => {
    const quote = state.quotes[stock.symbol]?.quote;
    return `<div class="stock-row ${stock.symbol === state.selected ? 'selected' : ''}"><button class="stock-select" data-symbol="${escapeHtml(stock.symbol)}" ${stock.symbol === state.selected ? 'aria-current="true"' : ''}>${logo(stock)}<span class="stock-row-identity"><strong class="stock-name">${escapeHtml(stock.name)}</strong><span class="stock-symbol">${escapeHtml(stockCode(stock))} <span>· ${stock.currency === 'JPY' ? '東証' : 'NASDAQ'}</span></span></span><span class="stock-row-values"><strong class="stock-price">${currencyFormat(quote?.price,stock.currency)}</strong><span class="stock-change ${changeClass(quote?.changePercent)}">${changeLabel(quote?.changePercent)}</span></span></button><button class="watch-button ${state.watched.has(stock.symbol) ? 'watching' : ''}" data-watch="${escapeHtml(stock.symbol)}" aria-label="${escapeHtml(stock.name)}をウォッチリスト${state.watched.has(stock.symbol) ? 'から削除' : 'に追加'}" aria-pressed="${state.watched.has(stock.symbol)}">${iconStar(state.watched.has(stock.symbol))}</button></div>`;
  }).join('') : `<div class="empty-state compact"><span class="empty-icon">⌕</span><strong>${state.view === 'watchlist' ? 'まだ銘柄がありません' : '銘柄が見つかりません'}</strong><p>${state.view === 'watchlist' ? 'マーケットの☆から追加できます。' : '銘柄名やコードを変えてみてください。'}</p></div>`;
}
function rangeButtons() {
  return [['1d','1日'],['5d','1週'],['1mo','1か月'],['3mo','3か月'],['1y','1年']].map(([range,label])=>`<button class="range-button ${range === state.range ? 'active' : ''}" data-range="${range}" aria-pressed="${range === state.range}">${label}</button>`).join('');
}
function renderDetail() {
  const stock = selectedStock();
  const data = state.data;
  const quote = data?.quote;
  const link = stock.googleFinanceUrl || `https://www.google.com/finance/quote/${encodeURIComponent(stockCode(stock))}:${stock.currency === 'JPY' ? 'TYO' : 'NASDAQ'}`;
  $('#stock-detail').innerHTML = `<div class="quote-header"><div class="quote-identity">${logo(stock,'large')}<div><div class="quote-name-row"><h2>${escapeHtml(stock.name)}</h2><button class="watch-button ${state.watched.has(stock.symbol) ? 'watching' : ''}" data-watch="${escapeHtml(stock.symbol)}" aria-label="ウォッチリスト${state.watched.has(stock.symbol) ? 'から削除' : 'に追加'}" aria-pressed="${state.watched.has(stock.symbol)}">${iconStar(state.watched.has(stock.symbol))}</button></div><p>${escapeHtml(stockCode(stock))}<span>·</span>${stock.currency === 'JPY' ? '東京証券取引所' : 'NASDAQ'}<span>·</span>${escapeHtml(stock.currency)}</p></div></div><div class="quote-price">${currencyFormat(quote?.price,stock.currency)}</div><div class="quote-change ${changeClass(quote?.changePercent)}">${Number.isFinite(quote?.change) ? `${quote.change > 0 ? '+' : ''}${currencyFormat(quote.change,stock.currency)}` : '—'} <span>(${changeLabel(quote?.changePercent)})</span><span class="quote-change-note">前日比</span></div></div><div class="chart-toolbar"><span class="chart-label">株価チャート</span><div class="range-tabs" role="group" aria-label="チャートの期間">${rangeButtons()}</div></div><div class="chart-container" id="chart-container">${state.loading ? '<div class="chart-empty"><span class="loading-spinner"></span><p>市場データを取得しています</p></div>' : state.error ? `<div class="chart-empty error-state"><span class="empty-icon">↻</span><strong>データを取得できませんでした</strong><p>${escapeHtml(state.error)}</p><button class="btn btn-secondary" id="retry-data">再取得する</button><a class="link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Google Financeで確認 ↗</a></div>` : '<div id="chart-svg"></div><div class="chart-tooltip" id="chart-tooltip" hidden></div>'}</div><div class="chart-footer"><span><i class="legend-dot"></i>${data ? escapeHtml(data.source || 'Yahoo Finance') : 'Yahoo Finance'}${quote ? ` · 価格時刻 ${escapeHtml(formatTime(quote.asOf))}` : ''}</span><a class="link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Google Finance ↗</a></div>${quote ? `<div class="quote-stats"><div class="quote-stat"><span>前日終値</span><strong>${currencyFormat(quote.previousClose,stock.currency)}</strong></div><div class="quote-stat"><span>始値</span><strong>${currencyFormat(quote.open,stock.currency)}</strong></div><div class="quote-stat"><span>日中高値</span><strong>${currencyFormat(quote.dayHigh ?? quote.high,stock.currency)}</strong></div><div class="quote-stat"><span>日中安値</span><strong>${currencyFormat(quote.dayLow ?? quote.low,stock.currency)}</strong></div></div><p class="fetched-at">取得 ${escapeHtml(formatTime(data.fetchedAt))}${data.delayNotice ? ` · ${escapeHtml(data.delayNotice)}` : ''}</p>` : ''}`;
  if (!state.loading && !state.error && data) renderChart(data.history || [],stock.currency);
}
function renderChart(history,currency) {
  const chartRoot = $('#chart-svg');
  if (!chartRoot) return;
  const points = history.filter((point) => Number.isFinite(point.time) && Number.isFinite(point.close) && point.close > 0).sort((a,b)=>a.time-b.time);
  if (points.length < 2) {
    chartRoot.innerHTML = '<div class="chart-empty"><span class="empty-icon">⌁</span><strong>この期間のチャートはありません</strong><p>ほかの期間を選択してください。</p></div>';
    return;
  }
  const width=640,height=255,left=12,right=66,top=18,bottom=33;
  const low=Math.min(...points.map((p)=>p.close)),high=Math.max(...points.map((p)=>p.close));
  const padding=Math.max((high-low)*.18,high*.003);
  const min=low-padding,max=high+padding;
  const first=points[0].time,last=points[points.length-1].time;
  const x=(point)=>left+(point.time-first)/(last-first)*(width-left-right);
  const y=(value)=>top+(max-value)/(max-min)*(height-top-bottom);
  const path=points.map((point,index)=>`${index ? 'L' : 'M'}${x(point).toFixed(2)},${y(point.close).toFixed(2)}`).join(' ');
  const grid=Array.from({length:4},(_,index)=>{const value=max-(max-min)*index/3;return `<line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}" stroke="#edf0f2" stroke-dasharray="3 4"/><text x="${width-right+12}" y="${y(value)+4}" fill="#96a0ac" font-size="11">${formatNumber(value,currency === 'JPY' ? 0 : 2)}</text>`;}).join('');
  const labels=Array.from({length:4},(_,index)=>{const point=points[Math.round((points.length-1)*index/3)];const date=parseTime(point.time);const text=state.range==='1d'?new Intl.DateTimeFormat('ja-JP',{timeZone:currency==='JPY'?'Asia/Tokyo':'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).format(date):new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric'}).format(date);return `<text x="${x(point)}" y="${height-7}" fill="#96a0ac" font-size="11" text-anchor="${index===0?'start':index===3?'end':'middle'}">${text}</text>`;}).join('');
  chartRoot.innerHTML=`<svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(selectedStock().name)}の実際の株価チャート。${points.length}件の価格データ。"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f7a344" stop-opacity=".18"/><stop offset="100%" stop-color="#f7a344" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${path} L${x(points[points.length-1])},${height-bottom} L${left},${height-bottom} Z" fill="url(#chart-fill)"/><path d="${path}" fill="none" stroke="#ee9b39" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${labels}<line id="chart-crosshair" x1="0" x2="0" y1="${top}" y2="${height-bottom}" stroke="#9aa3ae" stroke-dasharray="3 3" visibility="hidden"/><circle id="chart-dot" r="4.5" fill="#ee9b39" stroke="white" stroke-width="2" visibility="hidden"/><rect id="chart-hit" x="${left}" y="${top}" width="${width-left-right}" height="${height-top-bottom}" fill="transparent"/></svg>`;
  const svg=$('.price-chart'),hit=$('#chart-hit'),tooltip=$('#chart-tooltip');
  const move=(event)=>{
    const bounds=svg.getBoundingClientRect();
    const localX=(event.clientX-bounds.left)/bounds.width*width;
    const target=first+Math.max(0,Math.min(1,(localX-left)/(width-left-right)))*(last-first);
    const point=points.reduce((best,item)=>Math.abs(item.time-target)<Math.abs(best.time-target)?item:best,points[0]);
    const position=x(point),vertical=y(point.close);
    $('#chart-crosshair').setAttribute('x1',position);$('#chart-crosshair').setAttribute('x2',position);$('#chart-crosshair').setAttribute('visibility','visible');
    $('#chart-dot').setAttribute('cx',position);$('#chart-dot').setAttribute('cy',vertical);$('#chart-dot').setAttribute('visibility','visible');
    tooltip.innerHTML=`<span>${escapeHtml(formatTime(point.time))}</span><strong>${currencyFormat(point.close,currency)}</strong>`;
    tooltip.style.left=`${Math.min(74,Math.max(4,position/width*100))}%`;tooltip.style.top='2px';tooltip.hidden=false;
  };
  hit.addEventListener('pointermove',move);
  hit.addEventListener('pointerleave',()=>{tooltip.hidden=true;$('#chart-crosshair').setAttribute('visibility','hidden');$('#chart-dot').setAttribute('visibility','hidden');});
}
async function loadDetail() {
  const request=++state.detailRequest;
  const symbol=state.selected,range=state.range;
  state.loading=true;state.error=null;state.data=null;renderDetail();renderOrder();
  try {
    const data=await fetchMarket(symbol,range);
    if(request!==state.detailRequest)return;
    state.data=data;
  } catch(error) {
    if(request!==state.detailRequest)return;
    state.error=error.message;
  } finally {
    if(request===state.detailRequest){state.loading=false;renderDetail();renderOrder();renderList();renderAccount();}
  }
}
async function refreshList() {
  const stocks=state.stocks.filter((stock)=>stock.currency===(state.market==='JP'?'JPY':'USD') && stock.symbol !== state.selected);
  await Promise.allSettled(stocks.map(async(stock)=>{try{await fetchMarket(stock.symbol,'1mo');}finally{renderList();}}));
  renderAccount();
}
function renderAccount() {
  $('#balance-jpy').innerHTML=`${currencyFormat(account.cash.JPY,'JPY')}<span>JPY</span>`;
  $('#balance-usd').innerHTML=`${currencyFormat(account.cash.USD,'USD')}<span>USD</span>`;
  $('#holdings-count').innerHTML=`${account.positions.length}<span>銘柄保有</span>`;
  $('#trade-count').textContent=account.transactions.length?`${formatNumber(account.transactions.length)}回の取引を経験しました`:'最初の取引をはじめましょう';
}
function orderQuantity() {return Number($('#quantity').value);}
function renderOrder() {
  const stock=selectedStock(),quote=state.data?.quote;
  const quantity=orderQuantity(),validQuantity=Number.isInteger(quantity)&&quantity>0&&quantity<=1000000;
  $('#order-stock').innerHTML=`${logo(stock)}<span><strong>${escapeHtml(stock.name)}</strong><small>${escapeHtml(stockCode(stock))} · ${escapeHtml(stock.currency)}</small></span>`;
  $('#order-price').textContent=currencyFormat(quote?.price,stock.currency);
  $('#order-held').textContent=`${formatNumber(heldQuantity())} 株`;
  $('#order-total').textContent=currencyFormat(validQuantity&&quote?quantity*quote.price:NaN,stock.currency);
  $('#available-label').textContent=state.side==='buy'?'買付余力':'売却可能数量';
  $('#order-available').textContent=state.side==='buy'?currencyFormat(account.cash[stock.currency],stock.currency):`${formatNumber(heldQuantity())} 株`;
  let problem='';
  if(!validQuantity)problem='数量は1〜1,000,000の整数で入力してください。';
  else if(quote && state.side==='buy' && quantity*quote.price>account.cash[stock.currency]+.00001)problem='買付余力が不足しています。';
  else if(state.side==='sell'&&quantity>heldQuantity())problem='保有数量を超えて売却できません。';
  $('#order-feedback').textContent=problem;
  $('#order-submit').disabled=Boolean(problem)||!quote||state.loading||state.orderPreparing||accountRecoveryRequired||Boolean(state.pending);
  $$('.order-tabs button').forEach((button)=>button.classList.toggle('active',button.dataset.side===state.side));
}
function setView(view) {
  state.view=view;
  const info={market:['マーケット','市場を知る。投資を試す。自分のペースで。'],portfolio:['ポートフォリオ','小さな一歩が、あなたの資産になっていく。'],watchlist:['ウォッチリスト','気になる銘柄の動きを、いつでもそばに。'],history:['取引履歴','振り返るたび、投資が少しずつわかる。']}[view]||['マーケット',''];
  $('#page-title').textContent=info[0];$('#breadcrumb-current').textContent=info[0];$('#page-subtitle').textContent=info[1];
  $$('.nav-item[data-view]').forEach((item)=>{item.classList.toggle('active',item.dataset.view===view);item.setAttribute('aria-current',item.dataset.view===view?'page':'false');});
  $('#market-view').hidden=!['market','watchlist'].includes(view);$('#portfolio-view').hidden=view!=='portfolio';$('#history-view').hidden=view!=='history';
  $('#market-panel-title').textContent=view==='watchlist'?'ウォッチ中の銘柄':'銘柄を探す';
  if(view==='portfolio'){renderPortfolio();refreshPortfolio();}else if(view==='history')renderHistory();else renderList();
  const nextHash=`#${view}`;if(location.hash!==nextHash)history.replaceState(null,'',nextHash);
}
function renderPortfolio() {
  const portfolio=calculatePortfolio(account,state.quotes);
  const stats=['JPY','USD'].map((currency)=>{
    const row=portfolio.currencies[currency];
    return `<div class="portfolio-currency-card"><div class="account-label">${currency==='JPY'?'日本株・円口座':'米国株・ドル口座'}</div><strong class="portfolio-equity">${currencyFormat(row.equity,currency)}</strong><div class="summary-row"><span>保有株の評価額</span><strong>${currencyFormat(row.marketValue,currency)}</strong></div><div class="summary-row"><span>評価損益</span><strong class="${changeClass(row.unrealizedPnL)}">${currencyFormat(row.unrealizedPnL,currency)}</strong></div><div class="summary-row"><span>実現損益</span><strong class="${changeClass(row.realizedPnL)}">${currencyFormat(row.realizedPnL,currency)}</strong></div>${!row.complete?'<p class="fetched-at">一部銘柄の価格を取得できていません。</p>':''}</div>`;
  }).join('');
  const rows=portfolio.positions.length?`<div class="table-wrap"><table class="holdings-table"><thead><tr><th>銘柄</th><th>保有数量</th><th>平均取得単価</th><th>現在値</th><th>評価額</th><th>評価損益</th><th></th></tr></thead><tbody>${portfolio.positions.map((position)=>`<tr><td><strong>${escapeHtml(position.name)}</strong><small>${escapeHtml(position.symbol)}</small></td><td>${formatNumber(position.quantity)} 株</td><td>${currencyFormat(position.averageCost,position.currency)}</td><td>${currencyFormat(position.price,position.currency)}${position.priceAsOf?`<small>${escapeHtml(formatTime(position.priceAsOf))}</small>`:''}</td><td>${currencyFormat(position.marketValue,position.currency)}</td><td class="${changeClass(position.unrealizedPnL)}">${currencyFormat(position.unrealizedPnL,position.currency)}<small>${changeLabel(position.unrealizedPercent)}</small></td><td><button class="btn btn-ghost" data-open-stock="${escapeHtml(position.symbol)}">取引 →</button></td></tr>`).join('')}</tbody></table></div><p class="portfolio-note">評価額は取得済みの市場価格を使用します。円と米ドルはそれぞれの通貨で計算します。</p>`:'<div class="empty-state"><span class="empty-icon">↗</span><h3>あなたのポートフォリオを育てよう。</h3><p>まだ保有している株式はありません。<br>気になる企業を見つけて、最初の1株を体験してみましょう。</p><button class="btn btn-primary" data-go-market>銘柄を探す →</button></div>';
  $('#portfolio-content').innerHTML=`<div class="portfolio-summary">${stats}</div>${rows}`;
}
async function refreshPortfolio() {
  const button=$('#refresh-portfolio');button.disabled=true;button.textContent='更新中…';
  const results=await Promise.allSettled(account.positions.map((position)=>fetchMarket(position.symbol,'1mo')));
  renderPortfolio();button.disabled=false;button.textContent='評価額を更新';
  if(results.some((result)=>result.status==='rejected'))notify('一部の評価価格を取得できませんでした。再度更新できます。');
}
function renderHistory() {
  $('#history-total').textContent=`${formatNumber(account.transactions.length)} 件`;
  $('#history-content').innerHTML=account.transactions.length?`<div class="table-wrap"><table class="holdings-table"><thead><tr><th>約定日時（日本時間）</th><th>区分</th><th>銘柄</th><th>数量</th><th>約定単価</th><th>約定代金</th><th>実現損益</th></tr></thead><tbody>${account.transactions.map((trade)=>`<tr><td>${escapeHtml(formatTime(trade.executionAt))}<small>価格 ${escapeHtml(formatTime(trade.priceAsOf))}</small></td><td><span class="trade-badge ${trade.side==='buy'?'buy':'sell'}">${trade.side==='buy'?'買付':'売却'}</span></td><td><strong>${escapeHtml(trade.name)}</strong><small>${escapeHtml(trade.symbol)} · ${escapeHtml(trade.source)}</small></td><td>${formatNumber(trade.quantity)} 株</td><td>${currencyFormat(trade.price,trade.currency)}</td><td>${currencyFormat(trade.total,trade.currency)}</td><td class="${changeClass(trade.realizedPnL)}">${trade.side==='sell'?currencyFormat(trade.realizedPnL,trade.currency):'—'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><span class="empty-icon">◷</span><h3>ここから、あなたの投資の記録がはじまる。</h3><p>仮想取引の履歴がここに表示されます。<br>実際の市場価格で、売買の流れを試してみましょう。</p><button class="btn btn-primary" data-go-market>最初の取引をはじめる →</button></div>';
}
function openStock(symbol) {
  const stock=state.stocks.find((entry)=>entry.symbol===symbol);if(!stock)return;
  state.selected=symbol;state.market=stock.currency==='JPY'?'JP':'US';
  $$('.segment').forEach((button)=>button.classList.toggle('active',button.dataset.market===state.market));
  $('#quantity').value='1';setView('market');renderList();loadDetail();
}
async function prepareOrder(event) {
  event.preventDefault();if($('#order-submit').disabled||state.orderPreparing)return;
  state.orderPreparing=true;
  const quantity=orderQuantity(),stock=selectedStock(),side=state.side,range=state.range,detailGeneration=state.detailRequest,orderGeneration=++state.orderGeneration;
  $('#order-submit').disabled=true;$('#order-submit').textContent='最新の価格を確認中…';$('#order-feedback').textContent='';
  try {
    const data=await fetchMarket(stock.symbol,range);
    if(orderGeneration!==state.orderGeneration)return;
    if(state.selected!==stock.symbol||state.side!==side||state.range!==range||state.detailRequest!==detailGeneration)throw new Error('銘柄または売買区分が変わりました。再度確認してください。');
    state.data=data;renderDetail();renderList();
    const order={stock,side,quantity,quote:data.quote,fetchedAt:data.fetchedAt,source:data.source};
    const preview=executeTrade(account,order);
    const settledTotal=preview.transactions[0].total;
    state.pending={kind:'trade',order,preparedAt:Date.now()};
    $('#dialog-title').textContent=side==='buy'?'買付注文の確認':'売却注文の確認';
    $('#dialog-description').textContent=`${stock.name}を${formatNumber(quantity)}株${side==='buy'?'購入':'売却'}します。`;
    $('#dialog-summary').innerHTML=`<div class="summary-row"><span>銘柄</span><strong>${escapeHtml(stock.name)} (${escapeHtml(stockCode(stock))})</strong></div><div class="summary-row"><span>数量</span><strong>${formatNumber(quantity)} 株</strong></div><div class="summary-row"><span>仮想約定単価</span><strong>${currencyFormat(data.quote.price,stock.currency)}</strong></div><div class="summary-row"><span>価格時刻</span><strong>${escapeHtml(formatTime(data.quote.asOf))}</strong></div><div class="summary-row"><span>データ取得元</span><strong>${escapeHtml(data.source)}</strong></div><div class="summary-row total"><span>約定代金</span><strong>${currencyFormat(settledTotal,stock.currency)}</strong></div>`;
    $('#dialog-disclaimer').textContent='表示された市場価格で仮想約定します。市場データには遅延があり、実注文は送信されません。';
    $('#dialog-confirm').textContent='仮想注文を確定';$('#dialog-confirm').disabled=false;
    $('#confirm-dialog').showModal();
  } catch(error) {$('#order-feedback').textContent=error.message;notify(error.message);}
  finally {state.orderPreparing=false;$('#order-submit').innerHTML='注文内容を確認 <span>→</span>';renderOrder();}
}
function confirmAction() {
  const pending=state.pending;if(!pending)return;
  $('#dialog-confirm').disabled=true;
  try {
    if(pending.kind==='reset'){
      account=createAccount();accountRecoveryRequired=false;persist();renderAccount();renderOrder();renderPortfolio();renderHistory();notify('仮想口座をリセットしました。');
    } else {
      if(Date.now()-pending.preparedAt>5*60*1000)throw new Error('確認から時間が経過しました。注文内容を再確認してください。');
      account=executeTrade(account,pending.order);persist();renderAccount();renderOrder();renderPortfolio();renderHistory();
      notify(`${pending.order.stock.name}を${formatNumber(pending.order.quantity)}株、仮想${pending.order.side==='buy'?'購入':'売却'}しました。`);
    }
    $('#confirm-dialog').close();state.pending=null;
  } catch(error){notify(error.message);$('#confirm-dialog').close();state.pending=null;}
  finally {renderOrder();}
}
function resetDialog() {
  state.orderGeneration++;
  state.pending={kind:'reset'};
  $('#dialog-title').textContent='仮想口座をリセット';$('#dialog-description').textContent='買付余力・保有銘柄・取引履歴を初期状態に戻します。';
  $('#dialog-summary').innerHTML='<div class="summary-row"><span>日本円の初期資金</span><strong>¥10,000,000</strong></div><div class="summary-row"><span>米ドルの初期資金</span><strong>$10,000.00</strong></div>';
  $('#dialog-disclaimer').textContent='現在の保有銘柄と取引履歴は削除されます。この操作は取り消せません。ウォッチリストは保持されます。';
  $('#dialog-confirm').textContent='リセットする';$('#dialog-confirm').disabled=false;$('#confirm-dialog').showModal();
}

document.addEventListener('click',(event)=>{
  const nav=event.target.closest('[data-view]');if(nav){setView(nav.dataset.view);return;}
  const market=event.target.closest('[data-market]');if(market){state.market=market.dataset.market;$$('.segment').forEach((button)=>button.classList.toggle('active',button===market));const list=visibleStocks();if(list.length&&!list.some((stock)=>stock.symbol===state.selected)){state.selected=list[0].symbol;$('#quantity').value='1';loadDetail();}renderList();refreshList();return;}
  const watch=event.target.closest('[data-watch]');if(watch){const symbol=watch.dataset.watch;if(state.watched.has(symbol))state.watched.delete(symbol);else state.watched.add(symbol);saveWatchlist();renderList();renderDetail();return;}
  const select=event.target.closest('[data-symbol]');if(select){if(select.dataset.symbol!==state.selected){state.selected=select.dataset.symbol;$('#quantity').value='1';renderList();loadDetail();}return;}
  const range=event.target.closest('[data-range]');if(range){if(range.dataset.range!==state.range){state.range=range.dataset.range;loadDetail();}return;}
  const side=event.target.closest('[data-side]');if(side){state.side=side.dataset.side;renderOrder();return;}
  const qty=event.target.closest('[data-qty]');if(qty){$('#quantity').value=qty.dataset.qty;renderOrder();return;}
  const open=event.target.closest('[data-open-stock]');if(open){openStock(open.dataset.openStock);return;}
  if(event.target.closest('[data-go-market]')){setView('market');return;}
  if(event.target.closest('[data-reset-account]')){resetDialog();return;}
  if(event.target.closest('#retry-data'))loadDetail();
});
$('#stock-search').addEventListener('input',renderList);
$('#quantity').addEventListener('input',renderOrder);
$('#quantity-minus').addEventListener('click',()=>{$('#quantity').value=String(Math.max(1,(orderQuantity()||1)-1));renderOrder();});
$('#quantity-plus').addEventListener('click',()=>{$('#quantity').value=String(Math.min(1000000,(orderQuantity()||0)+1));renderOrder();});
$('#quantity-max').addEventListener('click',()=>{const stock=selectedStock(),price=state.data?.quote?.price;const max=state.side==='sell'?heldQuantity():price?Math.floor(account.cash[stock.currency]/price):0;$('#quantity').value=String(Math.min(1000000,Math.max(1,max)));renderOrder();});
$('#order-form').addEventListener('submit',prepareOrder);
$('#refresh-market').addEventListener('click',()=>{if(state.view==='portfolio')refreshPortfolio();else if(state.view==='history')renderHistory();else{loadDetail();refreshList();}});
$('#refresh-portfolio').addEventListener('click',refreshPortfolio);
$('#reset-account').addEventListener('click',resetDialog);
$('#dialog-cancel').addEventListener('click',()=>{$('#confirm-dialog').close();state.pending=null;renderOrder();});
$('#dialog-confirm').addEventListener('click',confirmAction);
$('#confirm-dialog').addEventListener('cancel',()=>{state.pending=null;renderOrder();});
window.addEventListener('storage',(event)=>{
  if(event.key===STORAGE_KEY){try{const updated=JSON.parse(event.newValue||'null');if(validateAccount(updated)){account=updated;accountRecoveryRequired=false;if(storageIssue==='corrupt'){storageIssue=null;$('#storage-error').hidden=true;}state.pending=null;$('#confirm-dialog').close();renderAccount();renderOrder();if(state.view==='portfolio')renderPortfolio();if(state.view==='history')renderHistory();notify('別のタブで口座が更新されました。');}}catch{}}
});
window.addEventListener('hashchange',()=>{const view=location.hash.slice(1);if(['market','portfolio','watchlist','history'].includes(view))setView(view);});
$('#today-date').textContent=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date());
$('#copyright-year').textContent=String(new Date().getFullYear());
renderAccount();renderList();renderOrder();
setView(['market','portfolio','watchlist','history'].includes(location.hash.slice(1))?location.hash.slice(1):'market');
loadDetail();refreshList();
fetch('/api/stocks').then((response)=>response.ok?response.json():null).then((data)=>{const stocks=Array.isArray(data)?data:data?.stocks;if(Array.isArray(stocks)&&stocks.length){state.stocks=stocks.map((stock)=>({...catalog.find((entry)=>entry.symbol===stock.symbol),...stock,fullName:stock.name,name:stock.shortName||stock.name}));renderList();refreshList();}}).catch(()=>{});

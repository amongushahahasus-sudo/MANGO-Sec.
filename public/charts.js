/** Actual market observations only: never derive OHLC from a close-only series. */
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const validTime = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value * 1000 <= 8.64e15;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const priceText = (value, currency) => positive(value) ? new Intl.NumberFormat('ja-JP', {style:'currency', currency, maximumFractionDigits:2}).format(value) : '—';

export function normalizeChartPoints(history, mode = 'line') {
  const observations = new Map();
  if (!Array.isArray(history)) return [];
  for (const item of history) {
    if (!item || !validTime(item.time) || !positive(item.close)) continue;
    if (mode === 'candlestick' && (![item.open,item.high,item.low].every(positive) || item.low > Math.min(item.open,item.close) || item.high < Math.max(item.open,item.close))) continue;
    observations.set(item.time, {
      time:item.time, close:item.close,
      open:positive(item.open) ? item.open : null,
      high:positive(item.high) ? item.high : null,
      low:positive(item.low) ? item.low : null,
      volume:typeof item.volume === 'number' && Number.isFinite(item.volume) && item.volume >= 0 ? item.volume : null,
    });
  }
  return [...observations.values()].sort((a,b) => a.time-b.time);
}

/** Geometry keeps trading observations equally spaced, including over weekends. */
export function buildChartGeometry(history, {mode = 'line', width = 640, height = 270, left = 12, right = 76, top = 22, bottom = 34} = {}) {
  const points = normalizeChartPoints(history,mode);
  const plot = {left,top,right:width-right,bottom:height-bottom,width:width-left-right,height:height-top-bottom};
  if (!points.length) return {points,marks:[],width,height,plot,domain:null};
  const lows = points.map(point => mode === 'candlestick' ? point.low : point.close);
  const highs = points.map(point => mode === 'candlestick' ? point.high : point.close);
  const lowest = Math.min(...lows), highest = Math.max(...highs);
  const padding = Math.max((highest-lowest)*.14,highest*.003,.000001);
  const domain = {min:lowest-padding,max:highest+padding};
  const y = value => plot.top+(domain.max-value)/(domain.max-domain.min)*plot.height;
  const slot = plot.width/points.length;
  const x = index => plot.left+slot*(index+.5);
  const candleWidth = Math.max(.8,Math.min(12,slot*.62));
  const marks = points.map((point,index) => {
    const mark = {point,index,x:x(index),y:y(point.close)};
    if (mode === 'candlestick') {
      const yOpen=y(point.open),yClose=y(point.close),rawHeight=Math.abs(yOpen-yClose);
      mark.direction=point.close>point.open?'up':point.close<point.open?'down':'flat';
      mark.body={x:mark.x-candleWidth/2,y:rawHeight<1?(yOpen+yClose)/2-.5:Math.min(yOpen,yClose),width:candleWidth,height:Math.max(1,rawHeight)};
      mark.wick={x:mark.x,y1:y(point.high),y2:y(point.low)};
    }
    return mark;
  });
  return {points,marks,width,height,plot,domain,x,y,slot};
}

function dateLabel(time,range,currency,full=false) {
  const date = new Date(time*1000);
  const timeZone=currency==='JPY'?'Asia/Tokyo':'America/New_York';
  const options=full ? {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false} : range==='1d' ? {hour:'2-digit',minute:'2-digit',hour12:false} : {month:'numeric',day:'numeric'};
  return new Intl.DateTimeFormat('ja-JP',{...options,timeZone}).format(date)+(full?(currency==='JPY'?' JST':' 米国東部時間'):'');
}
let chartSequence=0;

/** Render a responsive SVG. Return cleanup() when replacing a mounted chart. */
export function renderMarketChart({root,history=[],currency='JPY',symbol='',name=symbol,range='1mo',mode='line'}={}) {
  if (!root) return () => {};
  const candleMode=mode==='candlestick';
  const geometry=buildChartGeometry(history,{mode:candleMode?'candlestick':'line'});
  const {points,marks,width,height,plot,domain}=geometry;
  root.style.position='relative';
  if (!points.length) {
    root.innerHTML=`<div class="chart-empty"><span class="empty-icon" aria-hidden="true">⌁</span><strong>${candleMode?'この期間のローソク足データはありません':'この期間のチャートはありません'}</strong><p>${candleMode?'始値・高値・安値・終値が揃ったデータが必要です。折れ線または別の期間を選んでください。':'ほかの期間を選択してください。'}</p></div>`;
    return () => {};
  }
  const id=`mango-chart-${++chartSequence}`;
  const number=value => new Intl.NumberFormat('ja-JP',{maximumFractionDigits:currency==='JPY'?0:2}).format(value);
  const grid=Array.from({length:4},(_,index)=>{
    const value=domain.max-(domain.max-domain.min)*index/3,y=geometry.y(value);
    return `<line x1="${plot.left}" y1="${y}" x2="${plot.right}" y2="${y}" stroke="var(--chart-grid,#edf0f2)" stroke-dasharray="3 4"/><text x="${plot.right+10}" y="${y+4}" fill="var(--chart-label,#76818e)" font-size="11">${number(value)}</text>`;
  }).join('');
  const labelIndexes=[...new Set(Array.from({length:Math.min(4,points.length)},(_,index)=>Math.round((points.length-1)*index/Math.max(1,Math.min(4,points.length)-1))))];
  const labels=labelIndexes.map((index,labelIndex)=>`<text x="${marks[index].x}" y="${height-8}" fill="var(--chart-label,#76818e)" font-size="11" text-anchor="${labelIndex===0?'start':labelIndex===labelIndexes.length-1?'end':'middle'}">${escapeHtml(dateLabel(points[index].time,range,currency))}</text>`).join('');
  let series;
  if(candleMode) series=marks.map(mark=>{
    const color=mark.direction==='up'?'var(--chart-up,#23846b)':mark.direction==='down'?'var(--chart-down,#d46368)':'var(--chart-line,#ee9b39)';
    return `<g><title>${escapeHtml(dateLabel(mark.point.time,range,currency,true))} 始値 ${priceText(mark.point.open,currency)} 高値 ${priceText(mark.point.high,currency)} 安値 ${priceText(mark.point.low,currency)} 終値 ${priceText(mark.point.close,currency)}</title><line x1="${mark.x}" x2="${mark.x}" y1="${mark.wick.y1}" y2="${mark.wick.y2}" stroke="${color}" stroke-width="1.2"/><rect x="${mark.body.x}" y="${mark.body.y}" width="${mark.body.width}" height="${mark.body.height}" fill="${color}" rx=".35"/></g>`;
  }).join('');
  else {
    const path=marks.map((mark,index)=>`${index?'L':'M'}${mark.x.toFixed(3)},${mark.y.toFixed(3)}`).join(' ');
    series=`<path d="${path} L${marks.at(-1).x},${plot.bottom} L${marks[0].x},${plot.bottom} Z" fill="url(#${id}-fill)"/><path d="${path}" fill="none" stroke="var(--chart-line,#ee9b39)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${marks.length===1?`<circle cx="${marks[0].x}" cy="${marks[0].y}" r="3" fill="var(--chart-line,#ee9b39)"/>`:''}`;
  }
  const legend=candleMode?'<div class="market-chart-legend" style="display:flex;gap:14px;font-size:11px;margin:0 0 3px"><span style="color:var(--chart-up,#23846b)">● 上昇</span><span style="color:var(--chart-down,#d46368)">● 下落</span><span style="color:var(--chart-label,#76818e)">始値・高値・安値・終値</span></div>':'';
  root.innerHTML=`${legend}<svg class="market-price-chart price-chart" style="display:block;width:100%;height:auto;overflow:visible" viewBox="0 0 ${width} ${height}" role="img" tabindex="0" aria-label="${escapeHtml(name)}の実際の${candleMode?'ローソク足':'折れ線'}チャート。${points.length}件。左右の矢印キーで価格を確認できます。"><title>${escapeHtml(name)} ${candleMode?'ローソク足':'折れ線'}チャート</title><defs><linearGradient id="${id}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--chart-area,#f7a344)" stop-opacity=".18"/><stop offset="100%" stop-color="var(--chart-area,#f7a344)" stop-opacity="0"/></linearGradient></defs>${grid}${series}${labels}<line class="market-chart-crosshair" x1="0" x2="0" y1="${plot.top}" y2="${plot.bottom}" stroke="var(--chart-label,#76818e)" stroke-dasharray="3 3" visibility="hidden"/><circle class="market-chart-dot" r="4" fill="var(--chart-line,#ee9b39)" stroke="var(--panel,#fff)" stroke-width="2" visibility="hidden"/><rect class="market-chart-hit" x="${plot.left}" y="${plot.top}" width="${plot.width}" height="${plot.height}" fill="transparent"/></svg><div class="market-chart-tooltip" role="status" aria-live="polite" hidden style="position:absolute;top:0;z-index:3;pointer-events:none;min-width:154px;max-width:230px;padding:9px 11px;border:1px solid var(--border,#e9ecef);border-radius:9px;background:var(--panel,#fff);color:var(--ink,#202a38);box-shadow:0 5px 18px #0002;font-size:11px;line-height:1.7"></div>`;
  const svg=root.querySelector('svg'),hit=root.querySelector('.market-chart-hit'),tooltip=root.querySelector('.market-chart-tooltip'),crosshair=root.querySelector('.market-chart-crosshair'),dot=root.querySelector('.market-chart-dot');
  let selectedIndex=0;
  function show(index){
    selectedIndex=Math.max(0,Math.min(points.length-1,index));
    const mark=marks[selectedIndex],point=mark.point;
    crosshair.setAttribute('x1',mark.x);crosshair.setAttribute('x2',mark.x);crosshair.setAttribute('visibility','visible');
    dot.setAttribute('cx',mark.x);dot.setAttribute('cy',mark.y);dot.setAttribute('visibility','visible');
    tooltip.innerHTML=`<strong style="display:block;font-size:11px">${escapeHtml(dateLabel(point.time,range,currency,true))}</strong>${[['始値',point.open],['高値',point.high],['安値',point.low],['終値',point.close]].map(([label,value])=>`<div style="display:flex;justify-content:space-between;gap:14px"><span>${label}</span><strong>${priceText(value,currency)}</strong></div>`).join('')}`;
    tooltip.hidden=false;
    const rootWidth=root.getBoundingClientRect().width;
    const scaledX=mark.x/width*rootWidth;
    tooltip.style.left=`${Math.max(0,Math.min(rootWidth-(tooltip.offsetWidth||170),scaledX+12))}px`;
  }
  function hide(){tooltip.hidden=true;crosshair.setAttribute('visibility','hidden');dot.setAttribute('visibility','hidden');}
  function move(event){
    const bounds=svg.getBoundingClientRect();
    if(!bounds.width)return;
    const localX=(event.clientX-bounds.left)/bounds.width*width;
    show(Math.round((localX-plot.left)/geometry.slot-.5));
  }
  function key(event){
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();show(selectedIndex+(event.key==='ArrowLeft'?-1:1));}
    else if(event.key==='Home'){event.preventDefault();show(0);}
    else if(event.key==='End'){event.preventDefault();show(points.length-1);}
    else if(event.key==='Escape')hide();
  }
  const focus=()=>show(selectedIndex);
  hit.addEventListener('pointermove',move);hit.addEventListener('pointerdown',move);hit.addEventListener('pointerleave',hide);
  svg.addEventListener('keydown',key);svg.addEventListener('focus',focus);svg.addEventListener('blur',hide);
  return ()=>{hit.removeEventListener('pointermove',move);hit.removeEventListener('pointerdown',move);hit.removeEventListener('pointerleave',hide);svg.removeEventListener('keydown',key);svg.removeEventListener('focus',focus);svg.removeEventListener('blur',hide);};
}

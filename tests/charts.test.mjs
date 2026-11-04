import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeChartPoints,buildChartGeometry} from '../public/charts.js';
const candle=(time,open,high,low,close)=>({time,open,high,low,close});

test('candlesticks require actual coherent OHLC and never invent values from closes',()=>{
  const history=[candle(100,10,12,9,11),{time:200,close:12},candle(300,10,9,8,11),candle(400,10,12,11,11),candle(500,10,12,8,Infinity)];
  assert.deepEqual(normalizeChartPoints(history,'candlestick'),[{time:100,open:10,high:12,low:9,close:11,volume:null}]);
  assert.equal(normalizeChartPoints(history,'line').length,4);
  assert.equal(normalizeChartPoints(history,'line')[1].open,null);
});

test('observations sort and deduplicate by actual provider timestamp without mutating source',()=>{
  const source=[candle(300,3,4,2,3),candle(100,1,2,.5,1),candle(300,3,5,2,4),{time:NaN,close:1},null];
  const copy=structuredClone(source);
  const result=normalizeChartPoints(source,'candlestick');
  assert.deepEqual(result.map(point=>[point.time,point.close]),[[100,1],[300,4]]);
  assert.deepEqual(source,copy);
});

test('candle y scale includes actual highs and lows; bodies and wicks are correctly oriented',()=>{
  const geometry=buildChartGeometry([candle(100,10,20,2,12),candle(200,12,16,8,9)],{mode:'candlestick'});
  assert.ok(geometry.domain.min<2);
  assert.ok(geometry.domain.max>20);
  assert.deepEqual(geometry.marks.map(mark=>mark.direction),['up','down']);
  for(const mark of geometry.marks){
    assert.ok(mark.wick.y1<mark.wick.y2);
    assert.ok(mark.body.y>=mark.wick.y1);
    assert.ok(mark.body.y+mark.body.height<=mark.wick.y2+.000001);
  }
});

test('candles keep trading observations equally spaced over closed-market gaps',()=>{
  const geometry=buildChartGeometry([candle(100,10,12,9,11),candle(200,11,13,10,12),candle(10000,12,14,11,13)],{mode:'candlestick'});
  const [a,b,c]=geometry.marks;
  assert.equal(b.x-a.x,c.x-b.x);
});

test('a single flat candle remains finite, centered, and visible without synthetic observations',()=>{
  const geometry=buildChartGeometry([candle(100,10,10,10,10)],{mode:'candlestick'});
  assert.equal(geometry.points.length,1);
  assert.equal(geometry.marks[0].body.height,1);
  assert.equal(geometry.marks[0].direction,'flat');
  assert.equal(geometry.marks[0].x,(geometry.plot.left+geometry.plot.right)/2);
  assert.ok(Number.isFinite(geometry.marks[0].y));
  assert.ok(geometry.domain.max>geometry.domain.min);
});

test('line chart keeps valid close-only data and reports no geometry for empty series',()=>{
  const line=buildChartGeometry([{time:100,close:5},{time:200,close:6}],{mode:'line'});
  assert.equal(line.points.length,2);
  assert.ok(line.marks.every(mark=>Number.isFinite(mark.x)&&Number.isFinite(mark.y)));
  assert.equal(buildChartGeometry([]).domain,null);
  assert.deepEqual(buildChartGeometry([{time:100,close:-1}]).marks,[]);
});

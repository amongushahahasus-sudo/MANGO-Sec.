import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApplicationRequest} from '../src/gateway.js';
const base='https://mango-sec-trading.azumaishow781.chatgpt.site';
const origin='https://amongushahahasus-sudo.github.io';
test('Pages browser preflight permits authorization without exposing account data',async()=>{
 const result=await handleApplicationRequest(new Request(base+'/api/trades',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Headers':'authorization,content-type'}}));
 assert.equal(result.status,204);assert.equal(result.headers.get('Access-Control-Allow-Origin'),origin);
 assert.match(result.headers.get('Access-Control-Allow-Headers'),/Authorization/);
 assert.equal((await result.text()),'');
});
test('anonymous accounts require auth and unrelated origins cannot read the API',async()=>{
 const anonymous=await handleApplicationRequest(new Request(base+'/api/account',{headers:{Origin:origin}}));
 assert.equal(anonymous.status,401);assert.equal(anonymous.headers.get('Access-Control-Allow-Origin'),origin);
 const denied=await handleApplicationRequest(new Request(base+'/api/stocks',{headers:{Origin:'https://example.com'}}));
 assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
});
test('auth writes require Origin and ordinary static paths are left to asset serving',async()=>{
 assert.equal((await handleApplicationRequest(new Request(base+'/api/auth/logout',{method:'POST'}))).status,403);
 assert.equal(await handleApplicationRequest(new Request(base+'/app.js')),null);
});

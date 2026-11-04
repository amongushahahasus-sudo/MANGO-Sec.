import assert from 'node:assert/strict';
import {AUTH_CONFIG} from '../public/auth-config.js';
const app='https://amongushahahasus-sudo.github.io/MANGO-Sec./';
const origin=new URL(app).origin;
const endpoint=AUTH_CONFIG.accountApiUrl;
async function request(url,options={}){
 let failure;
 for(let attempt=0;attempt<3;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch(url,{...options,signal:controller.signal,redirect:'manual',headers:{'User-Agent':'MANGO-Sec-Deployment-Check/1.0',...options.headers}});
   if(response.status>=500&&attempt<2){await response.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,2000));continue;}
   return response;
  }catch(error){failure=error;if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,2000));}
  finally{clearTimeout(timer);}
 }
 throw failure;
}
const home=await request(app);assert.equal(home.status,200);assert.match(await home.text(),/MANGO Sec\./);
for(const asset of ['manifest.webmanifest','sw.js','icons/icon-192.png','icons/icon-512.png','onboarding.js','account-ui.js','auth-client.js']){
 const response=await request(new URL(asset,app));assert.equal(response.status,200,asset);await response.arrayBuffer();
}
console.log('PASS public app, installation metadata, icons and tutorial assets');
const headers={Origin:origin,apikey:AUTH_CONFIG.publishableKey};
const health=await request(endpoint+'/health',{headers});assert.equal(health.status,200,'account service readiness');
const healthData=await health.json();assert.equal(healthData.status,'ok');assert.equal(healthData.databaseReady,true);
console.log('PASS account API readiness and real database connection');
const preflight=await request(endpoint+'/api/trades',{method:'OPTIONS',headers:{...headers,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,apikey,content-type'}});
assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
const anonymous=await request(endpoint+'/api/account',{headers});assert.equal(anonymous.status,401);await anonymous.arrayBuffer();
const invalid=await request(endpoint+'/api/account',{headers:{...headers,Authorization:'Bearer a.b.c'}});assert.equal(invalid.status,401);await invalid.arrayBuffer();
console.log('PASS Pages CORS, anonymous rejection and forged-token rejection');
const table=await request(AUTH_CONFIG.url+'/rest/v1/mango_sec_accounts?select=user_id&limit=1',{headers:{apikey:AUTH_CONFIG.publishableKey}});
assert.ok([401,403].includes(table.status),'anonymous direct table access must be denied');await table.arrayBuffer();
console.log('PASS anonymous account storage isolation');
const quotes=await request(endpoint+'/api/market?symbol=NVDA&range=1d',{headers});assert.equal(quotes.status,200,'actual execution quote source');
const market=await quotes.json();assert.equal(market.source,'Yahoo Finance');assert.ok(market.quote.price>0);assert.ok(market.history.length>0);
console.log('PASS actual execution quote and history available');

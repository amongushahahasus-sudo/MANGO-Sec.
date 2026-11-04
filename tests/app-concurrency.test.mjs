import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createAccount, validateAccount, executeTrade, calculatePortfolio } from '../public/trading.js';

// Unit-test account operations in isolation; no browser, server, or network is started.
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').split('const accountUI=createAccountUI(')[0];
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness(){
  const elements=new Map(),storage=new Map(),messages=[];
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{value:'1',disabled:false,hidden:false,textContent:'',innerHTML:'',closeCount:0,close(){this.closeCount++;},addEventListener(){},setAttribute(){},classList:{toggle(){}}});
    return elements.get(selector);
  };
  const context=vm.createContext({
    createAccount,validateAccount,executeTrade,calculatePortfolio,
    initTheme(){},document:{querySelector:element,querySelectorAll(){return [];},addEventListener(){}},
    window:{addEventListener(){}},localStorage:{getItem(){return null;}},
    sessionStorage:{setItem(key,value){storage.set(key,value);},getItem(key){return storage.get(key)||null;},removeItem(key){storage.delete(key);}},
    navigator:{onLine:true},location:{hash:'#market'},history:{replaceState(){}},
    hasSession:()=>true,getSessionUser:()=>null,apiRequest:()=>{throw Error('Configure request');},
    setTimeout,clearTimeout,Intl,URL,AbortController,crypto:globalThis.crypto,
    apiUrl:value=>value,
  });
  vm.runInContext(source+`
    renderAccount=()=>{};renderOrder=()=>{};renderList=()=>{};renderDetail=()=>{};renderPortfolio=()=>{};renderHistory=()=>{};
    notify=message=>globalThis.recordMessage(message);showAccountError=message=>globalThis.recordMessage(message);
    globalThis.operations={state,confirmAction,reloadAccount,saveWatchlist,resetDisplayedAccount,setAccount:value=>{account=value;}};
  `,Object.assign(context,{recordMessage:message=>messages.push(message)}));
  return {context,operations:context.operations,storage,messages,dialog:element('#confirm-dialog')};
}
const pendingFor=user=>({kind:'trade',order:{stock:{symbol:'NVDA',name:user,currency:'USD'},side:'buy',quantity:1},body:{symbol:'NVDA',side:'buy',quantity:1,expectedVersion:0,requestId:crypto.randomUUID()}});
function becomeUserB(h){
  const {state,resetDisplayedAccount}=h.operations;
  resetDisplayedAccount();
  const pending=pendingFor('User B'),owner={generation:state.authGeneration};
  state.user={id:'supabase:B',displayName:'B'};state.accountVersion=0;state.pending=pending;state.mutationBusy=true;state.mutationOwner=owner;
  state.watchSaving=true;state.watchOwner=owner;
  h.storage.set('mango-sec:pending-trade:v2','B-owned pending request');
  return {pending,owner,closeCount:h.dialog.closeCount};
}
for(const result of ['success','503','401']){
  test(`late A trade ${result} cannot mutate B's pending request, storage, dialogs, or busy flags`,async()=>{
    const h=harness(),request=deferred(),{state,confirmAction}=h.operations;
    h.context.apiRequest=()=>request.promise;
    state.user={id:'supabase:A',displayName:'A'};state.accountVersion=0;state.pending=pendingFor('User A');
    const oldOperation=confirmAction();
    const b=becomeUserB(h);
    if(result==='success')request.resolve({account:createAccount(),version:1,watchlist:[],user:{id:'supabase:A',displayName:'A'}});
    else request.reject(Object.assign(new Error('Old A response'),{status:Number(result)}));
    await oldOperation;
    assert.equal(state.user.id,'supabase:B');
    assert.equal(state.pending,b.pending);
    assert.equal(state.uncertainTrade,null);
    assert.equal(state.mutationOwner,b.owner);
    assert.equal(state.mutationBusy,true);
    assert.equal(h.storage.get('mango-sec:pending-trade:v2'),'B-owned pending request');
    assert.equal(h.dialog.closeCount,b.closeCount);
    assert.deepEqual(h.messages,[]);
  });
}

test('late A account and watchlist rejections cannot reset B or release B-owned save flags',async()=>{
  for(const operationName of ['reloadAccount','saveWatchlist']){
    const h=harness(),request=deferred(),{state}=h.operations;
    h.context.apiRequest=()=>request.promise;
    state.user={id:'supabase:A',displayName:'A'};state.accountVersion=0;
    const oldOperation=operationName==='saveWatchlist'?h.operations.saveWatchlist(new Set(['NVDA'])):h.operations.reloadAccount();
    const b=becomeUserB(h);
    request.reject(Object.assign(new Error('Old A unauthorized'),{status:401}));
    await oldOperation;
    assert.equal(state.user.id,'supabase:B');
    assert.equal(state.pending,b.pending);
    assert.equal(state.watchSaving,true);
    assert.equal(state.watchOwner,b.owner);
    assert.deepEqual(h.messages,[]);
  }
});

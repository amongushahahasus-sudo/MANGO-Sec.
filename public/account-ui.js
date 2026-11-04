import { signIn, signUp, startGoogleSignIn, sendPasswordReset, updatePassword } from './auth-client.js';

export function validateAccountForm({mode='login',email='',password='',displayName='',passwordConfirmation=''}={}) {
  if (mode!=='recovery' && (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) return 'メールアドレスを確認してください。';
  if (mode==='forgot') return null;
  if (!password || (mode!=='login' && password.length<8)) return mode==='login'?'パスワードを入力してください。':'パスワードは8文字以上で設定してください。';
  if (mode==='signup' && displayName.trim().length>50) return '表示名は50文字以内で入力してください。';
  if (['signup','recovery'].includes(mode) && password!==passwordConfirmation) return '確認用パスワードが一致しません。';
  return null;
}

/** Google and email authentication UI; all credential operations use Supabase Auth. */
export function createAccountUI({onSuccess=()=>{},onError=()=>{}}={}) {
  if(typeof document==='undefined')return {open(){},close(){},destroy(){}};
  const dialog=document.createElement('dialog');
  dialog.className='account-modal';dialog.setAttribute('aria-labelledby','account-modal-title');
  document.body.append(dialog);
  let mode='login',busy=false,flow={},view='form',message='',emailValue='',initialError='';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const text={login:['おかえりなさい。','ご自分の口座にログインして、続きから始めましょう。'],signup:['あなたの投資を、ここから。','無料の仮想口座を作成して、実際の市場で練習しましょう。'],forgot:['パスワードを再設定','登録したメールアドレスに再設定用リンクを送ります。'],recovery:['新しいパスワードを設定','8文字以上の新しいパスワードを入力してください。']};
  function errorMessage(value){const target=dialog.querySelector('.account-form-error');if(target){target.textContent=value||'';target.hidden=!value;}}
  function setBusy(value){busy=value;dialog.querySelectorAll('button,input').forEach(element=>element.disabled=value);dialog.setAttribute('aria-busy',String(value));const submit=dialog.querySelector('[data-account-submit]');if(submit&&value)submit.textContent='確認しています…';}
  function render(){
    const heading=view==='confirmation'?'メールをご確認ください。':view==='reset-sent'?'再設定メールをご確認ください。':text[mode][0];
    dialog.innerHTML=`<button type="button" class="account-modal-close" data-account-close aria-label="閉じる">×</button><div class="account-modal-brand"><svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#ffad42" d="M49 16C34 5 11 18 10 36c-1 20 25 24 37 9 9-12 10-23 2-29Z"/><path fill="#3e7760" d="M35 13C39 0 51 1 56 4c-2 10-12 14-21 9Z"/></svg><span>MANGO <b>Sec.</b></span></div><h2 id="account-modal-title">${heading}</h2><p class="account-modal-intro">${view==='form'?text[mode][1]:esc(message)}</p>${view==='form'&&mode==='login'?'<p class="account-shared-note">MANGO FXのアカウントでもログインできます。</p>':''}${view==='form'?formMarkup():`<div class="account-confirm-note"><span aria-hidden="true">✉</span><p>${view==='confirmation'?'メール内の確認リンクを開くと登録が完了します。確認後、このアプリに戻ってログインしてください。':'登録済みのアドレスには、再設定用のメールが届きます。メール内のリンクを開いて、新しいパスワードを設定してください。'}</p><small>迷惑メールフォルダーもご確認ください。</small></div><button type="button" class="btn btn-primary account-main-button" data-account-mode="login">ログイン画面へ</button>`}<p class="account-modal-footnote">学習用の仮想口座です。実際の金銭や株式は移動しません。</p>`;
    busy=false;dialog.setAttribute('aria-busy','false');errorMessage(initialError);initialError='';
  }
  function formMarkup(){
    const credential=mode==='forgot'?'':`<label class="account-field"><span>${mode==='recovery'?'新しいパスワード':'パスワード'}</span><div class="account-password"><input name="password" type="password" ${mode==='login'?'':'minlength="8"'} maxlength="256" autocomplete="${mode==='login'?'current-password':'new-password'}" required placeholder="${mode==='login'?'パスワードを入力':'8文字以上'}"><button type="button" data-account-toggle="password" aria-label="パスワードを表示" aria-pressed="false">表示</button></div></label>${['signup','recovery'].includes(mode)?'<label class="account-field"><span>パスワード（確認）</span><div class="account-password"><input name="passwordConfirmation" type="password" minlength="8" maxlength="256" autocomplete="new-password" required placeholder="同じパスワードを入力"><button type="button" data-account-toggle="passwordConfirmation" aria-label="確認用パスワードを表示" aria-pressed="false">表示</button></div></label>':''}`;
    return `${['login','signup'].includes(mode)?`<div class="account-mode-tabs" role="group" aria-label="登録・ログイン"><button type="button" data-account-mode="signup" aria-pressed="${mode==='signup'}" class="${mode==='signup'?'active':''}">新規登録</button><button type="button" data-account-mode="login" aria-pressed="${mode==='login'}" class="${mode==='login'?'active':''}">ログイン</button></div><button type="button" class="account-google" data-account-google><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.93a6.01 6.01 0 0 1 0-3.86V7.48H3.07a10 10 0 0 0 0 9.04l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.61 9.61 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.34 2.59C7.2 7.71 9.4 5.95 12 5.95Z"/></svg>Googleで${mode==='signup'?'登録':'ログイン'}</button><div class="account-divider"><span>またはメールアドレスで</span></div>`:''}<form class="account-form">${mode==='signup'?'<label class="account-field"><span>表示名 <small>任意</small></span><input name="displayName" type="text" maxlength="50" autocomplete="nickname" placeholder="表示名を入力"></label>':''}${mode==='recovery'?'':`<label class="account-field"><span>メールアドレス</span><input name="email" type="email" maxlength="254" autocomplete="email" required value="${esc(emailValue)}" placeholder="you@example.com"></label>`}${credential}<p class="account-form-error" role="alert" hidden></p><button type="submit" class="btn btn-primary account-main-button" data-account-submit>${mode==='signup'?'無料で口座を作成':mode==='forgot'?'再設定メールを送信':mode==='recovery'?'パスワードを更新':'ログイン'}</button>${mode==='login'?'<button type="button" class="account-text-button" data-account-mode="forgot">パスワードを忘れた方</button>':mode==='forgot'?'<button type="button" class="account-text-button" data-account-mode="login">ログインに戻る</button>':''}</form>`;
  }
  async function success(){
    await onSuccess();
    const complete=flow.onComplete;flow={};dialog.close();complete?.();
  }
  function close({cancel=true}={}){if(busy)return;const callback=cancel?flow.onCancel:null;flow={};dialog.close();callback?.();}
  async function submit(event){
    event.preventDefault();if(busy)return;
    const values=Object.fromEntries(new FormData(event.target));
    const problem=validateAccountForm({mode,...values});if(problem){errorMessage(problem);return;}
    emailValue=values.email?.trim()||emailValue;errorMessage('');setBusy(true);
    try{
      if(mode==='signup'){
        const result=await signUp(values.email,values.password,values.displayName||'');
        if(result.confirmationRequired){view='confirmation';message=`${emailValue} 宛てに登録確認メールを送信しました。`;render();return;}
        await success();
      }else if(mode==='forgot'){
        await sendPasswordReset(values.email);view='reset-sent';message='メール送信を受け付けました。';render();return;
      }else if(mode==='recovery'){
        await updatePassword(values.password);await success();
      }else{await signIn(values.email,values.password);await success();}
    }catch(error){errorMessage(error.message||'処理を完了できませんでした。');onError(error);}
    finally{if(dialog.open){setBusy(false);const submit=dialog.querySelector('[data-account-submit]');if(submit)submit.textContent=mode==='signup'?'無料で口座を作成':mode==='forgot'?'再設定メールを送信':mode==='recovery'?'パスワードを更新':'ログイン';}}
  }
  async function googleSignIn(){
    errorMessage('');setBusy(true);
    try{await startGoogleSignIn();if(dialog.open)setBusy(false);}
    catch(error){errorMessage(error.message);onError(error);setBusy(false);}
  }
  dialog.addEventListener('submit',submit);
  dialog.addEventListener('click',async event=>{
    if(busy)return;
    if(event.target.closest('[data-account-close]')){close();return;}
    const change=event.target.closest('[data-account-mode]');if(change){const input=dialog.querySelector('[name="email"]');if(input)emailValue=input.value;mode=change.dataset.accountMode;view='form';render();return;}
    const toggle=event.target.closest('[data-account-toggle]');if(toggle){const input=dialog.querySelector(`[name="${toggle.dataset.accountToggle}"]`);const visible=input.type==='password';input.type=visible?'text':'password';toggle.textContent=visible?'隠す':'表示';toggle.setAttribute('aria-pressed',String(visible));return;}
    if(event.target.closest('[data-account-google]'))await googleSignIn();
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  return {
    open(options={}){if(busy)return;if(dialog.open&&options.mode===mode&&view==='form'&&!options.initialError)return;mode=['login','signup','forgot','recovery'].includes(options.mode)?options.mode:'login';view='form';message='';initialError=options.initialError||'';emailValue=options.email||'';flow={onCancel:options.onCancel,onComplete:options.onComplete};render();if(!dialog.open)dialog.showModal();queueMicrotask(()=>{if(options.method==='google')googleSignIn();else dialog.querySelector('input')?.focus();});},
    close,
    destroy(){busy=false;dialog.close();dialog.remove();},
  };
}

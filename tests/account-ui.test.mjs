import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAccountForm } from '../public/account-ui.js';

test('signup requires valid email, long matching passwords and bounded optional display name', () => {
  const valid={mode:'signup',email:'person@example.com',password:'a-valid-password',passwordConfirmation:'a-valid-password'};
  assert.equal(validateAccountForm(valid),null);
  assert.match(validateAccountForm({...valid,email:'broken'}),/メール/);
  assert.match(validateAccountForm({...valid,password:'short',passwordConfirmation:'short'}),/8文字/);
  assert.match(validateAccountForm({...valid,passwordConfirmation:'different'}),/一致/);
  assert.match(validateAccountForm({...valid,displayName:'a'.repeat(51)}),/50文字/);
});

test('password recovery does not require email but does require a matching new password', () => {
  assert.equal(validateAccountForm({mode:'recovery',password:'new-password',passwordConfirmation:'new-password'}),null);
  assert.match(validateAccountForm({mode:'recovery',password:'new-password',passwordConfirmation:'bad'}),/一致/);
  assert.equal(validateAccountForm({mode:'forgot',email:'person@example.com'}),null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_STEP, TUTORIAL_PAGE_COUNT, createTutorialState, transitionTutorial } from '../public/onboarding.js';

test('all four tutorial pages lead to account entry and remain reversible', () => {
  let state = createTutorialState();
  const visited = [state.step];
  for (let page = 0; page < TUTORIAL_PAGE_COUNT; page += 1) {
    state = transitionTutorial(state, 'next');
    visited.push(state.step);
    assert.equal(state.status, 'active');
  }
  assert.deepEqual(visited, [0, 1, 2, 3, ACCOUNT_STEP]);
  assert.equal(transitionTutorial(state, 'next').step, ACCOUNT_STEP);
  for (let page = ACCOUNT_STEP; page > 0; page -= 1) state = transitionTutorial(state, 'back');
  assert.equal(state.step, 0);
  assert.equal(transitionTutorial(state, 'back').step, 0);
});

test('dismissal and navigation do not count as completion', () => {
  const initial = createTutorialState(3);
  const next = transitionTutorial(initial, 'next');
  assert.deepEqual(initial, { step: 3, status: 'active' });
  assert.equal(next.status, 'active');
  const dismissed = transitionTutorial(next, 'dismiss');
  assert.equal(dismissed.status, 'dismissed');
  assert.deepEqual(transitionTutorial(dismissed, 'back'), dismissed);
  assert.deepEqual(transitionTutorial(dismissed, { type: 'open', startAt: ACCOUNT_STEP }), { step: ACCOUNT_STEP, status: 'active' });
  assert.equal(transitionTutorial(next, 'complete').status, 'completed');
  assert.equal(transitionTutorial(dismissed, 'complete').status, 'completed');
});

test('invalid or out-of-range deep links stay within the available screens', () => {
  for (const input of [-10, NaN, Infinity, 'invalid', undefined]) assert.equal(createTutorialState(input).step, 0);
  assert.equal(createTutorialState(999).step, ACCOUNT_STEP);
  assert.equal(createTutorialState(2.9).step, 2);
  assert.equal(transitionTutorial(createTutorialState(), { type: 'go', step: 999 }).step, ACCOUNT_STEP);
  assert.equal(transitionTutorial(createTutorialState(), { type: 'go', step: -1 }).step, 0);
});

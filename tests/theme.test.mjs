import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from '../public/theme.js';

const localTime = (hour, minute = 0) => new Date(2026, 10, 4, hour, minute);

test('automatic theme changes at the local morning and evening boundaries', () => {
  assert.equal(resolveTheme('auto', localTime(6, 59)), 'dark');
  assert.equal(resolveTheme('auto', localTime(7)), 'light');
  assert.equal(resolveTheme('auto', localTime(18, 59)), 'light');
  assert.equal(resolveTheme('auto', localTime(19)), 'dark');
  assert.equal(resolveTheme('auto', localTime(0)), 'dark');
  assert.equal(resolveTheme('auto', localTime(23, 59)), 'dark');
});

test('manual choices remain stable regardless of clock time', () => {
  for (const hour of [0, 7, 12, 19, 23]) {
    assert.equal(resolveTheme('light', localTime(hour)), 'light');
    assert.equal(resolveTheme('dark', localTime(hour)), 'dark');
  }
});

test('damaged preferences recover to automatic mode without breaking rendering', () => {
  assert.equal(resolveTheme('invalid', localTime(23)), 'dark');
  assert.equal(resolveTheme(null, localTime(10)), 'light');
  assert.equal(resolveTheme('auto', new Date(NaN)), 'light');
});

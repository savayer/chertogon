import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t, setLang, getLang } from '../src/i18n.js';

test('every language has exactly the same keys', () => {
  const ru = Object.keys(STRINGS.ru).sort();
  for (const [lang, table] of Object.entries(STRINGS)) {
    assert.deepEqual(Object.keys(table).sort(), ru, `${lang} keys differ from ru`);
  }
});

test('t() follows the current language and fills {vars}', () => {
  setLang('en');
  assert.equal(getLang(), 'en');
  assert.equal(t('deathTitle', { name: 'Masha' }), STRINGS.en.deathTitle.replace('{name}', 'Masha'));
  setLang('ru');
  assert.equal(t('deathTitle', { name: 'Маша' }), STRINGS.ru.deathTitle.replace('{name}', 'Маша'));
});

test('unknown language is ignored, unknown key falls back to the key', () => {
  setLang('ru');
  setLang('xx');
  assert.equal(getLang(), 'ru');
  assert.equal(t('no.such.key'), 'no.such.key');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idiomaPorNavegador, iniciarIdioma, setIdioma, getIdioma, t, TEXTOS_I18N } from '../../pwa/i18n.js';

test('el idioma del navegador: es* → español, cualquier otro → inglés', () => {
  assert.equal(idiomaPorNavegador('es-MX'), 'es');
  assert.equal(idiomaPorNavegador('es'), 'es');
  assert.equal(idiomaPorNavegador('ES-es'), 'es');
  assert.equal(idiomaPorNavegador('en-US'), 'en');
  assert.equal(idiomaPorNavegador('fr-FR'), 'en');
  assert.equal(idiomaPorNavegador(''), 'en');
});

test('localStorage manda sobre el navegador y solo acepta es o en', () => {
  const ls = (() => { const s = {}; return { getItem: (k) => s[k] ?? null, setItem: (k, v) => { s[k] = String(v); }, store: s }; })();
  assert.equal(iniciarIdioma(ls, 'en-US'), 'en');
  assert.equal(ls.store['buzon-idioma'], 'en');
  ls.store['buzon-idioma'] = 'es';
  assert.equal(iniciarIdioma(ls, 'en-US'), 'es');
  ls.store['buzon-idioma'] = 'fr';
  assert.equal(iniciarIdioma(ls, 'en-GB'), 'en');
});

test('todas las claves existen en los dos idiomas y t() interpola', () => {
  const es = Object.keys(TEXTOS_I18N.es), en = Object.keys(TEXTOS_I18N.en);
  assert.deepEqual(es.sort(), en.sort());
  assert.ok(es.length > 80);
  const ls = { getItem: () => 'es', setItem() {} };
  iniciarIdioma(ls, 'es');
  setIdioma('es');
  assert.equal(getIdioma(), 'es');
  assert.equal(t('conectar.pregunta'), '¿A qué agente deseas conectar?');
  assert.equal(t('agentes.claveDe', { nombre: 'Claude' }), 'Clave de Claude');
  setIdioma('en');
  assert.equal(getIdioma(), 'en');
  assert.equal(t('conectar.pregunta'), 'Which agent do you want to connect?');
  assert.equal(t('agentes.claveDe', { nombre: 'Claude' }), 'Key for Claude');
  setIdioma('es');
});

test('las cadenas de avisos y de Por aprobar están en ambos idiomas', () => {
  assert.equal(TEXTOS_I18N.es['avisos.enConversacion'], 'En esta conversación');
  assert.equal(TEXTOS_I18N.es['avisos.otraIa'], 'Otra IA de tu buzón');
  assert.equal(TEXTOS_I18N.es['avisos.inmediatos'], 'Aviso inmediato');
  assert.equal(TEXTOS_I18N.es['avisos.cuandoRevise'], 'Se enterará cuando revise');
  assert.ok(TEXTOS_I18N.en['avisos.enConversacion']);
  assert.ok(TEXTOS_I18N.en['nav.aprobar']);
  assert.equal(TEXTOS_I18N.es['nav.aprobar'], 'Por aprobar');
});

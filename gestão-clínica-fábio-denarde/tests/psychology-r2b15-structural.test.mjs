import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const { isPsychologySessionBeforeNow } = await import('../src/features/psychology-pilot/psychologyAgendaTemporal.ts');
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
  localStorage: { setItem() {}, removeItem() {}, getItem() { return null; } },
  sessionStorage: { setItem() {}, removeItem() {}, getItem() { return null; } },
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.HTMLElement = class HTMLElement {};
globalThis.document = { activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };
globalThis.fetch = async () => new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });

const { PsychologySettingsView } = await import('../src/features/psychology-pilot/PsychologyPilot.tsx');
const { createEmptyPsychologyStore, createPsychologyScope } = await import('../src/features/psychology-pilot/psychologyDomain.ts');

function textContent(node) {
  return node.children?.map(child => typeof child === 'string' ? child : textContent(child)).join('') || '';
}

function button(renderer, text, exact = false) {
  return renderer.root.findAllByType('button').find(item => exact ? textContent(item).trim() === text : textContent(item).includes(text));
}

function nodesByTestId(renderer, value) {
  return renderer.root.findAll(node => node.props?.['data-testid'] === value);
}

test('R2B15 — patient chart classifies civil session dates in the local timezone', () => {
  const now = new Date('2026-08-23T23:30:00-03:00');

  assert.equal(
    isPsychologySessionBeforeNow({ date: '2026-08-23', time: '23:45' }, now),
    false,
    'a session later on the local civil day must remain upcoming',
  );
  assert.equal(
    isPsychologySessionBeforeNow({ date: '2026-08-23', time: '23:15' }, now),
    true,
    'a session earlier on the local civil day must be previous',
  );
  assert.equal(
    isPsychologySessionBeforeNow({ date: '2026-08-22', time: '23:45' }, now),
    true,
    'a session on a prior civil day must be previous',
  );
});

test('R2B15 — settings paths remain navigable and Configurar opens the agenda editor', () => {
  const store = createEmptyPsychologyStore(createPsychologyScope('r2b15-settings-scope'));
  const onUpdate = async () => true;
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(PsychologySettingsView, {
      store,
      settings: store.settings,
      patients: [],
      sessionPackages: [],
      onUpdatePackage: onUpdate,
      onUpdate,
      onUpdateLocation: onUpdate,
      onCreateLocation: onUpdate,
      onSetLocationColor: onUpdate,
      onSetPrimary: onUpdate,
      onSetActive: onUpdate,
      onSetColor: onUpdate,
      onRestoreColors: onUpdate,
      preview: null,
      hiddenCancelledEventCount: 0,
      onRestoreHiddenCancelled: () => {},
      previewLoading: false,
      previewLoadError: '',
      onActivatePreview: async () => {},
      onEndPreview: () => {},
    }));
  });

  act(() => { button(renderer, 'Aparência e Sistema').props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-settings-panel-system').length, 1);
  act(() => { button(renderer, 'Voltar às áreas de ajustes', true).props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-settings-panel-agenda').length, 1);
  act(() => { button(renderer, 'Configurar', true).props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-agenda-settings-editor').length, 1);
  act(() => { renderer.unmount(); });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { auth } from '../src/firebase.ts';
import ProfessionalGooglePhotosGallery from '../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx';
import { resetGooglePhotosAlbumsCacheForTests } from '../src/lib/googlePhotosAlbumsApi.ts';
import { createEmptyGooglePhotosAlbumCard } from '../shared/googlePhotosAlbums.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const patientId = 'fixture-patient';
const sessionId = 'fixture-session';
let fixtureRun = 0;

function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'string') return node;
  if (!node) return '';
  return textOf(node.children || []);
}

function fixtureSession(overrides = {}) {
  return {
    id: sessionId, patientId, date: '2026-09-10', time: '18:30',
    type: 'Sessão simples (50 min)', status: 'Realizada', packageNumber: 1,
    activitySessionNumber: 7, isBlocked: false, consumesPackage: true,
    ...overrides,
  };
}

function fixtureAlbum(overrides = {}) {
  return {
    ...createEmptyGooglePhotosAlbumCard({
      patientId, patientName: 'Pessoa fictícia', packageNumber: 1,
      activityDate: '2026-09-10', sessionTime: '18:30',
      sessionIds: [sessionId], title: 'Atividade de Intervenção',
    }),
    title: 'Atividade de Intervenção', category: 'Atividade de Intervenção',
    ...overrides,
  };
}

async function renderFixture({ session = fixtureSession(), album = fixtureAlbum(), galleryStatus = null, galleryFailure = '' } = {}, inspect) {
  await auth.authStateReady?.();
  resetGooglePhotosAlbumsCacheForTests();
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousUser = Object.getOwnPropertyDescriptor(auth, 'currentUser');
  globalThis.window = {
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {}, confirm: () => { throw new Error('No real write or confirmation'); },
  };
  Object.defineProperty(auth, 'currentUser', {
    configurable: true,
    value: { uid: `fixture-only-${++fixtureRun}`, getIdToken: async () => 'fixture-token' },
  });
  globalThis.fetch = async (url, init = {}) => {
    const address = new URL(String(url), 'http://localhost:4173');
    const action = init.method === 'POST' ? JSON.parse(String(init.body)).action : '';
    assert.ok(init.method === 'GET' || (init.method === 'POST' && action === 'listProfessionalGallery'), 'fixture read-only');
    if (action === 'listProfessionalGallery') {
      if (galleryFailure) throw Object.assign(new Error('Falha fictícia da consulta.'), { code: galleryFailure });
      return json({
        items: galleryStatus ? [{ sessions: [{ id: sessionId, patientId, mediaCount: 0, ...galleryStatus }] }] : [],
        monitoringStart: galleryStatus ? '2026-01-01T00:00:00Z' : null,
      });
    }
    if (address.searchParams.get('mode') === 'sessions') return json({ sessions: [session] });
    if (address.pathname === '/api/google-photos-albums') {
      return json({
        albums: album ? [album] : [], packageKey: `${patientId}__package_1`, packageNumber: 1,
        scope: 'manage', ownerUserId: 'fixture-only',
        permissions: { canView: true, canCreate: true, canEdit: true, canHide: true, canReactivate: true, canRemove: true },
        queryCount: 1, readUpperBound: 1,
      });
    }
    throw new Error('Unexpected fixture route');
  };
  let view;
  try {
    await act(async () => {
      view = TestRenderer.create(React.createElement(ProfessionalGooglePhotosGallery, {
        active: true, navigationKey: 1,
        patients: [{ id: patientId, name: 'Pessoa fictícia', packageTolerances: [] }],
        sessions: [session], payments: [], currentUserName: 'Profissional fictício',
        initialPatientId: patientId, onUpdate: async () => { throw new Error('Write forbidden'); },
      }));
    });
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    const cards = view.root.findAll(node => node.type === 'article' && String(node.props.id || '').startsWith('google-photos-card-'));
    assert.ok(cards.length > 0, 'card rendered');
    await inspect(cards[0], view);
  } finally {
    if (view) await act(async () => { view.unmount(); });
    resetGooglePhotosAlbumsCacheForTests();
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
    if (previousUser) Object.defineProperty(auth, 'currentUser', previousUser);
    else delete auth.currentUser;
  }
}

test('sessão normal: observação livre permanece, ações de mídia continuam e dados aparecem uma vez', async () => {
  await renderFixture({ album: fixtureAlbum({ observation: 'Não houve oportunidade de registro.' }) }, card => {
    const text = textOf(card);
    assert.match(text, /Observação\s+Não houve oportunidade de registro\./u);
    assert.match(text, /Criar álbum no Google Fotos/u);
    assert.match(text, /Adicionar link/u);
    assert.match(text, /Registrar sem mídia/u);
    assert.doesNotMatch(text, /Ausência registrada|Registro de mídia da sessão|Sem registro de mídia/u);
    assert.doesNotMatch(text, /Categoria\s+Atividade de Intervenção|\bAtivo\b|Sem link|Com link/u);
    assert.equal((text.match(/Atividade de Intervenção/gu) || []).length, 1);
    assert.equal((text.match(/Sessão 1/gu) || []).length, 1);
    assert.equal((text.match(/10\/09\/2026/gu) || []).length, 1);
    assert.equal((text.match(/18:30/gu) || []).length, 1);
  });
});

test('pendência confirmada aparece compacta sem bloco de mídia', async () => {
  await renderFixture({ galleryStatus: { state: 'overdue', justification: null } }, card => {
    const text = textOf(card);
    assert.match(text, /Mídia pendente em atraso/u);
    assert.doesNotMatch(text, /Registro de mídia da sessão|Sem registro de mídia/u);
    assert.equal((text.match(/Sessão 1/gu) || []).length, 1);
  });
});

test('álbum válido prevalece sobre pendência antiga na apresentação', async () => {
  await renderFixture({
    album: fixtureAlbum({ url: 'https://photos.app.goo.gl/fixtureAlbum' }),
    galleryStatus: { state: 'overdue', justification: null },
  }, card => {
    const text = textOf(card);
    assert.match(text, /Abrir álbum/u);
    assert.doesNotMatch(text, /Mídia pendente|Com link|Mídia registrada/u);
  });
});

test('link Google Fotos válido prevalece sobre pendência antiga', async () => {
  await renderFixture({
    album: fixtureAlbum({ url: 'https://photos.google.com/share/fixtureLink' }),
    galleryStatus: { state: 'overdue', justification: null },
  }, card => {
    const text = textOf(card);
    assert.match(text, /Abrir álbum/u);
    assert.doesNotMatch(text, /Mídia pendente|Com link|Mídia registrada/u);
  });
});

for (const failure of ['timeout', 'error']) {
  test(`${failure} da consulta de mídia não declara pendência`, async () => {
    await renderFixture({ galleryFailure: failure }, card => {
      const text = textOf(card);
      assert.doesNotMatch(text, /Mídia pendente/u);
    });
  });
}

test('justificativa estruturada mostra motivo e observação, sem ações de criação', async () => {
  await renderFixture({ galleryStatus: {
    state: 'excused',
    justification: { active: true, reason: 'other', note: 'Observação fictícia compartilhável.' },
  } }, card => {
    const text = textOf(card);
    assert.match(text, /Sem mídia — Outro motivo/u);
    assert.match(text, /Observação\s+Observação fictícia compartilhável\./u);
    assert.match(text, /Alterar motivo/u);
    assert.doesNotMatch(text, /Criar álbum no Google Fotos|Adicionar link|Registrar sem mídia|Sem registro de mídia/u);
    assert.doesNotMatch(text, /Ausência registrada/u);
  });
});

test('justificativa estruturada precede link válido sem declarar pendência', async () => {
  await renderFixture({
    album: fixtureAlbum({ url: 'https://photos.app.goo.gl/fixtureJustification' }),
    galleryStatus: { state: 'overdue', justification: { active: true, reason: 'other', note: 'Nota fictícia.' } },
  }, card => {
    const text = textOf(card);
    assert.match(text, /Sem mídia — Outro motivo/u);
    assert.match(text, /Alterar motivo/u);
    assert.doesNotMatch(text, /Mídia pendente|Criar álbum no Google Fotos|Adicionar link|Registrar sem mídia/u);
  });
});

test('ausência canônica mantém motivo e observação sem controles de mídia', async () => {
  await renderFixture({
    session: fixtureSession({ status: 'Realizada', noReplacementReasonCode: 'other', noReplacementReasonText: 'Outro motivo', noReplacementObservation: 'Ausência fictícia registrada.' }),
    album: null,
  }, card => {
    const text = textOf(card);
    assert.match(text, /Ausência registrada/u);
    assert.match(text, /Motivo da ausência\s+Outro motivo/u);
    assert.match(text, /Observação da ausência\s+Ausência fictícia registrada\./u);
    assert.match(text, /Alterar motivo|Copiar resumo até aqui/u);
    assert.doesNotMatch(text, /Categoria/u);
    assert.doesNotMatch(text, /Criar álbum no Google Fotos|Adicionar link|Registrar sem mídia|Mídia pendente|Sem registro de mídia/u);
    assert.doesNotMatch(String(card.props.className), /border-status-orange/u);
  });
});

test('álbum existente mantém abertura e metadado discreto de publicação', async () => {
  await renderFixture({
    album: fixtureAlbum({ url: 'https://photos.app.goo.gl/fixture123', publishedAt: '2026-09-19', createdByName: 'Profissional fictício', visibleToGuardian: true }),
    galleryStatus: { state: 'sent', mediaCount: 1, justification: null },
  }, card => {
    const text = textOf(card);
    assert.match(text, /Abrir álbum/u);
    assert.match(text, /Publicado em\s+19\/09\/2026\s+por\s+Profissional fictício\s+·\s+Visível ao responsável/u);
    assert.doesNotMatch(text, /Visibilidade/u);
    assert.equal(card.findAll(node => node.type === 'dt' && textOf(node).includes('Publicado em')).length, 0);
    assert.doesNotMatch(text, /Criar álbum no Google Fotos|Adicionar link|Registrar sem mídia|Sem link|Com link/u);
    const secondary = card.findAll(node => node.props['aria-label'] === 'Ações secundárias');
    assert.equal(secondary.length, 1);
    assert.match(secondary[0].props.className, /ml-auto.*flex.*gap-1\.5/u);
    for (const label of ['Editar card', 'Ocultar card', 'Remover vínculo']) {
      const button = secondary[0].findAll(node => node.type === 'button' && node.props['aria-label'] === label)[0];
      assert.ok(button, `${label} preserved`);
      assert.match(button.props.className, /h-\[38px\] w-\[38px\]/u);
    }
    assert.equal(card.findAll(node => node.type === 'button' && textOf(node).includes('Copiar resumo')).length, 1);
    assert.match(card.props.className, /p-3.*sm:p-4/u);
    assert.ok(card.findAll(node => node.props.className?.includes('flex-wrap') && node.props.className?.includes('border-t')).length > 0);
  });
});

test('observação longa quebra sem ocultar ações ou alterar o estado', async () => {
  const note = 'Observação fictícia longa '.repeat(20).trim();
  await renderFixture({ album: fixtureAlbum({ observation: note }) }, card => {
    const text = textOf(card);
    assert.match(text, /Observação fictícia longa/u);
    assert.match(text, /Criar álbum no Google Fotos|Adicionar link|Registrar sem mídia/u);
    assert.doesNotMatch(text, /Sem mídia —|Ausência registrada|Mídia pendente/u);
    const observation = card.findAll(node => node.type === 'dd' && textOf(node).includes('Observação fictícia longa'))[0];
    assert.match(observation.props.className, /whitespace-pre-wrap break-words/u);
  });
});

test('card oculto mantém a ação secundária de reativação no mesmo grupo', async () => {
  await renderFixture({
    album: fixtureAlbum({ url: 'https://photos.app.goo.gl/fixtureHidden', status: 'hidden' }),
    galleryStatus: { state: 'sent', mediaCount: 1, justification: null },
  }, card => {
    const secondary = card.findAll(node => node.props['aria-label'] === 'Ações secundárias')[0];
    assert.ok(secondary.findAll(node => node.type === 'button' && node.props['aria-label'] === 'Reativar card').length > 0);
    assert.equal(secondary.findAll(node => node.type === 'button' && node.props['aria-label'] === 'Ocultar card').length, 0);
  });
});

test('link existente não oferece registro sem mídia mesmo quando o estado remoto é desconhecido', async () => {
  await renderFixture({
    album: fixtureAlbum({ url: 'https://photos.app.goo.gl/fixture456' }),
  }, card => {
    const text = textOf(card);
    assert.match(text, /Abrir álbum/u);
    assert.doesNotMatch(text, /Criar álbum no Google Fotos|Adicionar link|Registrar sem mídia|Mídia pendente/u);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  activitySessionConsumesPackage,
  buildActivityMediaPackageModel,
  isActivityMediaSelectableSession,
} from '../shared/activityMediaPackages.js';
import {
  buildGooglePhotosVirtualAlbumCards,
} from '../shared/googlePhotosAlbums.js';
import {
  buildResponsiblePackages,
  sessionConsumesPackage,
} from '../api/_lib/responsiblePortalPackages.js';

const STATUS = 'late_cancellation_no_replacement';
const LABEL = 'Falta contabilizada — sem reposição';
const PORTAL_LABEL = 'Sessão contabilizada — sem reposição';
const REASON = 'Aviso tardio ou cancelamento fora do prazo';
const DEFAULT_NOTE = 'Devido ao aviso tardio, a sessão foi contabilizada como dada.';
const NOW = new Date('2026-06-20T15:00:00.000Z');

function session(id, date, status = 'Realizada', extra = {}) {
  return {
    id,
    patientId: 'patient-sintetico',
    date,
    time: extra.time || '08:00',
    type: extra.type || 'Sessão simples (50 min)',
    status,
    ...extra,
  };
}

test('novo status é canônico, não é realizada e consome pacote sem representar atendimento realizado', () => {
  assert.notEqual(STATUS, 'Realizada');
  assert.equal(activitySessionConsumesPackage(session('late', '2026-06-10', STATUS)), true);
  assert.equal(sessionConsumesPackage(session('late', '2026-06-10', STATUS)), true);
  assert.equal(isActivityMediaSelectableSession(session('late', '2026-06-10', STATUS), NOW), false);
});

test('falta comum mantém a regra anterior de consumo explícito', () => {
  assert.equal(activitySessionConsumesPackage(session('absence', '2026-06-10', 'Falta')), false);
  assert.equal(activitySessionConsumesPackage(session('absence-counted', '2026-06-10', 'Falta', { consumesPackage: true })), true);
  assert.equal(sessionConsumesPackage(session('absence', '2026-06-10', 'Falta')), false);
  assert.equal(sessionConsumesPackage(session('absence-counted', '2026-06-10', 'Falta', { consumesPackage: true })), true);
});

test('conversão de realizada para falta sem reposição preserva posição e não renumera sessões posteriores', () => {
  const sessions = [
    session('s1', '2026-06-01', 'Realizada'),
    session('s2', '2026-06-02', STATUS, {
      consumesPackage: true,
      noReplacementReasonCode: 'late_notice_or_out_of_policy_cancellation',
      noReplacementReasonText: REASON,
      noReplacementObservation: DEFAULT_NOTE,
      noReplacementHistory: [{
        previousStatus: 'Realizada',
        newStatus: STATUS,
        reasonCode: 'late_notice_or_out_of_policy_cancellation',
        reasonText: REASON,
        observation: DEFAULT_NOTE,
        changedAt: '2026-06-20T12:00:00.000Z',
        changedBy: 'Profissional Sintético',
      }],
    }),
    session('s3', '2026-06-03', 'Realizada'),
  ];

  const responsible = buildResponsiblePackages(sessions, { today: '2026-06-20', payments: [{ patientId: 'patient-sintetico', amount: 1000, packageNumber: 1 }] });
  const packageSessions = responsible.packages[0].sessions;
  assert.equal(responsible.consumedTotal, 3);
  assert.deepEqual(packageSessions.map(item => [item.id, item.sessionNumber, item.consumesPackage]), [
    ['s1', 1, true],
    ['s2', 2, true],
    ['s3', 3, true],
  ]);
  assert.equal(packageSessions[1].noReplacementReasonText, REASON);
  assert.equal(packageSessions[1].noReplacementObservation, DEFAULT_NOTE);
});

test('novo status não gera card virtual nem sessão elegível para mídia', () => {
  const sessions = [
    session('s1', '2026-06-01', 'Realizada'),
    session('s2', '2026-06-02', STATUS, { consumesPackage: true }),
  ];
  const model = buildActivityMediaPackageModel(sessions, { patientId: 'patient-sintetico', now: NOW });
  assert.equal(model.consumedSessionCount, 2);
  assert.deepEqual(model.currentSessions.map(item => item.id), ['s1']);
  assert.equal(model.currentSessions.some(item => item.id === 's2'), false);

  const cards = buildGooglePhotosVirtualAlbumCards(sessions, {
    patientId: 'patient-sintetico',
    patientName: 'Paciente Sintético',
    now: NOW,
  });
  assert.deepEqual(cards.map(card => card.sessionIds), [['s1']]);
});

test('novo status não entra no monitoramento de mídia atrasada', async () => {
  const { resolveActivityUploadState } = await import('../shared/activityGalleryStatus.js');
  const result = resolveActivityUploadState({
    session: session('late', '2026-06-10', STATUS),
    monitoringStart: '2026-06-01T03:00:00.000Z',
    statusRecord: null,
    now: NOW,
  });
  assert.equal(result.state, 'not_applicable');
});

test('Agenda contém ação, motivos, observação sugerida, proteção administrativa e histórico estruturado', () => {
  const source = fs.readFileSync(new URL('../src/components/Agenda.tsx', import.meta.url), 'utf8');
  assert.match(source, /Registrar falta sem reposição/);
  assert.match(source, new RegExp(LABEL));
  assert.match(source, new RegExp(REASON));
  assert.match(source, new RegExp(DEFAULT_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /Ausência sem aviso/);
  assert.match(source, /Outro motivo previsto no contrato/);
  assert.match(source, /confirmedNoRealActivity/);
  assert.match(source, /não há link persistido, mídia real, card com conteúdo ou registro clínico/);
  assert.match(source, /noReplacementHistory/);
  assert.match(source, /previousStatus/);
  assert.match(source, /changedBy: currentUserName/);
  assert.match(source, /SessionStatus\.LATE_CANCELLATION_NO_REPLACEMENT/);
  assert.match(source, /actionSession\.status !== SessionStatus\.LATE_CANCELLATION_NO_REPLACEMENT/);
  assert.match(source, /#A94444/);
  assert.match(source, /#FFF4F4/);
});

test('Portal usa texto cordial e motivo discreto para o responsável', () => {
  const source = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  assert.match(source, new RegExp(PORTAL_LABEL));
  assert.match(source, new RegExp(REASON));
  assert.match(source, /NO_REPLACEMENT_SESSION_STATUS/);
  assert.match(source, /#A94444/);
  assert.doesNotMatch(source, /falta injustificada/i);
});

test('APIs de mídia e galeria recusam vínculo de mídia ou link para sessão sem reposição', () => {
  const activityRepository = fs.readFileSync(new URL('../api/_lib/activityRecordsRepository.js', import.meta.url), 'utf8');
  const albumRepository = fs.readFileSync(new URL('../api/_lib/googlePhotosAlbumsRepository.js', import.meta.url), 'utf8');
  assert.match(activityRepository, new RegExp(STATUS));
  assert.match(activityRepository, /invalid-session-status/);
  assert.match(albumRepository, /selectableById/);
  assert.match(albumRepository, /Os cards só podem usar sessões realizadas ou em andamento do pacote atual/);
});

test('financeiro, sequência e Portal reconhecem o status sem criar listener ou fluxo WhatsApp', () => {
  const financeSource = fs.readFileSync(new URL('../src/lib/financePackages.ts', import.meta.url), 'utf8');
  const sequenceSource = fs.readFileSync(new URL('../shared/sessionScheduling.js', import.meta.url), 'utf8');
  const agendaSource = fs.readFileSync(new URL('../src/components/Agenda.tsx', import.meta.url), 'utf8');
  assert.match(financeSource, /sessionConsumesPackage/);
  assert.match(financeSource, /shared\/sessionScheduling\.js/);
  assert.match(sequenceSource, /late_cancellation_no_replacement/);
  assert.doesNotMatch(agendaSource, /onSnapshot\s*\(/);
  assert.doesNotMatch(agendaSource, /send.*whats|whats.*send/i);
});

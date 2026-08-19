import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ACTIVITY_NO_MEDIA_REASON_OPTIONS,
  getActivityJustificationReasonLabel,
  normalizeActivityJustificationReason,
  resolveActivityUploadState,
} from '../shared/activityGalleryStatus.js';
import { buildUnregisteredActivityGroups } from '../shared/unregisteredActivities.js';
import { sessionAllowsActivity } from '../shared/sessionScheduling.js';

const MONITORING_START = '2026-08-01T00:00:00-03:00';

function session(id, status = 'Realizada') {
  return {
    id,
    patientId: 'patient-lote2',
    date: '2026-08-18',
    time: '10:00',
    status,
    type: 'Sessão simples (50 min)',
  };
}

function statusRecord(overrides = {}) {
  return {
    sessionId: 'session-lote2',
    patientId: 'patient-lote2',
    hasMedia: false,
    mediaCount: 0,
    justification: null,
    ...overrides,
  };
}

function unregisteredFixture(overrides = {}) {
  return {
    patients: [{ id: 'patient-lote2', name: 'Paciente sintético' }],
    sessions: [session('session-lote2')],
    payments: [],
    activityRecords: [],
    activityUploadStatus: [],
    googlePhotosAlbums: [],
    monitoringStart: '2026-08-01',
    now: new Date('2026-08-18T20:00:00-03:00'),
    ...overrides,
  };
}

test('R5-A/B/I: sessão Realizada sem mídia permanece waiting e depois overdue', () => {
  const waiting = resolveActivityUploadState({
    session: session('waiting'),
    monitoringStart: MONITORING_START,
    statusRecord: null,
    now: new Date('2026-08-18T20:00:00-03:00'),
  });
  const overdue = resolveActivityUploadState({
    session: session('overdue'),
    monitoringStart: MONITORING_START,
    statusRecord: null,
    now: new Date('2026-08-20T12:00:00-03:00'),
  });
  assert.equal(waiting.state, 'waiting');
  assert.equal(overdue.state, 'overdue');
  assert.equal(resolveActivityUploadState({
    session: session('legacy'),
    monitoringStart: MONITORING_START,
    statusRecord: {},
    now: new Date('2026-08-18T20:00:00-03:00'),
  }).state, 'waiting');
});

test('R5-C/D/E: justificativa ativa vira excused e sai da fonte global de pendências', () => {
  const justified = statusRecord({
    justification: { active: true, reason: 'responsible_accompanied', note: '' },
  });
  const resolved = resolveActivityUploadState({
    session: session('session-lote2'),
    monitoringStart: MONITORING_START,
    statusRecord: justified,
    now: new Date('2026-08-20T12:00:00-03:00'),
  });
  assert.equal(resolved.state, 'excused');
  assert.equal(buildUnregisteredActivityGroups(unregisteredFixture({ activityUploadStatus: [justified] })).length, 0);
});

test('R5-F/H: mídia posteriormente continua pendente até virar mídia ou ter justificativa removida', () => {
  const pending = resolveActivityUploadState({
    session: session('pending'),
    monitoringStart: MONITORING_START,
    statusRecord: { ...statusRecord(), justification: { active: false, reason: 'responsible_accompanied' } },
    now: new Date('2026-08-20T12:00:00-03:00'),
  });
  const sentAfterExcused = resolveActivityUploadState({
    session: session('sent-after-excused'),
    monitoringStart: MONITORING_START,
    statusRecord: statusRecord({
      hasMedia: true,
      mediaCount: 1,
      justification: { active: true, reason: 'responsible_accompanied' },
    }),
    now: new Date('2026-08-20T12:00:00-03:00'),
  });
  assert.equal(pending.state, 'overdue');
  assert.equal(sentAfterExcused.state, 'sent');
  assert.notEqual(sentAfterExcused.state, 'excused');
});

test('R5-J/K/L/M/N/O: Reposição usa a mesma elegibilidade canônica de mídia', () => {
  const replacement = session('replacement', 'Reposição');
  assert.equal(sessionAllowsActivity(replacement), true);
  assert.equal(resolveActivityUploadState({
    session: replacement,
    monitoringStart: MONITORING_START,
    statusRecord: statusRecord({ sessionId: replacement.id, hasMedia: true, mediaCount: 1 }),
    now: new Date('2026-08-18T20:00:00-03:00'),
  }).state, 'sent');
  assert.equal(resolveActivityUploadState({
    session: replacement,
    monitoringStart: MONITORING_START,
    statusRecord: statusRecord({ sessionId: replacement.id }),
    now: new Date('2026-08-18T20:00:00-03:00'),
  }).state, 'waiting');
  assert.equal(resolveActivityUploadState({
    session: replacement,
    monitoringStart: MONITORING_START,
    statusRecord: statusRecord({ sessionId: replacement.id }),
    now: new Date('2026-08-20T12:00:00-03:00'),
  }).state, 'overdue');
  assert.equal(resolveActivityUploadState({
    session: replacement,
    monitoringStart: MONITORING_START,
    statusRecord: statusRecord({ sessionId: replacement.id, justification: { active: true, reason: 'technical_issue' } }),
    now: new Date('2026-08-20T12:00:00-03:00'),
  }).state, 'excused');

  const repository = fs.readFileSync(new URL('../api/_lib/activityGalleryRepository.js', import.meta.url), 'utf8');
  assert.match(repository, /sessionAllowsActivity\(session\)/);
  assert.doesNotMatch(repository, /model\.currentSessions\.filter\(session => session\.status === 'Realizada'\)/);
});

test('R5 motivos: códigos estáveis têm labels amigáveis e legado é lido sem migração', () => {
  assert.deepEqual(ACTIVITY_NO_MEDIA_REASON_OPTIONS.map(option => option.code), [
    'responsible_accompanied',
    'activity_without_media',
    'recording_not_authorized',
    'professional_opted_out',
    'no_recording_opportunity',
    'technical_issue',
    'other',
  ]);
  assert.equal(getActivityJustificationReasonLabel('responsible_accompanied'), 'Responsável acompanhou a sessão');
  assert.equal(normalizeActivityJustificationReason('responsável não autorizou'), 'recording_not_authorized');
  assert.equal(normalizeActivityJustificationReason('mídia será adicionada posteriormente'), '');
});

test('R5 regressão: fluxo ativo mantém Google Photos/links e oferece ação separada sem tocar Financeiro', () => {
  const gallery = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  const finance = fs.readFileSync(new URL('../src/components/Finance.tsx', import.meta.url), 'utf8');
  const portal = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  const unregistered = fs.readFileSync(new URL('../shared/unregisteredActivities.js', import.meta.url), 'utf8');
  assert.match(gallery, /Criar álbum no Google Fotos/);
  assert.match(gallery, /Adicionar link/);
  assert.match(gallery, /Registrar sessão sem mídia/);
  assert.match(gallery, /window\.confirm/);
  assert.match(gallery, /noMediaBusyRef/);
  assert.match(unregistered, /activityUploadStatus/);
  assert.match(portal, /ResponsibleGooglePhotosGallery/);
  assert.doesNotMatch(finance, /Registrar sessão sem mídia/);
});

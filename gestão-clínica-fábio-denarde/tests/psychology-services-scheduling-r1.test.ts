import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  createPsychologyRemotePatientClient,
} from '../src/features/psychology-persistence/remotePatientClient';
import { createPsychologyPersistenceScope } from '../src/features/psychology-persistence/scope';
import {
  createPsychologyScope,
  upsertPsychologySession,
  validatePsychologySession,
} from '../src/features/psychology-pilot/psychologyDomain';

const scope = createPsychologyPersistenceScope('professional-leila', 'workspace-leila');
const legacyScope = createPsychologyScope(scope.professionalId);
const now = '2026-08-24T12:00:00.000Z';

const patient = {
  id: 'patient-r1',
  workspaceId: scope.workspaceId,
  professionalId: scope.professionalId,
  context: scope.context,
  name: 'Paciente sintético R1',
  birthDate: '1990-01-01',
  phone: '27999990000',
  preferredModality: 'presencial',
  active: true,
  createdAt: now,
  updatedAt: now,
};

const remoteSettings = {
  scope: { professionalId: scope.professionalId, context: scope.context },
  agenda: { defaultDurationMinutes: 50 },
  professionalProfile: { displayName: 'Profissional sintética', professionalTitle: 'Psicologia' },
  locations: [{
    id: 'location-r1',
    professionalId: scope.professionalId,
    context: scope.context,
    type: 'PRIMARY_OFFICE',
    displayName: 'Local sintético',
    active: true,
    isPrimary: true,
    color: '#DC2626',
    createdAt: now,
    updatedAt: now,
  }],
  services: [
    {
      id: 'psychotherapy-individual',
      name: 'Psicoterapia Individual',
      defaultDurationMinutes: 50,
      modality: 'BOTH',
      active: true,
      publicBooking: { active: false, onlineEnabled: false, inPersonEnabled: false, allowedLocationIds: [], sortOrder: 1 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'therapy-couple',
      name: 'Terapia de Casal',
      defaultDurationMinutes: 50,
      modality: 'BOTH',
      // Legacy snapshots may omit active; internal use defaults to active.
      publicBooking: { active: true, onlineEnabled: true, inPersonEnabled: true, allowedLocationIds: ['location-r1'], sortOrder: 2 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'service-online-only-r1',
      name: 'Serviço online sintético',
      defaultDurationMinutes: 60,
      modality: 'ONLINE',
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'service-inactive-r1',
      name: 'Serviço inativo sintético',
      defaultDurationMinutes: 50,
      modality: 'BOTH',
      active: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'service-other-professional-r1',
      name: 'Outro profissional',
      professionalId: 'professional-other',
      context: scope.context,
      defaultDurationMinutes: 50,
      modality: 'BOTH',
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'service-other-context-r1',
      name: 'Outro contexto',
      professionalId: scope.professionalId,
      context: 'OUTRO_CONTEXTO',
      defaultDurationMinutes: 50,
      modality: 'BOTH',
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ],
  updatedAt: now,
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createRemoteClient() {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/patients')) return jsonResponse({ scope, items: [patient] });
    if (url.endsWith('/sessions')) return jsonResponse({ scope, items: [] });
    if (url.endsWith('/settings')) {
      return jsonResponse({
        scope,
        settings: {
          id: 'settings',
          workspaceId: scope.workspaceId,
          professionalId: scope.professionalId,
          context: scope.context,
          settings: remoteSettings,
          updatedAt: now,
        },
      });
    }
    throw new Error(`Rota sintética inesperada: ${url}`);
  };
  return {
    requests,
    client: createPsychologyRemotePatientClient({
      scope,
      api: { fetchImpl, getToken: async () => 'synthetic-token' },
    }),
  };
}

test('R1 — hidratação remota preserva serviços internos no diálogo de nova sessão', async () => {
  const remote = createRemoteClient();
  const first = await remote.client.load();
  const activeServices = first.settings.services.filter(service => service.active);

  assert.deepEqual(activeServices.map(service => service.id), [
    'psychotherapy-individual',
    'therapy-couple',
    'service-online-only-r1',
  ]);
  assert.equal(activeServices.some(service => service.id === 'service-inactive-r1'), false);
  assert.equal(first.settings.services.some(service => service.id === 'service-other-professional-r1'), false);
  assert.equal(first.settings.services.some(service => service.id === 'service-other-context-r1'), false);
  assert.equal(first.settings.services.filter(service => service.id === 'psychotherapy-individual').length, 1);
  assert.equal(first.settings.services.find(service => service.id === 'psychotherapy-individual')?.publicBooking?.active, false);
  assert.equal(first.settings.locations[0]?.id, 'location-r1');
  assert.equal(first.settings.services.every(service => service.professionalId === legacyScope.professionalId && service.context === legacyScope.context), true);

  const selected = first.settings.services.find(service => service.id === 'therapy-couple');
  assert.ok(selected);
  if (!selected) return;
  const validPresential = {
    patientId: patient.id,
    date: '2026-08-27',
    time: '10:00',
    durationMinutes: selected.defaultDurationMinutes,
    modality: 'presencial' as const,
    serviceId: selected.id,
    locationId: first.settings.locations[0]?.id,
    locationType: first.settings.locations[0]?.type,
    administrativeNote: '',
  };
  assert.equal(validatePsychologySession(validPresential, first, { requireService: true }), null);
  const savedPresential = upsertPsychologySession(first, validPresential, 'session-r1-presential');
  assert.equal(savedPresential.sessions[0]?.durationMinutes, 50);
  assert.equal(savedPresential.sessions[0]?.locationId, 'location-r1');

  const onlineOnly = first.settings.services.find(service => service.id === 'service-online-only-r1');
  assert.ok(onlineOnly);
  if (!onlineOnly) return;
  assert.equal(validatePsychologySession({ ...validPresential, serviceId: onlineOnly.id, durationMinutes: 60 }, first, { requireService: true }), 'O serviço selecionado não atende esta modalidade.');
  const onlineInput = { ...validPresential, serviceId: onlineOnly.id, durationMinutes: 60, modality: 'online' as const, locationId: undefined, locationType: undefined, time: '11:00' };
  assert.equal(validatePsychologySession(onlineInput, first, { requireService: true }), null);
  const savedOnline = upsertPsychologySession(first, onlineInput, 'session-r1-online');
  assert.equal(savedOnline.sessions[0]?.durationMinutes, 60);
  assert.equal(savedOnline.sessions[0]?.locationId, undefined);

  const reloaded = await remote.client.load();
  assert.deepEqual(reloaded.settings.services.map(service => service.id), first.settings.services.map(service => service.id));
  assert.equal(remote.requests.filter(url => url.endsWith('/settings')).length, 2);
});
test('R1 — o seletor interno usa settings.services e não a publicação online', async () => {
  const pilot = await readFile(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const eventDialogStart = pilot.indexOf('function EventCreationDialog');
  const eventDialogEnd = pilot.indexOf('function HistoricalEventCreationDialog');
  const eventDialog = pilot.slice(eventDialogStart, eventDialogEnd);
  assert.match(eventDialog, /const servicesForModality = settings\.services\.filter\(service => service\.active/);
  assert.doesNotMatch(eventDialog, /servicesForModality[\s\S]*publicBooking/);
  assert.match(eventDialog, /durationMinutes: service\?\.defaultDurationMinutes \|\| sessionForm\.durationMinutes/);
  assert.match(eventDialog, /const updateModality = \(modality: PsychologyModality\)/);
  assert.match(eventDialog, /locationId: nextLocation\?\.id/);
  assert.match(eventDialog, /settings\.locations\.filter\(location => location\.active\)/);
});

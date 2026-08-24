import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  createDefaultPsychologySettings,
  normalizePsychologySettings,
} from '../src/features/psychology-pilot/psychologyR2a';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  upsertPsychologyPatient,
  upsertPsychologySession,
  validatePsychologySession,
} from '../src/features/psychology-pilot/psychologyDomain';

const scope = createPsychologyScope('professional-leila');
const now = '2026-08-24T12:00:00.000Z';

function settingsWithLegacyServices() {
  const defaults = createDefaultPsychologySettings(scope, now);
  return normalizePsychologySettings({
    ...defaults,
    agenda: { ...defaults.agenda, defaultDurationMinutes: 50 },
    locations: [{
      ...defaults.locations[0],
      id: 'location-r1',
      displayName: 'Local sintético',
      active: true,
      isPrimary: true,
    }],
    services: [
      {
        id: 'psychotherapy-individual',
        name: 'Psicoterapia Individual',
        defaultDurationMinutes: 50,
        modality: 'BOTH',
        active: true,
        publicBooking: { active: false, onlineEnabled: false, inPersonEnabled: false, allowedLocationIds: [], sortOrder: 1 },
      },
      {
        id: 'therapy-couple',
        name: 'Terapia de Casal',
        defaultDurationMinutes: 50,
        modality: 'BOTH',
        publicBooking: { active: true, onlineEnabled: true, inPersonEnabled: true, allowedLocationIds: ['location-r1'], sortOrder: 2 },
      },
      {
        id: 'service-online-only-r1',
        name: 'Serviço online sintético',
        defaultDurationMinutes: 60,
        modality: 'ONLINE',
        active: true,
      },
      {
        id: 'service-inactive-r1',
        name: 'Serviço inativo sintético',
        defaultDurationMinutes: 50,
        modality: 'BOTH',
        active: false,
      },
      {
        id: 'service-other-professional-r1',
        name: 'Outro profissional',
        professionalId: 'professional-other',
        context: scope.context,
        defaultDurationMinutes: 50,
        modality: 'BOTH',
        active: true,
      },
      {
        id: 'service-other-context-r1',
        name: 'Outro contexto',
        professionalId: scope.professionalId,
        context: 'OUTRO_CONTEXTO',
        defaultDurationMinutes: 50,
        modality: 'BOTH',
        active: true,
      },
    ],
  }, scope, now);
}

test('R1 — serviços legados hidratam o seletor interno e preservam escopo/modalidade', () => {
  const settings = settingsWithLegacyServices();
  const activeServices = settings.services.filter(service => service.active);

  assert.deepEqual(activeServices.map(service => service.id), [
    'psychotherapy-individual',
    'therapy-couple',
    'service-online-only-r1',
  ]);
  assert.equal(settings.services.some(service => service.id === 'service-other-professional-r1'), false);
  assert.equal(settings.services.some(service => service.id === 'service-other-context-r1'), false);
  assert.equal(settings.services.find(service => service.id === 'psychotherapy-individual')?.publicBooking?.active, false);
  assert.equal(settings.services.every(service => service.professionalId === scope.professionalId && service.context === scope.context), true);

  const store = { ...createEmptyPsychologyStore(scope), settings, services: settings.services, locations: settings.locations };
  const withPatient = upsertPsychologyPatient(store, {
    name: 'Paciente sintético R1',
    birthDate: '1990-01-01',
    phone: '27999990000',
    email: 'paciente.r1@synthetic.test',
    preferredModality: 'presencial',
    administrativeNote: '',
    active: true,
  }, 'patient-r1', now);
  const service = settings.services.find(item => item.id === 'therapy-couple');
  assert.ok(service);
  if (!service) return;
  const sessionInput = {
    patientId: 'patient-r1',
    date: '2026-08-27',
    time: '10:00',
    durationMinutes: service.defaultDurationMinutes,
    modality: 'presencial' as const,
    serviceId: service.id,
    locationId: 'location-r1',
    locationType: settings.locations[0]?.type,
    administrativeNote: '',
  };
  assert.equal(validatePsychologySession(sessionInput, withPatient, { requireService: true }), null);
  const saved = upsertPsychologySession(withPatient, sessionInput, 'session-r1', now);
  assert.equal(saved.sessions[0]?.durationMinutes, 50);
  assert.equal(saved.sessions[0]?.locationId, 'location-r1');
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

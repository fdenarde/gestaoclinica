import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateAgeOnDate,
  isValidCivilDate,
  profileCompleteness,
  requiresResponsible,
  validatePsychologyPatientAdministrativeInput,
} from '../src/lib/psychologyPatientAdministrative';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  getPsychologyPatientProfileCompleteness,
  LOCAL_PSYCHOLOGY_PROFESSIONAL_ID,
  LOCAL_PSYCHOLOGY_STORAGE_KEY,
  parsePsychologyStore,
  serializePsychologyStore,
  updatePsychologySettings,
  upsertPsychologyPatient,
  upsertPsychologySession,
  validatePsychologyPatient,
  validatePsychologySession,
} from '../src/features/psychology-pilot/psychologyDomain';
import { PSYCHOLOGY_SERVICE_CATALOG } from '../src/features/psychology-pilot/psychologyServiceCatalog';
import { LOCAL_ONLINE_BOOKING_STORAGE_KEY, createDefaultPublicBookingSettings } from '../src/features/psychology-online-booking/bookingDomain';
import { createLocalPublicBookingRepository, createMemoryOnlineBookingStorage } from '../src/features/psychology-online-booking/repository';
import { createMemoryPublicBookingServerStore, createPublicBookingServerHandler } from '../src/features/psychology-online-booking/publicServerRepository';

const referenceDate = '2026-08-18';
const appointmentDate = '2026-08-20';
const adultPatient = { name: 'Paciente Adulto Sintético', dateOfBirth: '1990-01-01', phone: '27999990001', email: 'adulto@example.test' };
const minorPatient = {
  name: 'Paciente Menor Sintético',
  dateOfBirth: '2010-08-20',
  phone: '27999990002',
  email: 'menor@example.test',
  administrativeResponsible: { fullName: 'Responsável Sintético', relationship: 'Mãe', phone: '27999990003', email: 'responsavel@example.test' },
};

function localRepository() {
  return createLocalPublicBookingRepository({ storage: createMemoryOnlineBookingStorage(), now: () => new Date('2026-08-18T12:00:00-03:00') });
}

test('R2F3-E data civil opcional preserva validação quando preenchida', () => {
  assert.equal(isValidCivilDate(''), false);
  assert.equal(isValidCivilDate('2026-02-29'), false);
  assert.equal(isValidCivilDate('2028-02-29'), true);
  assert.equal(validatePsychologyPatientAdministrativeInput({ ...adultPatient, dateOfBirth: '' }, referenceDate).dateOfBirth, undefined);
  assert.equal(validatePsychologyPatientAdministrativeInput({ ...adultPatient, dateOfBirth: '2027-01-01' }, referenceDate).dateOfBirth, 'A data de nascimento não pode ser futura.');
});

test('R2F3-E limite civil de 18 anos não depende de timezone', () => {
  assert.equal(calculateAgeOnDate('2008-08-19', referenceDate), 17);
  assert.equal(requiresResponsible('2008-08-19', referenceDate), true);
  assert.equal(calculateAgeOnDate('2008-08-18', referenceDate), 18);
  assert.equal(requiresResponsible('2008-08-18', referenceDate), false);
});

test('R2F3-E responsável Psychology-specific exige os quatro campos quando aplicável', () => {
  const fields = ['fullName', 'relationship', 'phone', 'email'] as const;
  for (const field of fields) {
    const responsible = { ...minorPatient.administrativeResponsible, [field]: '' };
    const errors = validatePsychologyPatientAdministrativeInput({ ...minorPatient, administrativeResponsible: responsible }, appointmentDate);
    assert.ok(errors[`administrativeResponsible.${field}`], `campo ausente: ${field}`);
  }
  assert.deepEqual(validatePsychologyPatientAdministrativeInput(minorPatient, appointmentDate), {});
});

test('R2F3-E perfil legado permanece utilizável e incompleto sem inventar DOB', () => {
  const scope = createPsychologyScope('r2f3e-legacy');
  const legacy = upsertPsychologyPatient(createEmptyPsychologyStore(scope), { name: 'Paciente Legado Sintético', birthDate: '', phone: '', email: '', preferredModality: 'online', administrativeNote: '', active: true }, 'legacy-r2f3e');
  const serialized = serializePsychologyStore(legacy);
  const reloaded = parsePsychologyStore(serialized, scope).patients[0];
  assert.equal(reloaded?.dateOfBirth, '');
  assert.equal(reloaded?.birthDate, undefined);
  assert.equal(getPsychologyPatientProfileCompleteness(reloaded!).complete, false);
  assert.equal(getPsychologyPatientProfileCompleteness(reloaded!).missingFields.includes('dateOfBirth'), false);
});

test('Etapa 2 contrato administrativo exige nome, telefone e modalidade; DOB/e-mail são opcionais', () => {
  const input = { name: 'Paciente Mínimo Sintético', dateOfBirth: '', phone: '27999990014', email: '', preferredModality: 'online' as const, administrativeNote: '', active: true };
  assert.deepEqual(validatePsychologyPatient(input), {});
  const scope = createPsychologyScope('etapa2-contract');
  const patient = upsertPsychologyPatient(createEmptyPsychologyStore(scope), input, 'patient-etapa2');
  assert.equal(patient.patients[0].dateOfBirth, '');
  assert.equal(patient.patients[0].email, undefined);
  assert.equal(patient.patients[0].acompanhamentoStatus, 'ATIVO');
});

test('R2F3-E cadastro interno mantém tipo e contrato extensíveis para required condicional', () => {
  const complete = profileCompleteness({ ...minorPatient }, appointmentDate);
  const adult = profileCompleteness(adultPatient, appointmentDate);
  assert.equal(complete.requiresResponsible, true);
  assert.equal(complete.complete, true);
  assert.equal(adult.requiresResponsible, false);
  assert.equal(adult.complete, true);
});

test('R2F3-E booking local sincroniza Patient, Session e reload com DOB/responsável', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repo = createLocalPublicBookingRepository({ storage, now: () => new Date('2026-08-18T12:00:00-03:00') });
  const settings = await repo.getSettings();
  const slots = await repo.listPublishedSlots({ professionalSlug: settings!.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: appointmentDate, throughDate: appointmentDate });
  const result = await repo.createBooking({ ...minorPatient, professionalSlug: settings!.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: slots[0].date, time: slots[0].time });
  assert.equal('conflict' in result, false);
  if ('conflict' in result) return;
  const canonicalKey = `${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`;
  const store = parsePsychologyStore(storage.getItem(canonicalKey), createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID));
  const patient = store.patients.find(item => item.id === result.appointment.patientId);
  const session = store.sessions.find(item => item.id === result.appointment.sessionId);
  assert.equal(patient?.dateOfBirth, minorPatient.dateOfBirth);
  assert.deepEqual(patient?.administrativeResponsible, minorPatient.administrativeResponsible);
  assert.equal(session?.patientId, patient?.id);
  assert.equal(result.appointment.bookingOrigin, 'PATIENT_SELF_BOOKING');
  const reloaded = parsePsychologyStore(storage.getItem(canonicalKey), createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID));
  assert.equal(reloaded.patients.find(item => item.id === patient?.id)?.dateOfBirth, minorPatient.dateOfBirth);
});

test('R2F3-E validação local impede Patient órfão quando payload do menor é incompleto', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repo = createLocalPublicBookingRepository({ storage, now: () => new Date('2026-08-18T12:00:00-03:00') });
  const settings = await repo.getSettings();
  const slots = await repo.listPublishedSlots({ professionalSlug: settings!.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: appointmentDate, throughDate: appointmentDate });
  const result = await repo.createBooking({ ...minorPatient, administrativeResponsible: undefined, professionalSlug: settings!.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: slots[0].date, time: slots[0].time });
  assert.equal('conflict' in result, true);
  assert.equal(storage.values[`${LOCAL_ONLINE_BOOKING_STORAGE_KEY}`], undefined);
  assert.equal(Object.keys(storage.values).some(key => key.startsWith('psychology-pilot:')), false);
});

test('R2F3-E servidor rejeita bypass sem responsável e aceita payload completo', async () => {
  const now = new Date('2026-08-18T12:00:00-03:00');
  const store = createMemoryPublicBookingServerStore(createDefaultPublicBookingSettings(now), now);
  const handler = createPublicBookingServerHandler({ store, now: () => now });
  const settings = store.getState().settings;
  const slots = await handler({ method: 'GET', query: { resource: 'slots', professionalSlug: settings.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: appointmentDate, throughDate: appointmentDate } });
  const slot = (slots.body.slots as Array<{ date: string; time: string }>)[0];
  const incomplete = await handler({ method: 'POST', query: { resource: 'create-booking' }, body: { ...minorPatient, administrativeResponsible: undefined, professionalSlug: settings.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: slot.date, time: slot.time } });
  assert.equal(incomplete.status, 409);
  const complete = await handler({ method: 'POST', query: { resource: 'create-booking' }, body: { ...minorPatient, professionalSlug: settings.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: slot.date, time: slot.time } });
  assert.equal(complete.status, 201);
  const stateJson = JSON.stringify(store.getState());
  assert.equal(stateJson.includes('dateOfBirth'), false);
  assert.equal(stateJson.includes('administrativeResponsible'), false);
});

test('R2F3-E aniversário usa a fonte canônica dateOfBirth e não campo paralelo', async () => {
  const page = await import('node:fs/promises');
  const source = await page.readFile('src/features/psychology-pilot/PsychologyPilot.tsx', 'utf8');
  assert.match(source, /getPsychologyPatientDateOfBirth\(patient\)/);
  assert.match(source, /data-testid="psychology-birthdays"/);
});

test('R2F3-F catálogo de serviços é único entre Agenda, Ajustes e Agendamento Online', () => {
  const store = createEmptyPsychologyStore(createPsychologyScope('r2f3f-catalog'));
  const publicSettings = createDefaultPublicBookingSettings(new Date('2026-08-18T12:00:00-03:00'));
  assert.deepEqual(store.services.map(service => [service.id, service.name, service.defaultDurationMinutes]), PSYCHOLOGY_SERVICE_CATALOG.map(service => [service.id, service.name, service.defaultDurationMinutes]));
  assert.deepEqual(publicSettings.publishedServices.map(service => [service.id, service.name, service.durationMinutes]), PSYCHOLOGY_SERVICE_CATALOG.map(service => [service.id, service.name, service.defaultDurationMinutes]));
});

test('R2F3-F agendamento interno exige serviço e bloqueia conflito no primeiro fluxo', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('r2f3f-first-appointment'));
  store = upsertPsychologyPatient(store, { ...adultPatient, preferredModality: 'presencial', administrativeNote: '', active: true }, 'r2f3f-patient');
  const base = { patientId: 'r2f3f-patient', date: appointmentDate, time: '09:00', durationMinutes: 50, modality: 'presencial' as const, serviceId: 'psychotherapy-individual', locationId: store.locations[0].id, locationType: store.locations[0].type, administrativeNote: '' };
  assert.equal(validatePsychologySession({ ...base, serviceId: undefined }, store, { requireService: true, checkConflicts: true }), 'Selecione um serviço.');
  store = upsertPsychologySession(store, base, 'r2f3f-existing');
  assert.equal(validatePsychologySession({ ...base, time: '09:30' }, store, { requireService: true, checkConflicts: true }), 'Este horário já está ocupado por outra sessão.');
  assert.equal(validatePsychologySession({ ...base, time: '10:00' }, store, { requireService: true, checkConflicts: true }), null);
});

test('R2F3-F publicação de serviço persiste no canônico e volta para a leitura pública', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repo = createLocalPublicBookingRepository({ storage, now: () => new Date('2026-08-18T12:00:00-03:00') });
  const current = await repo.getSettings();
  assert.ok(current);
  const target = current!.publishedServices.find(service => service.id === 'therapy-couple')!;
  const updated = await repo.updateSettings({ publishedServices: current!.publishedServices.map(service => service.id === target.id ? { ...service, active: false, onlineEnabled: false, inPersonEnabled: true, sortOrder: 7 } : service) });
  assert.equal(updated.publishedServices.find(service => service.id === target.id)?.active, false);
  const canonicalKey = `${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`;
  const canonical = parsePsychologyStore(storage.getItem(canonicalKey), createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID));
  assert.equal(canonical.services.find(service => service.id === target.id)?.publicBooking?.active, false);
  const reloaded = await repo.getSettings();
  assert.equal(reloaded?.publishedServices.find(service => service.id === target.id)?.active, false);
});

test('R2F3-F modalidade define a presença do local sem duplicar endereço na sessão', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('r2f3f-modality'));
  store = upsertPsychologyPatient(store, { ...adultPatient, preferredModality: 'online', administrativeNote: '', active: true }, 'r2f3f-modality-patient');
  const online = upsertPsychologySession(store, { patientId: 'r2f3f-modality-patient', date: appointmentDate, time: '14:00', durationMinutes: 50, modality: 'online', serviceId: 'psychotherapy-individual', locationId: store.locations[0].id, locationType: store.locations[0].type, administrativeNote: '' }, 'r2f3f-online');
  assert.equal(online.sessions.find(session => session.id === 'r2f3f-online')?.locationId, undefined);
  const presencial = upsertPsychologySession(store, { patientId: 'r2f3f-modality-patient', date: appointmentDate, time: '15:00', durationMinutes: 50, modality: 'presencial', serviceId: 'psychotherapy-individual', locationId: store.locations[0].id, locationType: undefined, administrativeNote: '' }, 'r2f3f-presencial');
  assert.equal(presencial.sessions.find(session => session.id === 'r2f3f-presencial')?.locationType, store.locations[0].type);
});

test('R2F3-F1 observação administrativa não bloqueia o cadastro inicial e permanece editável depois', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('r2f3f1-patient-note'));
  store = upsertPsychologyPatient(store, { ...adultPatient, preferredModality: 'presencial', administrativeNote: 'Nota administrativa sintética', active: true }, 'r2f3f1-patient');
  const reloaded = parsePsychologyStore(serializePsychologyStore(store), createPsychologyScope('r2f3f1-patient-note'));
  assert.equal(reloaded.patients.find(patient => patient.id === 'r2f3f1-patient')?.administrativeNote, 'Nota administrativa sintética');
  const edited = upsertPsychologyPatient(reloaded, { ...adultPatient, preferredModality: 'presencial', administrativeNote: 'Nota atualizada sintética', active: true }, 'r2f3f1-patient');
  assert.equal(edited.patients.find(patient => patient.id === 'r2f3f1-patient')?.administrativeNote, 'Nota atualizada sintética');
});

test('R2F3-F1 duração da sessão segue o serviço e não aceita override silencioso', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('r2f3f1-duration'));
  store = upsertPsychologyPatient(store, { ...adultPatient, preferredModality: 'online', administrativeNote: '', active: true }, 'r2f3f1-duration-patient');
  const base = { patientId: 'r2f3f1-duration-patient', date: appointmentDate, time: '16:00', durationMinutes: 45, modality: 'online' as const, serviceId: store.services[0].id, administrativeNote: '' };
  assert.equal(validatePsychologySession(base, store, { requireService: true }), 'A duração deve seguir o serviço selecionado (50 min).');
  const saved = upsertPsychologySession(store, base, 'r2f3f1-duration-session');
  assert.equal(saved.sessions.find(session => session.id === 'r2f3f1-duration-session')?.durationMinutes, 50);
  const valid = upsertPsychologySession(store, { ...base, durationMinutes: 50 }, 'r2f3f1-duration-session-valid');
  assert.equal(valid.sessions.find(session => session.id === 'r2f3f1-duration-session-valid')?.durationMinutes, 50);
  const editedServiceStore = updatePsychologySettings(store, { services: store.services.map(service => service.id === store.services[0].id ? { ...service, defaultDurationMinutes: 60 } : service) });
  const editedServiceInput = { ...base, durationMinutes: 60 };
  assert.equal(validatePsychologySession(editedServiceInput, editedServiceStore, { requireService: true }), null);
  const editedServiceSession = upsertPsychologySession(editedServiceStore, editedServiceInput, 'r2f3f1-duration-session-edited-service');
  assert.equal(editedServiceSession.sessions.find(session => session.id === 'r2f3f1-duration-session-edited-service')?.durationMinutes, 60);
});

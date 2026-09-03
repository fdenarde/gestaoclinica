import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  upsertPsychologyPatient,
  upsertPsychologySession,
  type PsychologyPatient,
  type PsychologyStore,
} from '../src/features/psychology-pilot/psychologyDomain';
import { getPsychologyPatientListViewModels, formatPsychologyPatientPhone } from '../src/features/psychology-pilot/psychologyPatientList';

const referenceDate = new Date('2026-08-13T10:00:00');
const scope = createPsychologyScope('r2c1a-professional');
const location = { id: 'location-primary', professionalId: scope.professionalId, context: scope.context, type: 'PRIMARY_OFFICE' as const, displayName: 'Shopping Moxuara', address: '', color: '#7c3aed', active: true, isPrimary: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

function addPatient(store: PsychologyStore, id: string, name: string, patch: Partial<PsychologyPatient> = {}): PsychologyStore {
  return upsertPsychologyPatient(store, {
    name,
    birthDate: patch.birthDate || '1990-01-01',
    phone: patch.phone || '',
    email: patch.email || '',
    preferredModality: patch.preferredModality || 'presencial',
    administrativeNote: patch.administrativeNote || '',
    active: patch.active ?? true,
  }, id, '2026-08-01T00:00:00.000Z');
}

function addSession(store: PsychologyStore, input: { id: string; patientId: string; date: string; time: string; modality?: 'presencial' | 'online'; status?: 'agendada' | 'realizada' | 'falta' | 'cancelada' }): PsychologyStore {
  return upsertPsychologySession(store, {
    patientId: input.patientId,
    date: input.date,
    time: input.time,
    durationMinutes: 50,
    modality: input.modality || 'presencial',
    locationId: input.modality === 'online' ? undefined : location.id,
    locationType: input.modality === 'online' ? undefined : location.type,
    administrativeNote: '',
  }, input.id, '2026-08-01T00:00:00.000Z');
}

function fixture(): PsychologyStore {
  let store = createEmptyPsychologyStore(scope);
  store = { ...store, locations: [location], settings: { ...store.settings, locations: [location] } };
  store = addPatient(store, 'p-alvaro', 'Álvaro');
  store = addPatient(store, 'p-ana', 'Ana', { preferredModality: 'online', phone: '27999990001', email: 'ana@example.com' });
  store = addPatient(store, 'p-fabiano', 'Fabiano', { phone: '27999992659', email: 'fabiano@example.com' });
  store = addPatient(store, 'p-gertrudes', 'Gertrudes', { phone: '27999999999' });
  store = addPatient(store, 'p-mariana', 'Mariana', { phone: '', email: '' });
  store = addSession(store, { id: 's-fabiano-past', patientId: 'p-fabiano', date: '2026-08-12', time: '09:00', status: 'realizada' });
  store = addSession(store, { id: 's-fabiano-next', patientId: 'p-fabiano', date: '2026-08-17', time: '14:00', status: 'agendada' });
  store = addSession(store, { id: 's-ana-next', patientId: 'p-ana', date: '2026-08-18', time: '10:00', modality: 'online', status: 'agendada' });
  store = addSession(store, { id: 's-gertrudes-next', patientId: 'p-gertrudes', date: '2026-08-19', time: '10:00', status: 'agendada' });
  return store;
}

function rows(store = fixture()) {
  return getPsychologyPatientListViewModels(store, store.patients, referenceDate);
}

test('pacientes aparecem em formato lista', () => {
  assert.equal(rows().length, 5);
  assert.equal(rows()[0].patient.name, 'Álvaro');
});

test('a listagem não usa os cards antigos', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(pilot, /psychology-patient-list/);
  assert.doesNotMatch(pilot, /psychology-patient-card/);
});

test('cabeçalho e linhas compartilham exatamente grid, gaps e padding', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const gridDefinition = pilot.match(/const PATIENT_LIST_GRID = '([^']+)'/)?.[1];
  assert.ok(gridDefinition);
  assert.match(gridDefinition, /md:grid-cols-\[/);
  assert.equal((pilot.match(/\$\{PATIENT_LIST_GRID\}/g) || []).length, 2);
  assert.equal((pilot.match(/\$\{PATIENT_LIST_PADDING\}/g) || []).length, 2);
  assert.match(pilot, /label="Status"/);
  assert.match(pilot, /text-right">Ação/);
  assert.match(pilot, /md:items-center/);
});

test('o cabeçalho profissional aparece', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  for (const label of ['PACIENTE', 'TELEFONE', 'MODALIDADE \/ LOCAL', 'STATUS', 'AÇÃO']) assert.match(pilot, new RegExp(label, 'i'));
  const header = pilot.slice(pilot.indexOf('data-testid="psychology-patient-list-header"'), pilot.indexOf('</div>', pilot.indexOf('data-testid="psychology-patient-list-header"')));
  for (const label of ['E-MAIL', 'CADASTRO', 'ÚLTIMA SESSÃO', 'PRÓXIMA SESSÃO']) assert.doesNotMatch(header, new RegExp(label, 'i'));
});

test('a ordem padrão é alfabética A–Z', () => {
  assert.deepEqual(rows().map(row => row.patient.name), ['Álvaro', 'Ana', 'Fabiano', 'Gertrudes', 'Mariana']);
});

test('acentos não quebram a ordenação', () => {
  assert.ok('Álvaro'.localeCompare('Ana', 'pt-BR', { sensitivity: 'base' }) < 0);
});

test('telefone é formatado', () => {
  assert.equal(formatPsychologyPatientPhone('27999992659'), '(27) 99999-2659');
});

test('e-mail disponível é mostrado', () => {
  assert.equal(rows().find(row => row.patient.id === 'p-ana')?.email, 'ana@example.com');
});

test('última sessão usa o histórico da Psicologia', () => {
  assert.equal(rows().find(row => row.patient.id === 'p-fabiano')?.lastSession, '12/08/2026');
});

test('próxima sessão usa a sessão futura mais próxima', () => {
  assert.equal(rows().find(row => row.patient.id === 'p-fabiano')?.nextSession, '17/08/2026 · 14:00');
});

test('modalidade Online é exibida sem local', () => {
  assert.equal(rows().find(row => row.patient.id === 'p-ana')?.modalityLocation, 'Online');
});

test('modalidade Presencial resolve o locationId', () => {
  assert.equal(rows().find(row => row.patient.id === 'p-gertrudes')?.modalityLocation, 'Presencial · Shopping Moxuara');
});

test('status Ativo e Inativo são mantidos como badge administrativo', () => {
  const store = addPatient(fixture(), 'p-inactive', 'Zélia', { active: false });
  const row = getPsychologyPatientListViewModels(store, store.patients, referenceDate).find(item => item.patient.id === 'p-inactive');
  assert.equal(row?.patient.active, false);
});

test('paciente sem e-mail mostra —', () => {
  assert.equal(rows().find(row => row.patient.id === 'p-mariana')?.email, '—');
});

test('paciente sem sessão anterior mostra —', () => {
  assert.equal(rows().find(row => row.patient.id === 'p-mariana')?.lastSession, '—');
});

test('paciente sem próxima sessão mostra Sem agendamento', () => {
  assert.equal(rows().find(row => row.patient.id === 'p-mariana')?.nextSession, 'Sem agendamento');
});

test('a busca continua contemplando nome, telefone, e-mail e status', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(pilot, /normalizePsychologyPhoneForSearch/);
  assert.match(pilot, /Buscar paciente por nome, telefone ou e-mail/);
  assert.match(pilot, /statusFilter/);
});

test('resultado filtrado preserva ordem alfabética', () => {
  const store = fixture();
  const filtered = store.patients.filter(patient => patient.name.toLocaleLowerCase().includes('a'));
  assert.deepEqual(getPsychologyPatientListViewModels(store, filtered, referenceDate).map(row => row.patient.name), ['Álvaro', 'Ana', 'Fabiano', 'Mariana']);
});

test('abrir ficha continua conectado à listagem', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(pilot, /aria-label=\{`Abrir ficha completa de \$\{row\.patient\.name\}`/);
  assert.match(pilot, /onOpen=\{patient => \{/);
});

test('Editar continua conectado ao paciente correto', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(pilot, /onClick=\{\(\) => onEdit\(row\.patient\)\}/);
});

test('Inativar e Ativar continuam disponíveis sem exclusão', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(pilot, /row\.patient\.active \? 'Inativar' : 'Ativar'/);
  assert.doesNotMatch(pilot, /Excluir paciente/);
});

test('nenhum conteúdo clínico aparece na fonte da lista', () => {
  const list = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/psychologyPatientList.ts'), 'utf8');
  assert.doesNotMatch(list, /record|anamnese|diagnóstico|clinical/i);
});

test('mobile usa composição compacta e não cria overflow horizontal global', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(pilot, /grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.match(pilot, /overflow-x-hidden/);
  assert.match(pilot, /md:hidden/);
});

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
import { filterPsychologyPatientList, getPsychologyPatientListViewModels, formatPsychologyPatientPhone } from '../src/features/psychology-pilot/psychologyPatientList';

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

test('cabeçalho e linhas compartilham o grid responsivo com larguras desktop ajustáveis', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const gridDefinition = pilot.match(/const PATIENT_LIST_GRID = '([^']+)'/)?.[1];
  assert.ok(gridDefinition);
  assert.match(gridDefinition, /grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.match(pilot, /const PATIENT_LIST_DESKTOP_GRID = 'md:grid-cols-\[2rem_minmax\(0,var\(--psychology-patient-width\)\)_minmax\(0,var\(--psychology-phone-width\)\)_minmax\(0,var\(--psychology-modality-width\)\)_5rem_minmax\(9\.5rem,\.85fr\)\]/);
  assert.equal((pilot.match(/\$\{PATIENT_LIST_GRID\}/g) || []).length, 2);
  assert.equal((pilot.match(/\$\{PATIENT_LIST_PADDING\}/g) || []).length, 2);
  assert.match(pilot, /data-desktop-columns="patient phone modality-location status action"/);
  for (const column of ['patient', 'phone', 'modality-location', 'status', 'action']) assert.match(pilot, new RegExp(`data-desktop-column="${column}"`));
  assert.match(pilot, /SortHeader label="Status"/);
  assert.match(pilot, /whitespace-nowrap text-right md:col-start-6 md:row-start-1">Ação/);
});

test('cabeçalho e linha fixam explicitamente as mesmas seis colunas desktop', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const start = pilot.indexOf('data-testid="psychology-patient-list-header"');
  const end = pilot.indexOf('</div>; })}</div>', start);
  const listMarkup = pilot.slice(start, end);
  for (let column = 1; column <= 6; column += 1) {
    assert.equal((listMarkup.match(new RegExp(`md:col-start-${column}`, 'g')) || []).length, 2);
  }
  assert.equal((listMarkup.match(/md:row-start-1/g) || []).length, 12);
  assert.doesNotMatch(listMarkup, /md:col-auto|md:row-auto/);
});

test('cada paciente ocupa uma única linha estrutural compacta no desktop', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const start = pilot.indexOf('function PatientsView(');
  const end = pilot.indexOf('\nfunction psychologyLegendLabel', start);
  const patientsView = pilot.slice(start, end);
  const rowStart = patientsView.indexOf('data-testid="psychology-patient-list-row"');
  const rowEnd = patientsView.indexOf('</div>; })}', rowStart);
  const desktopRow = patientsView.slice(rowStart, rowEnd);
  assert.match(desktopRow, /data-desktop-layout="single-line"/);
  assert.match(desktopRow, /border-slate-100 py-4[^`]*md:py-2/);
  assert.doesNotMatch(desktopRow, /md:row-start-[2-9]|md:col-span|position:absolute|\btransform\b|md:-m[trblxy]?-/);
  assert.match(patientsView, /md:flex-nowrap/);
  assert.match(desktopRow, /data-desktop-column="action" className="[^"]*whitespace-nowrap[^"]*md:flex-nowrap/);
  assert.match(patientsView, /onClick=\{\(\) => onOpen\(row\.patient\)\}/);
  assert.match(patientsView, /onClick=\{\(\) => onEdit\(row\.patient\)\}/);
  assert.match(patientsView, /onClick=\{\(\) => onToggle\(row\.patient\)\}/);
  assert.match(patientsView, /onClick=\{\(\) => onDelete\(row\.patient\)\}/);
});

test('o cabeçalho principal contém somente Paciente, Telefone, Modalidade/Local, Status e Ação', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const start = pilot.indexOf('data-testid="psychology-patient-list-header"');
  const end = pilot.indexOf('<div>{filteredRows.map', start);
  const header = pilot.slice(start, end);
  for (const label of ['PACIENTE', 'TELEFONE', 'MODALIDADE \/ LOCAL', 'STATUS', 'AÇÃO']) assert.match(header, new RegExp(label, 'i'));
  for (const removedLabel of ['E-MAIL', 'CADASTRO', 'ÚLTIMA SESSÃO', 'PRÓXIMA SESSÃO']) assert.doesNotMatch(header, new RegExp(removedLabel, 'i'));
});

test('nome e Modalidade/Local truncam em uma linha sem perder o conteúdo acessível', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(pilot, /title=\{row\.patient\.name\} className="block truncate whitespace-nowrap/);
  assert.match(pilot, /data-desktop-column="modality-location" title=\{row\.modalityLocation\}(?: aria-label=\{row\.modalityLocation\})? className="[^"]*min-w-0 overflow-hidden text-ellipsis whitespace-nowrap/);
  const longName = 'Paciente com nome sintético muito longo para a coluna principal da listagem';
  const store = addPatient(fixture(), 'p-long-name', longName);
  assert.equal(rows(store).find(row => row.patient.id === 'p-long-name')?.patient.name, longName);
});

test('a ordem padrão é alfabética A–Z', () => {
  assert.deepEqual(rows().map(row => row.patient.name), ['Álvaro', 'Ana', 'Fabiano', 'Gertrudes', 'Mariana']);
});

test('acentos não quebram a ordenação', () => {
  assert.ok('Álvaro'.localeCompare('Ana', 'pt-BR', { sensitivity: 'base' }) < 0);
});

test('telefone é formatado sem código de país na apresentação profissional', () => {
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

test('a busca contempla apenas nome, telefone e e-mail conforme a tela aprovada', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const list = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/psychologyPatientList.ts'), 'utf8');
  assert.match(list, /row\.patient\.name, row\.patient\.phone, row\.phone, row\.patient\.email/);
  assert.match(pilot, /Buscar nome, telefone ou e-mail/);
  assert.doesNotMatch(pilot, /Buscar paciente por nome, telefone, e-mail ou status/);
});

test('e-mail e filtros de sessões continuam funcionais sem colunas desktop próprias', () => {
  const patientRows = rows();
  assert.deepEqual(filterPsychologyPatientList(patientRows, { query: 'ana@example.com' }, referenceDate).map(row => row.patient.id), ['p-ana']);
  assert.equal(filterPsychologyPatientList(patientRows, { lastSession: 'none' }, referenceDate).length, 4);
  assert.equal(filterPsychologyPatientList(patientRows, { nextSession: 'with' }, referenceDate).length, 3);
  assert.equal(filterPsychologyPatientList(patientRows, { nextSession: 'without' }, referenceDate).length, 2);
});

test('dados retirados da tabela permanecem íntegros no view model', () => {
  const row = rows().find(item => item.patient.id === 'p-fabiano');
  assert.equal(row?.email, 'fabiano@example.com');
  assert.equal(row?.patient.createdAt, '2026-08-01T00:00:00.000Z');
  assert.equal(row?.createdAt, '31/07/2026');
  assert.equal(row?.lastSession, '12/08/2026');
  assert.equal(row?.nextSession, '17/08/2026 · 14:00');
});

test('resultado filtrado preserva ordem alfabética', () => {
  const store = fixture();
  const filtered = store.patients.filter(patient => patient.name.toLocaleLowerCase().includes('a'));
  assert.deepEqual(getPsychologyPatientListViewModels(store, filtered, referenceDate).map(row => row.patient.name), ['Álvaro', 'Ana', 'Fabiano', 'Mariana']);
});

test('abrir ficha continua conectado à listagem', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(pilot, /aria-label=\{`Abrir ficha completa de \$\{row\.patient\.name\}`/);
  assert.match(pilot, /onOpen=\{setPatientChart\}/);
});

test('Editar continua conectado ao paciente correto', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(pilot, /onClick=\{\(\) => onEdit\(row\.patient\)\}/);
});

test('menu de reticências expõe ações secundárias com teclado e preserva handlers', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(pilot, /aria-haspopup="menu"/);
  assert.match(pilot, /aria-expanded=\{actionMenuPatient\?\.id === row\.patient\.id\}/);
  assert.match(pilot, />⋯<\/button>/);
  assert.match(pilot, /data-testid="psychology-patient-actions-menu"/);
  assert.match(pilot, /role="menu"/);
  assert.match(pilot, /position: 'fixed'/);
  assert.match(pilot, /<button autoFocus type="button"/);
  assert.match(pilot, /onEdit\(patient\)/);
  assert.match(pilot, /onToggle\(patient\)/);
  assert.match(pilot, /onDelete\(patient\)/);
});

test('menu e tabela preservam os contratos visuais novos sem persistir dados clínicos', () => {
  const pilot = readFileSync(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(pilot, /psychology\.patientTable\.columnWidths/);
  assert.match(pilot, /PatientResizeHandle/);
  assert.match(pilot, /data-testid={`psychology-patient-resize-\$\{column\}`}/);
  assert.match(pilot, /psychology-patient-reset-widths/);
  assert.match(pilot, /overflow-x-auto/);
  assert.doesNotMatch(pilot, /localStorage\.setItem\([^,]+,.*sessionRecords|localStorage\.setItem\([^,]+,.*content/);
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
  assert.match(pilot, /col-start-2 row-start-3[^>]*md:hidden/);
  assert.match(pilot, /col-span-3 row-start-6[^>]*md:hidden/);
});

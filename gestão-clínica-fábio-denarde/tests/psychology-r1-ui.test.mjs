import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const pilot = await readFile(resolve(root, 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
const domain = await readFile(resolve(root, 'src/features/psychology-pilot/psychologyDomain.ts'), 'utf8');
const r2a = await readFile(resolve(root, 'src/features/psychology-pilot/psychologyR2a.ts'), 'utf8');
const agendaScale = await readFile(resolve(root, 'src/features/psychology-pilot/psychologyAgendaScale.ts'), 'utf8');
const psychologyPersonalAgenda = await readFile(resolve(root, 'src/features/psychology-pilot/PsychologyPersonalAgenda.tsx'), 'utf8');
const app = await readFile(resolve(root, 'src/App.tsx'), 'utf8');

test('entrada local do piloto é limitada a desenvolvimento em localhost', () => {
  assert.match(domain, /if \(!isDev \|\| !\['localhost', '127\.0\.0\.1'\]\.includes\(hostname\)\) return false/);
  assert.match(app, /<PsychologyPilot \/>/);
});

test('Psicologia oferece Meu Dia, Pacientes, Agenda e Agenda Pessoal', () => {
  for (const label of ['Meu Dia', 'Pacientes', 'Agenda', 'Agenda Pessoal']) assert.match(pilot, new RegExp(label));
});

test('Agenda da Psicologia usa a grade semanal do produto', () => {
  for (const label of ['Agenda semanal', 'Semana anterior', 'Próxima semana', 'getPsychologyAgendaScale']) {
    assert.match(pilot, new RegExp(label));
  }
  assert.match(agendaScale, /PSYCHOLOGY_AGENDA_START_MINUTES/);
  assert.match(pilot, /psychology-weekly-session/);
  assert.match(pilot, /psychology-weekly-personal/);
  assert.match(pilot, /bg-violet-700/);
});

test('a grade reduz ruído e torna o horário livre clicável', () => {
  assert.match(pilot, /psychology-agenda-free-slot/);
  assert.match(pilot, /aria-label=\{`Agendar em \$\{cellLabel\}`\}/);
  assert.doesNotMatch(pilot, />\+ Agendar</);
  assert.doesNotMatch(pilot, />Horário livre</);
  assert.match(pilot, /SessionActionsDialog/);
  assert.match(pilot, /Editar \/ reagendar/);
  assert.match(pilot, /Marcar realizada/);
});

test('a Agenda preserva rótulos semânticos e responde a telas menores', () => {
  for (const label of ['Presencial', 'Online', 'Pessoal', 'Mentoria', 'Consultório Externo']) assert.match(pilot, new RegExp(label));
  assert.match(agendaScale, /pixelsPerMinute = mobile[\s\S]*1\.2/);
  assert.match(pilot, /min-w-\[1080px\]/);
  assert.match(pilot, /data-testid="psychology-agenda-mobile-sequence"/);
  assert.match(pilot, /Agenda Pessoal/);
});

test('R1C mantém a grade limpa e concentra os horários na escala lateral', () => {
  assert.match(pilot, /psychology-agenda-free-slot/);
  assert.match(pilot, /grid-cols-\[68px_repeat\(6,minmax\(150px,1fr\)\)\]/);
  assert.match(pilot, /grid-cols-\[68px_minmax\(0,1fr\)\]/);
  assert.match(pilot, /aria-label=\{`Agendar em \$\{cellLabel\}`\}/);
  assert.doesNotMatch(pilot, />Horário livre</);
  assert.doesNotMatch(pilot, />\+ Agendar</);
});

test('R2A1 oferece painel por abas para Sessão, Pessoal e Mentoria', () => {
  for (const label of ['Novo agendamento', 'Sessão', 'Pessoal', 'Mentoria', 'Agendar sessão', 'Salvar compromisso']) {
    assert.match(pilot, new RegExp(label));
  }
  assert.doesNotMatch(pilot, /id: 'meeting'|label: 'Reunião'/);
  assert.match(pilot, /onNewPatient/);
  assert.match(domain, /title\?: string/);
  assert.match(domain + pilot, /'Mentoria'/);
});

test('R2A1 oferece Ajustes com perfil, agenda, serviços, locais, financeiro, cores e lembretes', () => {
  for (const label of ['Ajustes', 'Perfil profissional', 'Agenda', 'Atendimentos', 'Serviços', 'Financeiro', 'Cores', 'Lembretes']) {
    assert.match(pilot, new RegExp(label));
  }
  assert.match(domain + r2a, /Shopping Moxuara/);
  assert.match(domain + r2a, /Consultório Externo/);
  for (const label of ['PSYCHOLOGY_COLOR_DEFAULTS', 'PRESENTIAL_PRIMARY', 'EXTERNAL_OFFICE', 'restorePsychologyDefaultColors', 'normalizePsychologyColor']) {
    assert.match(domain + r2a + pilot, new RegExp(label));
  }
});

test('a experiência da Psicologia não expõe entidades inadequadas', () => {
  assert.doesNotMatch(pilot, /Atendente|Responsável|Galeria de Atividades|Pré-cadastros/);
});

test('o registro clínico tem tela própria e não é renderizado nos cards administrativos', () => {
  assert.match(pilot, /Registro da sessão/);
  assert.match(pilot, /não aparece em listas, agenda ou Meu Dia/);
  assert.doesNotMatch(pilot, /record\.text|sessionRecords\.map\(record => record\.text/);
});

test('Agenda Pessoal não usa paciente nem ações externas do sistema', () => {
  assert.match(pilot + psychologyPersonalAgenda, /Ela não é uma sessão clínica/);
  assert.doesNotMatch(pilot, /patientId.*personalCommitment|WhatsApp|Firebase|Google Meet/);
});

test('o piloto persiste apenas no armazenamento local por profissional', () => {
  assert.match(pilot, /window\.localStorage\.setItem/);
  assert.match(pilot, /LOCAL_PSYCHOLOGY_STORAGE_KEY.*LOCAL_PSYCHOLOGY_PROFESSIONAL_ID/);
  assert.match(domain, /professionalId: store\.scope\.professionalId/);
  assert.match(domain, /context: PSYCHOLOGY_CONTEXT/);
});

test('R2F3-F1 remove observação do novo paciente, preserva edição e deixa a primeira sessão explícita', () => {
  const patientDialog = pilot.slice(pilot.indexOf('function PatientDialogR2F3E'), pilot.indexOf('function PatientDialog('));
  assert.match(patientDialog, /value && <Field label="Observação administrativa">/);
  assert.doesNotMatch(patientDialog, /\}\<Field label="Observação administrativa">/);
  assert.match(patientDialog, /Modalidade preferencial \*/);
  assert.match(patientDialog, /<select required value=\{form\.preferredModality\}/);
  assert.match(pilot, /Paciente criado\. A ficha está pronta para agendar a primeira sessão\./);
  assert.match(pilot, /<PsychologyPatientChart/);
  assert.match(pilot, /Agendar sessão/);
});

test('R2F3-F1 sessão ativa usa duração informativa do serviço e campos de avanço obrigatórios', () => {
  const eventDialog = pilot.slice(pilot.indexOf('function EventCreationDialog'), pilot.indexOf('function HistoricalEventCreationDialog'));
  const sessionDialog = pilot.slice(pilot.indexOf('function SessionDialog'), pilot.indexOf('function HistoricalSessionDialog'));
  assert.match(eventDialog, /Duração do serviço/);
  assert.match(sessionDialog, /Duração do serviço/);
  assert.doesNotMatch(eventDialog, /Field label="Duração"><select required/);
  assert.doesNotMatch(sessionDialog, /Field label="Duração"><select required/);
  for (const source of [eventDialog, sessionDialog]) {
    assert.match(source, /Paciente[s\S]*<select required/);
    assert.match(source, /Serviço[s\S]*<select required/);
    assert.match(source, /Tipo de atendimento|Modalidade/);
    assert.match(source, /<input required type="date"|<input required type="time"/);
  }
  assert.match(eventDialog, /Field label="Local"><select required/);
  assert.match(sessionDialog, /Field label="Local"><select required/);
});

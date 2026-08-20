import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('Agenda Pessoal Psicologia usa grade clean sem alterar a semana Neuro', async () => {
  const source = await readFile(resolve(process.cwd(), 'src/components/PersonalAgenda.tsx'), 'utf8');
  const psychologyGrid = source.slice(source.indexOf('function PsychologyPersonalWeeklyGrid'), source.indexOf('type ViewMode'));
  assert.match(source, /viewMode === 'semanal' && isPsychology/);
  assert.match(source, /viewMode === 'semanal' && !isPsychology/);
  assert.match(psychologyGrid, /data-testid=\{'psychology-personal-weekly-grid-' \+ mode\}/);
  assert.match(psychologyGrid, /data-testid="psychology-personal-empty-slot"/);
  assert.match(psychologyGrid, /overflow-x-auto overflow-y-hidden/);
  assert.doesNotMatch(psychologyGrid, />Horário livre|>Adicionar Compromisso/);
});

test('grade clean mantém escala lateral, compromisso temporal e criação por clique', async () => {
  const source = await readFile(resolve(process.cwd(), 'src/components/PersonalAgenda.tsx'), 'utf8');
  const psychologyGrid = source.slice(source.indexOf('function PsychologyPersonalWeeklyGrid'), source.indexOf('type ViewMode'));
  assert.match(psychologyGrid, /PSYCHOLOGY_PERSONAL_TIMES/);
  assert.match(psychologyGrid, /<div className="border-r border-clinic-border bg-clinic-bg px-1 pt-3 text-center text-xs font-black text-clinic-text-muted">\{time\}/);
  assert.match(psychologyGrid, /<span className=\{cn\('text-\[11px\] font-black tracking-wide', config\.text\)\}>\{app\.time\}/);
  assert.match(psychologyGrid, /const title = app\.title\?\.trim\(\) \|\| app\.type/);
  assert.match(psychologyGrid, /onClick=\{\(\) => openNew\(day, time\)\}/);
  assert.match(psychologyGrid, /data-date=\{format\(day, 'yyyy-MM-dd'\)\}/);
  assert.match(psychologyGrid, /data-time=\{time\}/);
  assert.match(source, /\+ Novo Compromisso/);
  assert.match(source, /openNew\(new Date\(\), '08:00'\)/);
});

test('calendário, lista, recorrência, alarme, pendências e ações continuam no componente compartilhado', async () => {
  const source = await readFile(resolve(process.cwd(), 'src/components/PersonalAgenda.tsx'), 'utf8');
  const adapter = await readFile(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPersonalAgenda.tsx'), 'utf8');
  for (const pattern of [
    /monthCells/,
    /getOccurrences\(day, day\)/,
    /listOccurrences/,
    /app\.time/,
    /app\.recurrence/,
    /alarmEnabled/,
    /getNextPersonalAppointmentOccurrence/,
    /pendingCount/,
    /openEdit\(app\)/,
    /toggleDone\(app\.id\)/,
    /handleDelete\(app\.id\)/,
  ]) assert.match(source, pattern);
  assert.match(adapter, /useAlarms\(appointments\)/);
  assert.match(adapter, /toPsychologyPersonalAppointment/);
  assert.match(adapter, /fromPsychologyPersonalAppointment/);
});

test('indicador temporal é reutilizado sem algoritmo duplicado e sem nested vertical scroll', async () => {
  const source = await readFile(resolve(process.cwd(), 'src/components/PersonalAgenda.tsx'), 'utf8');
  const psychologyGrid = source.slice(source.indexOf('function PsychologyPersonalWeeklyGrid'), source.indexOf('type ViewMode'));
  assert.match(source, /from '..\/features\/psychology-pilot\/psychologyAgendaTemporal'/);
  assert.match(psychologyGrid, /getPsychologyAgendaTimeProgress/);
  assert.match(psychologyGrid, /getPsychologyAgendaRowProgress/);
  assert.match(psychologyGrid, /pointer-events-none/);
  assert.match(psychologyGrid, /setInterval\(updateAgendaNow, 60_000\)/);
  assert.match(psychologyGrid, /clearInterval\(timer\)/);
  assert.doesNotMatch(psychologyGrid, /overflow-y-auto/);
});

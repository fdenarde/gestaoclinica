import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const personalAgendaSource = fs.readFileSync(
  new URL('../src/components/PersonalAgenda.tsx', import.meta.url),
  'utf8',
);
const appSource = fs.readFileSync(
  new URL('../src/App.tsx', import.meta.url),
  'utf8',
);

test('calendário mensal respeita o deslocamento do primeiro dia do mês', () => {
  assert.match(personalAgendaSource, /const monthCells = useMemo/);
  assert.match(personalAgendaSource, /start\.getDay\(\)/);
  assert.match(personalAgendaSource, /leadingEmptyCells/);
  assert.match(personalAgendaSource, /trailingEmptyCells/);
  assert.doesNotMatch(personalAgendaSource, /\{monthDays\.map/);
});

test('visão mensal mostra compromisso legível e editável, não apenas um ponto', () => {
  assert.match(personalAgendaSource, /key=\{occurrenceKey\(app\)\}/);
  assert.match(personalAgendaSource, /\{app\.time\}/);
  assert.match(personalAgendaSource, /\{app\.type\}/);
  assert.match(personalAgendaSource, /openEdit\(app\)/);
});

test('contador de pendentes acompanha o período da visualização ativa', () => {
  assert.match(personalAgendaSource, /if \(viewMode === 'mensal'\)/);
  assert.match(personalAgendaSource, /startOfMonth\(currentDate\)/);
  assert.match(personalAgendaSource, /if \(viewMode === 'lista'\)/);
  assert.match(personalAgendaSource, /if \(viewMode === 'proximos'\)/);
  assert.match(personalAgendaSource, /\{pendingCount\} pendentes/);
});

test('recorrências usam chaves únicas por ocorrência nas listas', () => {
  assert.match(personalAgendaSource, /function occurrenceKey/);
  assert.ok((personalAgendaSource.match(/key=\{occurrenceKey\(app\)\}/g) || []).length >= 4);
});

test('salvar, concluir e excluir aguardam confirmação real de persistência', () => {
  assert.match(personalAgendaSource, /const persisted = await onUpdate\(\{ personalAppointments: updatedList \}\)/);
  assert.ok((personalAgendaSource.match(/const persisted = await onUpdate/g) || []).length >= 3);
});

test('leitura da agenda usa o id do documento como fallback seguro', () => {
  assert.match(
    appSource,
    /id: typeof data\.id === 'string' && data\.id\.trim\(\) \? data\.id : doc\.id/,
  );
});

test('botão global Novo Compromisso permanece disponível', () => {
  assert.match(personalAgendaSource, /\+ Novo Compromisso/);
  assert.match(personalAgendaSource, /openNew\(new Date\(\), '08:00'\)/);
});

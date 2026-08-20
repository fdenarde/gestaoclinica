import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const page = await readFile(resolve(root, 'src/features/psychology-online-booking/PublicBookingPage.tsx'), 'utf8');
const domain = await readFile(resolve(root, 'src/features/psychology-online-booking/bookingDomain.ts'), 'utf8');
const catalog = await readFile(resolve(root, 'src/features/psychology-pilot/psychologyServiceCatalog.ts'), 'utf8');
const settingsPanel = await readFile(resolve(root, 'src/features/psychology-online-booking/PublicBookingSettingsPanel.tsx'), 'utf8');
const editor = await readFile(resolve(root, 'src/features/psychology-online-booking/PublicBookingAvailabilityEditor.tsx'), 'utf8');

test('Agendamento Online publica somente serviços canônicos e datas realmente reserváveis', () => {
  for (const label of ['Psicoterapia Individual', 'Terapia de Casal', 'Mentoria', 'Teste de Eneagrama', 'Psicoterapia Adolescente']) assert.match(catalog, new RegExp(label));
  assert.match(page, /repository\.listPublishedSlots\(\{ professionalSlug, serviceId: service\.id, modality, locationId, fromDate, throughDate \}\)/);
  assert.match(page, /setDates\(\[\.\.\.new Set\(slotsInRange\.map\(slot => slot\.date\)\)\]\)/);
  assert.doesNotMatch(page, /Array\.from\(\{ length: 21 \}/);
  assert.match(page, /Nenhuma data disponível/);
});

test('progresso público acompanha o fluxo online e presencial', () => {
  assert.match(page, /const progressMap = modality === 'ONLINE'/);
  assert.match(page, /const totalSteps = modality === 'ONLINE' \? 6 : 7/);
  assert.match(page, /aria-label=\{`Etapa \$\{progressStep\} de \$\{totalSteps\}`\}/);
  assert.match(page, /<StepHeader step=\{progressStep\}/);
  assert.match(page, /Escolha o Atendimento/);
});

test('Ajustes organiza rotina e exceções sem expor controles de exceção antes da seleção', () => {
  assert.match(settingsPanel, /PublicBookingAvailabilityEditor/);
  assert.match(editor, /data-testid="psychology-availability-tab-routine"/);
  assert.match(editor, /data-testid="psychology-availability-tab-exceptions"/);
  assert.match(editor, /editingDay/);
  assert.match(editor, /\{selectedDate &&/);
  assert.match(editor, /BLOCK_DAY/);
  assert.match(editor, /BLOCK_PERIOD/);
  assert.match(editor, /OPEN_PERIOD/);
  assert.match(editor, /Usar programação habitual/);
});

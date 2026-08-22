import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const pilot = await readFile(resolve(root, 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
const online = await readFile(resolve(root, 'src/features/psychology-online-booking/PublicBookingSettingsPanel.tsx'), 'utf8');

test('Ajustes mantém somente as quatro áreas operacionais prontas', () => {
  for (const tab of ['Perfil', 'Atendimentos', 'Agenda', 'Aparência e Sistema']) assert.match(pilot, new RegExp(tab));
  assert.match(pilot, /psychology-settings-tabs/);
  assert.match(pilot, /role="tab"/);
  assert.match(pilot, /activeTab === 'profile'/);
  assert.match(pilot, /activeTab === 'attendance'/);
  assert.match(pilot, /activeTab === 'agenda'/);
  assert.doesNotMatch(pilot, /activeTab === 'online'/);
  assert.doesNotMatch(pilot, /activeTab === 'messages'/);
  assert.match(pilot, /activeTab === 'system'/);
});

test('Ajustes aplica o padrão visual centralizado e responsivo aprovado em Mensagens', () => {
  assert.match(pilot, /function SettingsPageHeader/);
  assert.match(pilot, /data-testid="psychology-settings-page-header"/);
  assert.match(pilot, /text-center/);
  assert.match(pilot, /flex min-w-max gap-1\.5 sm:grid sm:min-w-0 sm:grid-cols-3/);
  assert.match(pilot, /max-w-\[96rem\]/);
  assert.match(online, /Ajustes · Psicologia/);
  assert.match(online, /flex flex-col justify-between gap-3 sm:flex-row sm:items-start/);
});

test('Ajustes preserva resumos e edição progressiva dos contratos existentes', () => {
  for (const label of ['Dados profissionais', 'Identidade profissional', 'Serviços', 'Locais presenciais', 'Horário habitual', 'Períodos do dia', 'Ações rápidas', 'Cores da Agenda']) assert.match(pilot, new RegExp(label));
  assert.match(pilot, /psychology-profile-editor/);
  assert.match(pilot, /psychology-services-settings/);
  assert.match(pilot, /psychology-locations-settings/);
  assert.match(pilot, /psychology-agenda-settings-editor/);
  assert.match(pilot, /psychology-daypart-settings/);
  assert.match(pilot, /settings\.services/);
  assert.match(pilot, /settings\.locations/);
});

test('Agendamento Online usa cartões resumidos e abre cada gestão sob demanda', () => {
  for (const label of ['Disponibilidade pública', 'Serviços publicados', 'Regras de agendamento', 'Confirmação e cancelamento', 'Copiar link', 'Abrir página']) assert.match(online, new RegExp(label));
  assert.match(online, /activeSection === 'overview'/);
  assert.match(online, /activeSection === 'availability'/);
  assert.match(online, /activeSection === 'services'/);
  assert.match(online, /activeSection === 'rules'/);
  assert.match(online, /activeSection === 'confirmation'/);
  assert.match(online, /PublicBookingAvailabilitySettings/);
  assert.match(online, /publicBookingExceptions/);
});

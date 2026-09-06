import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { createPsychologyScope } from '../src/features/psychology-pilot/psychologyDomain';
import {
  normalizePsychologySettings,
} from '../src/features/psychology-pilot/psychologyR2a';

const scope = createPsychologyScope('professional-r90-synthetic');
const now = '2026-08-28T12:00:00.000Z';

test('R90 — serviços remotos vazios preservam catálogo canônico operacional', () => {
  const settings = normalizePsychologySettings({ scope, services: [], locations: [] }, scope, now);

  assert.equal(settings.services.length, 5);
  assert.equal(settings.services.every(service => service.active), true);
  assert.equal(settings.services.every(service => service.context === 'PSICOLOGIA' && service.professionalId === scope.professionalId), true);
  assert.equal(settings.services[0]?.defaultDurationMinutes, 50);
  assert.equal(settings.services[0]?.name, 'Psicoterapia Individual');
});

test('R90 — serviço remoto válido não vazio mantém prioridade sobre o catálogo canônico', () => {
  const settings = normalizePsychologySettings({
    scope,
    services: [{
      id: 'service-r90-remote',
      professionalId: scope.professionalId,
      context: 'PSICOLOGIA',
      name: 'Serviço remoto sintético',
      defaultDurationMinutes: 75,
      modality: 'BOTH',
      active: true,
    }],
  }, scope, now);

  assert.deepEqual(settings.services.map(service => service.id), ['service-r90-remote']);
  assert.equal(settings.services[0]?.name, 'Serviço remoto sintético');
  assert.equal(settings.services[0]?.defaultDurationMinutes, 75);
});

test('R90 — localizações remotas vazias preservam local principal e catálogo canônico', () => {
  const settings = normalizePsychologySettings({ scope, services: [], locations: [] }, scope, now);

  assert.equal(settings.locations.length, 2);
  assert.equal(settings.locations.every(location => location.active), true);
  assert.equal(settings.locations.every(location => location.context === 'PSICOLOGIA' && location.professionalId === scope.professionalId), true);
  assert.equal(settings.locations.some(location => location.isPrimary && location.displayName === 'Shopping Moxuara'), true);
});

test('R90 — localização remota válida não vazia mantém prioridade sobre o catálogo canônico', () => {
  const settings = normalizePsychologySettings({
    scope,
    locations: [{
      id: 'location-r90-remote',
      professionalId: scope.professionalId,
      context: 'PSICOLOGIA',
      type: 'PRIMARY_OFFICE',
      displayName: 'Local remoto sintético',
      active: true,
      isPrimary: true,
    }],
  }, scope, now);

  assert.deepEqual(settings.locations.map(location => location.id), ['location-r90-remote']);
  assert.equal(settings.locations[0]?.displayName, 'Local remoto sintético');
});

test('R90 — modal de sessão usa os catálogos normalizados de Settings sem persistência', async () => {
  const source = await readFile(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const start = source.indexOf('function SessionDialog');
  const end = source.indexOf('function HistoricalSessionDialog');
  const dialog = source.slice(start, end);
  const settings = normalizePsychologySettings({ scope, services: [], locations: [] }, scope, now);

  assert.ok(start >= 0 && end > start);
  assert.match(dialog, /<Field label="Serviço">/);
  assert.match(dialog, /settings\.services\.filter\(service => service\.active\)/);
  assert.match(dialog, /<Field label="Local">/);
  assert.match(dialog, /settings\.locations\.filter\(location => location\.active\)/);
  assert.match(dialog, /data-testid="psychology-service-duration"/);
  assert.equal(settings.services.length > 0, true);
  assert.equal(settings.locations.length > 0, true);
});

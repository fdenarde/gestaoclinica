import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  createClosedPsychologyCapabilities,
  normalizePsychologyCapabilities,
  psychologyCapabilityAllows,
  psychologyCapabilityIsAvailable,
} from '../src/features/psychology-persistence/capabilities';
import { buildPsychologyCapabilities } from '../api/_lib/psychologyCapabilities.js';

const root = resolve(process.cwd());

test('capabilities server-side são sanitizadas e derivadas do escopo resolvido', () => {
  const capabilities = buildPsychologyCapabilities({ permissions: ['patients.list', 'patients.create', 'patients.edit', 'agenda.own.view', 'agenda.edit'] });

  assert.equal(capabilities.context, 'PSICOLOGIA');
  assert.equal(capabilities.resources.patients.view, true);
  assert.equal(capabilities.resources.patients.create, true);
  assert.equal(capabilities.resources.patients.edit, true);
  assert.equal(capabilities.resources.finance.available, false);
  assert.equal(capabilities.resources.onlineBooking.available, false);
  assert.equal('permissions' in capabilities, false);
  assert.equal('professionalId' in capabilities, false);
});

test('ausência ou contrato inválido de capabilities fecha a UX', () => {
  const closed = createClosedPsychologyCapabilities();
  assert.equal(psychologyCapabilityAllows(closed, 'patients', 'view'), false);
  assert.equal(psychologyCapabilityIsAvailable(closed, 'onlineBooking'), false);
  assert.equal(psychologyCapabilityAllows(normalizePsychologyCapabilities({}), 'patients', 'view'), false);
  assert.equal(psychologyCapabilityIsAvailable(normalizePsychologyCapabilities({}), 'settings'), false);
});

test('contrato remoto não abre fallback local para Online Booking', async () => {
  const pilot = await readFile(resolve(root, 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const api = await readFile(resolve(root, 'api/psychology.js'), 'utf8');
  const publicBooking = await readFile(resolve(root, 'api/public-booking.ts'), 'utf8');
  const firestoreStore = await readFile(resolve(root, 'api/_lib/publicBookingFirestoreStore.js'), 'utf8');

  assert.match(pilot, /remoteConfiguration\.enabled \|\| typeof window === 'undefined'/);
  assert.match(pilot, /remoteMode && !psychologyCapabilityIsAvailable\(capabilities, 'onlineBooking'\)/);
  assert.match(api, /capabilities: buildPsychologyCapabilities\(runtimeScope\)/);
  assert.match(publicBooking, /createFirestorePublicBookingServerStore/);
  assert.match(publicBooking, /allowSettingsWrite: false/);
  assert.match(firestoreStore, /contexts\/\$\{CONTEXT\}\/publicBooking\/state/);
  assert.match(firestoreStore, /canonicalRepository\.services\.list/);
  assert.match(firestoreStore, /canonicalRepository\.locations\.list/);
});

test('a asserção legada usa o rótulo vigente de Atendimentos', async () => {
  const suite = await readFile(resolve(root, 'tests/psychology-r1-ui.test.mjs'), 'utf8');
  assert.match(suite, /'Atendimentos'/);
  assert.doesNotMatch(suite, /'Atendimento \/ Locais'/);
});

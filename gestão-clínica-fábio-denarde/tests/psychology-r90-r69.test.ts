import assert from 'node:assert/strict';
import test from 'node:test';
import { createPsychologyScope } from '../src/features/psychology-pilot/psychologyDomain';
import { normalizePsychologySettings } from '../src/features/psychology-pilot/psychologyR2a';

const scope = createPsychologyScope('professional-r90-synthetic');
const now = '2026-08-28T12:00:00.000Z';

test('R90 — services remoto vazio preserva catálogo canônico', () => { const settings = normalizePsychologySettings({ scope, services: [], locations: [] }, scope, now); assert.equal(settings.services.length, 5); assert.equal(settings.services[0]?.name, 'Psicoterapia Individual'); assert.equal(settings.services[0]?.defaultDurationMinutes, 50); });
test('R90 — services remoto não vazio permanece prioritário', () => { const settings = normalizePsychologySettings({ scope, services: [{ id: 'remote', professionalId: scope.professionalId, context: 'PSICOLOGIA', name: 'Serviço remoto', defaultDurationMinutes: 75, modality: 'BOTH', active: true }] }, scope, now); assert.deepEqual(settings.services.map(service => service.id), ['remote']); assert.equal(settings.services[0]?.defaultDurationMinutes, 75); });
test('R90 — locations vazias usam catálogo canônico e locations remotas válidas têm prioridade', () => { const empty = normalizePsychologySettings({ scope, services: [], locations: [] }, scope, now); assert.equal(empty.locations.length, 2); assert.equal(empty.locations.some(location => location.displayName === 'Shopping Moxuara'), true); const remote = normalizePsychologySettings({ scope, locations: [{ id: 'remote-location', professionalId: scope.professionalId, context: 'PSICOLOGIA', type: 'PRIMARY_OFFICE', displayName: 'Local remoto', active: true, isPrimary: true }] }, scope, now); assert.deepEqual(remote.locations.map(location => location.id), ['remote-location']); });

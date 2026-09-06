import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readPsychologySettingsProjection,
  projectPsychologySettingsSnapshot,
  sanitizePsychologySettingsProjectionError,
  SETTINGS_OPERATIONAL_FIELD_PATHS,
  SETTINGS_PERSONAL_FIELD_PATHS,
} from '../api/_lib/psychologySettingsProjection.js';

const scope = Object.freeze({
  workspaceId: 'workspace-r83',
  tenantId: 'tenant-r83',
  professionalId: 'professional-r83',
  context: 'PSICOLOGIA',
});

function snapshot() {
  return {
    exists: true,
    data: () => ({
      settings: {
        professionalProfile: {
          displayName: 'DADO PESSOAL NÃO DEVE APARECER',
          email: 'pessoal@example.invalid',
          phone: '000000000',
        },
        services: [
          { name: 'SERVIÇO NÃO DEVE APARECER', defaultDurationMinutes: 50 },
        ],
        locations: [
          { displayName: 'LOCAL NÃO DEVE APARECER', address: 'ENDEREÇO NÃO DEVE APARECER' },
        ],
        agenda: { defaultDurationMinutes: 50, intervalMinutes: 15 },
      },
    }),
  };
}

test('R83 projeta somente metadados sanitizados e não retorna valores de Settings', () => {
  const result = projectPsychologySettingsSnapshot(snapshot());

  assert.deepEqual(result, {
    ok: true,
    settingsFound: true,
    settingsStructureValid: true,
    servicesPresent: true,
    servicesCount: 1,
    locationsPresent: true,
    locationsCount: 1,
    agendaDefaultsPresent: true,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('professionalProfile'), false);
  assert.equal(serialized.includes('pessoal@example.invalid'), false);
  assert.equal(serialized.includes('SERVIÇO NÃO DEVE APARECER'), false);
  assert.equal(serialized.includes('ENDEREÇO NÃO DEVE APARECER'), false);
});

test('R83 solicita somente field paths operacionais e nunca faz fallback para leitura bruta', async () => {
  const calls = [];
  const db = {
    collection(path) {
      assert.equal(path, 'workspaces/workspace-r83/professionals/professional-r83/contexts/PSICOLOGIA/settings');
      return {
        doc(id) {
          assert.equal(id, 'settings');
          return {
            get: () => { throw new Error('raw get must not be called'); },
          };
        },
      };
    },
    async getAll(...args) {
      calls.push(args);
      return [snapshot()];
    },
  };

  const result = await readPsychologySettingsProjection({ db, runtimeScope: scope });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2);
  assert.deepEqual(calls[0][1], { fieldMask: SETTINGS_OPERATIONAL_FIELD_PATHS });
  assert.equal(SETTINGS_OPERATIONAL_FIELD_PATHS.some(path => path.includes('professionalProfile')), false);
  assert.deepEqual(SETTINGS_PERSONAL_FIELD_PATHS, [
    'settings.professionalProfile.displayName',
    'settings.professionalProfile.professionalTitle',
    'settings.professionalProfile.professionalRegistration',
    'settings.professionalProfile.clinicDisplayName',
    'settings.professionalProfile.email',
    'settings.professionalProfile.phone',
  ]);
});

test('R83 bloqueia escopo não resolvido antes de qualquer chamada Firestore', async () => {
  let reads = 0;
  const db = {
    collection() {
      reads += 1;
      throw new Error('Firestore must not be reached');
    },
    getAll() {
      reads += 1;
      throw new Error('Firestore must not be reached');
    },
  };

  await assert.rejects(
    () => readPsychologySettingsProjection({ db, runtimeScope: { context: 'PSICOLOGIA', professionalId: 'professional-r83' } }),
    error => error.code === 'psychology/settings-projection-scope-unavailable',
  );
  assert.equal(reads, 0);
});

test('R83 sanitiza erro sem reproduzir mensagem ou credencial', () => {
  const result = sanitizePsychologySettingsProjectionError(Object.assign(
    new Error('sensitive projection detail must not appear'),
    { code: '7', statusCode: 503 },
  ));

  assert.equal(result.ok, false);
  assert.equal(result.errorName, 'PsychologySettingsProjectionError');
  assert.equal(result.errorCode, 'psychology/settings-projection-failed');
  assert.equal(result.httpStatus, 503);
  assert.equal(result.messageSanitized.includes('sensitive'), false);
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
});

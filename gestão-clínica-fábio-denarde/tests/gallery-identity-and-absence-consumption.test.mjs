import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildProfessionalGalleryPatientCards,
  normalizeSessionPackageConsumption,
} from '../shared/galleryPatientCards.js';
import {
  getSessionCycleLabel,
  getSessionPackagePosition,
  mergeSessionSequenceSource,
  sessionConsumesPackage,
} from '../shared/sessionScheduling.js';
import { buildCurrentPackageSessionSummary } from '../shared/sessionPackageSummary.js';
import { calculateCanonicalPackageFinancialSummary } from '../shared/packageFinancialSummary.js';
import { buildActivityMediaPackageModel } from '../shared/activityMediaPackages.js';
import { buildResponsiblePackages } from '../api/_lib/responsiblePortalPackages.js';
import { buildMonitoringPatientSummary } from '../shared/monitoringPanel.js';

const TODAY = '2026-07-24';
const PATIENT_ID = 'patient-gallery-fictional';
const PATIENT = {
  id: PATIENT_ID,
  name: 'Paciente Canônico',
  fullName: 'Responsável Contaminante',
  guardianName: 'Responsável Contaminante',
  photoUrl: 'patient-photo.jpg',
  photoDriveFileId: 'patient-photo-drive-id',
  status: 'Ativo',
  startDate: '2026-01-01',
  paymentModal: 'PADRÃO: Pix integral',
};
const PAYMENTS = [
  { id: 'p1', patientId: PATIENT_ID, packageNumber: 1, amount: 1000, date: '2026-01-01' },
  { id: 'p2', patientId: PATIENT_ID, packageNumber: 2, amount: 1000, date: '2026-04-01' },
];

function consumedSessions(count = 18) {
  return Array.from({ length: count }, (_, index) => ({
    id: `consumed-${index + 1}`,
    patientId: PATIENT_ID,
    date: `2026-${String(Math.floor(index / 6) + 1).padStart(2, '0')}-${String((index % 6) + 1).padStart(2, '0')}`,
    time: '10:00',
    status: 'Realizada',
  }));
}

function absence(id, time, consumesPackage) {
  return {
    id,
    patientId: PATIENT_ID,
    date: TODAY,
    time,
    status: 'Falta',
    consumesPackage,
  };
}

function galleryCards(patients, sessions, search = '', patientOptions = null) {
  return buildProfessionalGalleryPatientCards({
    patients,
    patientOptions: patientOptions || patients.map(patient => ({
      id: patient.id,
      name: patient.fullName || patient.name,
    })),
    sessions,
    payments: PAYMENTS,
    search,
    now: new Date('2026-07-24T18:00:00-03:00'),
  });
}

test('1-11. Galeria mantém exclusivamente a identidade vinculada ao patientId', () => {
  const portalOption = {
    id: PATIENT_ID,
    name: 'Responsável Contaminante',
    displayName: 'Responsável Contaminante',
    photoUrl: 'responsible-photo.jpg',
  };
  const sibling = {
    ...PATIENT,
    id: 'patient-gallery-sibling',
    name: 'Segundo Atendente',
    fullName: 'Segundo Atendente Completo',
    photoUrl: 'second-patient-photo.jpg',
  };
  const sessions = consumedSessions();
  const cards = galleryCards([PATIENT, sibling], sessions, '', [portalOption, {
    id: sibling.id,
    name: 'Responsável Contaminante',
    photoUrl: 'responsible-photo.jpg',
  }]);

  assert.equal(cards.length, 2);
  assert.equal(cards[0].name, 'Paciente Canônico');
  assert.notEqual(cards[0].name, 'Responsável Contaminante');
  assert.equal(cards[0].photoUrl, 'patient-photo.jpg');
  assert.equal(cards[0].photoDriveFileId, 'patient-photo-drive-id');
  assert.equal(cards[0].id, PATIENT_ID);
  assert.deepEqual(galleryCards([PATIENT], sessions, 'paciente').map(card => card.id), [PATIENT_ID]);
  assert.deepEqual(galleryCards([PATIENT], sessions, 'elton'), []);
  assert.deepEqual(new Set(cards.map(card => card.id)).size, 2);
  assert.equal(JSON.parse(JSON.stringify(cards))[0].name, 'Paciente Canônico');
  assert.equal(cards.some(card => card.photoUrl === 'responsible-photo.jpg'), false);
});

test('12-28. duas faltas não contabilizadas mantêm Pacote 2 em 8/10 em todos os resumos', () => {
  const first = absence('absence-14', '14:00', false);
  const second = absence('absence-15', '15:00', false);
  const sessions = [...consumedSessions(), first, second];
  const summary = buildCurrentPackageSessionSummary(PATIENT, sessions, 10, { throughDate: TODAY });
  const financial = calculateCanonicalPackageFinancialSummary({
    patient: PATIENT,
    sessions,
    payments: PAYMENTS,
    today: TODAY,
  });
  const portal = buildResponsiblePackages(sessions, { today: TODAY, payments: PAYMENTS });
  const monitoring = buildMonitoringPatientSummary(PATIENT, sessions, { throughDate: TODAY });
  const media = buildActivityMediaPackageModel(sessions, {
    patientId: PATIENT_ID,
    payments: PAYMENTS,
    now: new Date('2026-07-24T18:00:00-03:00'),
  });
  const card = galleryCards([PATIENT], sessions)[0];

  assert.deepEqual([summary.count, summary.remaining], [8, 2]);
  assert.deepEqual([financial.completedSessionsInCurrentPackage, financial.remainingSessionsInCurrentPackage], [8, 2]);
  assert.deepEqual([card.packageNumber, card.consumedCount, card.remainingCount], [2, 8, 2]);
  assert.deepEqual([first, second].map(session => getSessionCycleLabel(sessions, session)), ['Sessão seria 9', 'Sessão seria 9']);
  assert.equal(financial.hasNewPackageWithoutPayment, false);
  assert.equal(financial.status, 'QUITADO');
  assert.deepEqual([portal.currentPackageNumber, portal.packages.at(-1).consumedCount], [2, 8]);
  assert.equal(monitoring.currentPackageRealized, 8);
  assert.equal(media.awaitingPaymentSessions.length, 0);
  assert.equal(media.consumedSessionCount, 18);
  assert.deepEqual(JSON.parse(JSON.stringify([first, second])).map(session => sessionConsumesPackage(session)), [false, false]);
  assert.equal(sessionConsumesPackage({ ...first, date: '2026-07-25' }, { throughDate: TODAY }), false);
  const virtual = { ...first, id: 'virtual-fixed', isVirtual: true };
  const persisted = { ...first, id: 'persisted-fixed' };
  assert.equal(mergeSessionSequenceSource([persisted], [virtual]).length, 1);
});

test('29-37. fronteiras true/false e normalização preservam a decisão explícita', () => {
  const base = consumedSessions();
  const expectations = [
    [true, false, 9, ['Sessão foi 9', 'Sessão seria 10']],
    [false, true, 9, ['Sessão seria 9', 'Sessão foi 9']],
    [true, true, 10, ['Sessão foi 9', 'Sessão foi 10']],
    [false, false, 8, ['Sessão seria 9', 'Sessão seria 9']],
  ];
  for (const [firstDecision, secondDecision, expectedCount, labels] of expectations) {
    const first = absence(`boundary-${firstDecision}-${secondDecision}-14`, '14:00', firstDecision);
    const second = absence(`boundary-${firstDecision}-${secondDecision}-15`, '15:00', secondDecision);
    const source = [...base, first, second];
    const summary = buildCurrentPackageSessionSummary(PATIENT, source, 10, { throughDate: TODAY });
    assert.equal(summary.count, expectedCount);
    assert.deepEqual([first, second].map(session => getSessionCycleLabel(source, session)), labels);
  }

  const legacy = absence('legacy', '16:00', undefined);
  delete legacy.consumesPackage;
  assert.equal(sessionConsumesPackage(legacy), false);
  assert.equal(normalizeSessionPackageConsumption({ ...legacy, consumesPackage: false }).consumesPackage, false);
  assert.equal(normalizeSessionPackageConsumption({ ...legacy, consumesPackage: 'false' }).consumesPackage, false);
  assert.equal(normalizeSessionPackageConsumption({ ...legacy, consumesPackage: 'true' }).consumesPackage, true);
  assert.equal(getSessionPackagePosition([...base, legacy], legacy).sessionNumber, 9);
});

test('consumidores visuais continuam ligados às funções compartilhadas', () => {
  const files = {
    gallery: fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8'),
    finance: fs.readFileSync(new URL('../src/components/Finance.tsx', import.meta.url), 'utf8'),
    patients: fs.readFileSync(new URL('../src/components/Patients.tsx', import.meta.url), 'utf8'),
    dashboard: fs.readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8'),
    reports: fs.readFileSync(new URL('../src/components/Reports.tsx', import.meta.url), 'utf8'),
    portal: fs.readFileSync(new URL('../api/_lib/responsiblePortalPackages.js', import.meta.url), 'utf8'),
    monitoring: fs.readFileSync(new URL('../shared/monitoringPanel.js', import.meta.url), 'utf8'),
    access: fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8'),
    galleryRepository: fs.readFileSync(new URL('../api/_lib/googlePhotosAlbumsRepository.js', import.meta.url), 'utf8'),
  };
  assert.match(files.gallery, /buildProfessionalGalleryPatientCards/);
  assert.match(files.gallery, /currentPackageConsumedCount/);
  assert.doesNotMatch(files.gallery, /Sessão \$\{latestEffectiveSession\.sessionNumber\} de 10/);
  assert.match(files.finance, /calculatePackageFinancialSummary/);
  assert.match(files.patients, /buildCurrentPackageSessionSummary/);
  assert.match(files.dashboard, /calculatePackageFinancialSummary/);
  assert.match(files.reports, /buildCurrentPackageSessionSummary/);
  assert.match(files.portal, /sessionConsumesPackage/);
  assert.match(files.monitoring, /buildCurrentPackageSessionSummary/);
  assert.match(files.access, /normalizePackageConsumptionDecision/);
  assert.match(files.galleryRepository, /packageConsumptionDecisionRecorded: consumptionDecision !== null/);
});

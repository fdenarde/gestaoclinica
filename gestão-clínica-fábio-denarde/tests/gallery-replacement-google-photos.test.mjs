import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const sidebarSource = fs.readFileSync('src/components/Navigation/SidebarNavigation.tsx', 'utf8');

test('menu profissional exibe uma única Galeria de Atividades', () => {
  const galleryItems = [...appSource.matchAll(/\{ id: 'galeria-[^']+', label: 'Galeria de [^']+'/g)];
  assert.equal(galleryItems.length, 1);
  assert.match(galleryItems[0][0], /id: 'galeria-atividades'/);
  assert.match(galleryItems[0][0], /label: 'Galeria de Atividades'/);
  assert.doesNotMatch(appSource, /label: 'Galeria de atividades \(Google Fotos\)'/);
});

test('identificador histórico abre a nova galeria por pacote', () => {
  assert.match(
    appSource,
    /activeTab === 'galeria-atividades'\s*&&\s*<ProfessionalGooglePhotosGallery/,
  );
  assert.doesNotMatch(appSource, /<ProfessionalActivityGallery/);
  assert.doesNotMatch(appSource, /const ProfessionalActivityGallery = lazy/);
  assert.doesNotMatch(appSource, /activeTab === 'galeria-google-fotos'/);
});

test('substituição não mantém a consulta automática de resumo da galeria antiga', () => {
  assert.doesNotMatch(appSource, /getProfessionalActivityGallerySummary/);
  assert.doesNotMatch(appSource, /activityGalleryMetrics/);
  assert.doesNotMatch(appSource, /EMPTY_ACTIVITY_GALLERY_METRICS/);
  assert.doesNotMatch(appSource, /activityUploadLateSessionCount=/);
});

test('menu lateral contém somente o identificador consolidado', () => {
  assert.match(sidebarSource, /ids: \['atendentes', 'galeria-atividades', 'pre-cadastros'\]/);
  assert.doesNotMatch(sidebarSource, /galeria-google-fotos/);
});

test('dados legados permanecem preservados sem carregamento automático na interface ativa', () => {
  assert.doesNotMatch(appSource, /getActivityPhotoUrl/);
  assert.match(appSource, /ACTIVITY_GALLERY_CHANGED_EVENT/);
  assert.doesNotMatch(appSource, /deleteActivity|removeActivity|purgeActivity|cleanupActivity/i);
  assert.ok(fs.existsSync('src/components/ActivityRecords/ProfessionalActivityGallery.tsx'));
  assert.ok(fs.existsSync('api/activity-records.js'));
});

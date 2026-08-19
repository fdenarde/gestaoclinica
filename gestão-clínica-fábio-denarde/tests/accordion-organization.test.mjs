import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const portalSource = fs.readFileSync(
  new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url),
  'utf8',
);
const monitoringSource = fs.readFileSync(
  new URL('../src/components/Monitoring/MonitoringPanel.tsx', import.meta.url),
  'utf8',
);
const gallerySource = fs.readFileSync(
  new URL('../src/components/GooglePhotosAlbums/ResponsibleGooglePhotosGallery.tsx', import.meta.url),
  'utf8',
);
const sessionProgressSource = fs.readFileSync(
  new URL('../shared/responsiblePortalSessions.js', import.meta.url),
  'utf8',
);

test('Sessões Agendadas usam accordion recolhido e ordenação decrescente por data real', () => {
  assert.match(portalSource, /const progress = useMemo/);
  assert.match(portalSource, /progress\.visibleGroups\.map/);
  assert.match(sessionProgressSource, /right\.sortKey\.localeCompare\(left\.sortKey\)/);
  assert.match(sessionProgressSource, /right\.number - left\.number/);
  assert.match(portalSource, /<details/);
  assert.match(portalSource, /<summary/);
  assert.match(portalSource, /group-open:rotate-180/);
  assert.match(portalSource, /Sessão com reposição vinculada/);
  assert.match(portalSource, /\{pkg\.consumedCount\}\/10 concluídas/);
  assert.match(portalSource, /\{pkg\.remainingCount\} restantes/);
});

test('Galeria do Monitoramento expande por atendente sem nova consulta de contagem', () => {
  assert.match(monitoringSource, /aria-expanded=\{expanded\}/);
  assert.match(monitoringSource, /aria-controls=\{galleryPanelId\}/);
  assert.match(monitoringSource, /current === summary\.patient\.id \? '' : summary\.patient\.id/);
  assert.match(monitoringSource, /summary\.activityCount/);
  assert.match(monitoringSource, /<ResponsibleGooglePhotosGallery/);
  assert.doesNotMatch(monitoringSource, /listGooglePhotosAlbums/);
});

test('Galeria do atendente agrupa sessões em accordion e mostra as mais recentes primeiro', () => {
  assert.match(gallerySource, /const sessionGroups = useMemo/);
  assert.match(gallerySource, /album\.sessionGroupKey/);
  assert.match(gallerySource, /right\.sortKey\.localeCompare\(left\.sortKey\)/);
  assert.match(gallerySource, /<details key=\{group\.key\}/);
  assert.match(gallerySource, /group-open:rotate-180/);
  assert.match(gallerySource, /listGooglePhotosAlbums\(\{ patientId, packageNumber, scope: 'portal', force \}\)/);
});

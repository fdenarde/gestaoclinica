import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sidebar = fs.readFileSync(new URL('../src/components/Navigation/SidebarNavigation.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const brand = fs.readFileSync(new URL('../src/components/Common/BrandLogo.tsx', import.meta.url), 'utf8');

test('marca expandida usa variante dimensionada para a largura real da barra lateral', () => {
  assert.match(sidebar, /variant="sidebar"/);
  assert.match(sidebar, /className="w-full min-w-0"/);
  assert.doesNotMatch(sidebar, /variant="horizontal"[\s\S]{0,180}whitespace-nowrap/);
  assert.match(brand, /isSidebar[\s\S]*text-\[22px\]/);
});

test('largura e offset permanecem sincronizados nos estados expandido e recolhido', () => {
  assert.match(sidebar, /effectiveCollapsed \? 'w-\[76px\]' : 'w-\[320px\]'/);
  assert.match(sidebar, /props\.collapsed \? 'w-\[76px\]' : 'w-\[320px\]'/);
  assert.match(app, /sidebarCollapsed \? 'lg:pl-\[76px\]' : 'lg:pl-\[320px\]'/);
  assert.match(app, /<h1 className="truncate text-base font-black sm:text-lg">\{activeNavigationItem\.label\}<\/h1>/);
});

test('cabeçalho móvel exibe a marca Denarde Soluções logo na entrada sem esconder o título da página', () => {
  assert.match(app, /variant="mobile-header"/);
  assert.match(app, /showSubtitle=\{false\}/);
  assert.match(app, /className="max-w-full min-w-0"/);
  assert.match(app, /lg:hidden[\s\S]*\{activeNavigationItem\.label\}/);
  assert.match(brand, /variant\?: 'horizontal' \| 'compact' \| 'sidebar' \| 'mobile-header'/);
  assert.match(brand, /isMobileHeader[\s\S]*h-\[36px\][\s\S]*text-\[18px\]/);
});

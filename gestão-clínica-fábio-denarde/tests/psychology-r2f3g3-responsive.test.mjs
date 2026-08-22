import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const component = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');

test('R2F3-G3.1 inicia Psicologia em Agenda sem forçar retorno após a navegação', () => {
  assert.match(component, /const \[page, setPage\] = useState<PsychologyPage>\('agenda'\);/);
  assert.match(component, /const openPage = \(next: PsychologyPage\) => \{\s*setPage\(next\);/);
  assert.match(component, /\{page === 'day' && <DayView/);
  assert.match(component, /\{page === 'agenda' && <AgendaView/);
});

test('R2F3-G3 cria bottom navigation mobile com três áreas principais e Mais', () => {
  assert.match(component, /data-testid="psychology-bottom-nav"/);
  assert.match(component, /data-testid="psychology-more-button"/);
  assert.match(component, /\['day', 'Meu Dia', CalendarDays\]/);
  assert.match(component, /\['patients', 'Pacientes', UsersRound\]/);
  assert.match(component, /\['agenda', 'Agenda', CalendarDays\]/);
  assert.match(component, /<span>Mais<\/span>/);
});

test('R2F3-G3 mantém somente áreas operacionais prontas no menu Mais', () => {
  assert.match(component, /\['personal', 'Agenda Pessoal', WalletCards\]/);
  assert.match(component, /\['settings', 'Ajustes', Pencil\]/);
  assert.doesNotMatch(component, /\['finance', 'Financeiro'/);
  assert.doesNotMatch(component, /\['reports', 'Relatórios'/);
  assert.match(component, /aria-haspopup="dialog"/);
  assert.match(component, /aria-label="Mais opções da Psicologia"/);
});

test('R2F3-G3 compacta header e badge no mobile sem remover a identidade desktop', () => {
  assert.match(component, /data-testid="psychology-environment-badge"/);
  assert.match(component, /<span className="sm:hidden">Psicologia<\/span>/);
  assert.match(component, /<span className="hidden truncate sm:inline">\{runtimeIdentity.profile.displayName/);
});

test('R2F3-G3 protege conteúdo da bottom nav e considera safe area', () => {
  assert.match(component, /psychology-mobile-content/);
  assert.match(styles, /\.psychology-bottom-nav\s*\{/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /\.psychology-more-sheet-backdrop\s*\{/);
});

test('R2F3-G3 usa controle de data com alvos de toque e ações acessíveis', () => {
  assert.match(component, /data-testid="psychology-date-toolbar"/);
  assert.match(component, /aria-label="Dia anterior"/);
  assert.match(component, /aria-label="Próximo dia"/);
  assert.match(component, /className="min-h-11 shrink-0 rounded-xl px-2\.5 text-xs font-black text-violet-700/);
  assert.match(styles, /button\[aria-label\^="Fechar"\][\s\S]*min-height: 3rem/);
});

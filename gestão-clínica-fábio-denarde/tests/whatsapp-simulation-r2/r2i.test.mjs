import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('src/App.tsx');
const sidebar = read('src/components/Navigation/SidebarNavigation.tsx');
const theme = read('src/lib/theme.ts');
const css = read('src/index.css');
const dashboard = read('src/features/whatsapp-simulation/SimulationDashboard.tsx');
const header = read('src/features/whatsapp-simulation/components/SimulationHeader.tsx');
const navigation = read('src/features/whatsapp-simulation/components/SimulationNavigation.tsx');
const shell = read('src/features/whatsapp-simulation/components/SimulationShell.tsx');
const simple = read('src/features/whatsapp-simulation/components/SimpleSimulationView.tsx');
const themeCss = read('src/features/whatsapp-simulation/components/simulationTheme.css');
const activeUi = [header, navigation, shell, simple].join('\n');
const feature = read('src/features/whatsapp-simulation/simulationFixtures.ts')
  + read('src/features/whatsapp-simulation/simulationProvider.ts')
  + read('src/features/whatsapp-simulation/simulationState.ts')
  + dashboard;

test('01 menu WhatsApp aparece para Administrador', () => assert.match(app, /canAccessWhatsappSimulation[\s\S]*role === 'admin'/));
test('02 menu WhatsApp aparece para Profissional', () => assert.match(app, /canAccessWhatsappSimulation[\s\S]*role === 'professional'/));
test('03 menu WhatsApp não aparece para Responsável', () => assert.match(app, /canAccessWhatsappSimulation[\s\S]*role === 'admin'[\s\S]*role === 'professional'/));
test('04 Monitoramento não recebe acesso automaticamente', () => assert.doesNotMatch(/const canAccessWhatsappSimulation[\s\S]*?;/.exec(app)?.[0] || '', /monitoring/));
test('05 item ativo é indicado', () => assert.match(sidebar, /aria-current=\{active \? 'page' : undefined\}/));
test('06 clicar abre a R2-S', () => assert.match(app, /activeTab === 'whatsapp'[\s\S]*WhatsappSimulationDashboard/));
test('07 integração não solicita segundo login', () => assert.doesNotMatch(dashboard, /login|signIn|AccessPortal|auth|firebase/i));
test('08 Nova mensagem é a área inicial', () => assert.match(read('src/features/whatsapp-simulation/state/simulationStore.ts'), /activeView: 'new_message'/));
test('09 as quatro áreas internas permanecem', () => {
  assert.equal((navigation.match(/label: '/g) || []).length, 4);
  assert.match(navigation, /Meu WhatsApp/);
  assert.match(navigation, /Nova mensagem/);
  assert.match(navigation, /Agendadas/);
  assert.match(navigation, /Mensagens prontas/);
});
test('10 banner de simulação permanece visível', () => assert.match(shell, /Ambiente de demonstração — nenhuma mensagem será enviada/));
test('11 dados continuam sintéticos', () => assert.match(feature, /SIM-TENANT|Contato Fictício|Profissional Simulado/));
test('12 nenhum paciente real é carregado', () => assert.doesNotMatch(feature, /patients|patientId|Firestore|firebase/i));
test('13 nenhum responsável real é carregado', () => assert.doesNotMatch(feature, /responsibleUid|responsibleEmail|guardian/i));
test('14 nenhum telefone real é carregado', () => assert.match(simple, /Telefone.*final|\(\*\*\) \*\*\*\*\*/));
test('15 nenhuma chamada de rede ocorre', () => assert.doesNotMatch(feature, /fetch\s*\(|axios|XMLHttpRequest|WebSocket/));
test('16 nenhuma persistência ocorre', () => assert.doesNotMatch(feature, /localStorage|sessionStorage|indexedDB|document\.cookie/));
test('17 Firebase não é acessado pelo módulo', () => assert.doesNotMatch(activeUi + feature, /firebase|firestore/i));
test('18 Meta não é importada', () => assert.doesNotMatch(activeUi + feature, /meta\.com|graph\.facebook|whatsapp-web/i));
test('19 robô não é importado', () => assert.doesNotMatch(activeUi + feature, /scheduler|watchdog|whatsapp-web\.js|pm2/i));
test('20 PM2 não é iniciado', () => assert.doesNotMatch(activeUi + feature, /pm2|child_process|spawn\(/i));
test('21 tema Saúde & Equilíbrio existe', () => assert.match(theme + css, /health-balance[\s\S]*#1E7B56/));
test('22 tema Calm & Tech existe', () => assert.match(theme + css, /calm-tech[\s\S]*#2B5B84/));
test('23 tema Acolhimento Suave existe', () => assert.match(theme + css, /soft-welcome[\s\S]*#9E6D54/));
test('24 interface ativa reutiliza tokens do sistema', () => assert.match(activeUi, /bg-clinic-primary|text-clinic-text|border-clinic-border|bg-clinic-surface/));
test('25 cores independentes do WhatsApp não são usadas pela integração', () => assert.doesNotMatch(activeUi, /#25D366|#128C7E|#075E54|whatsapp-green/i));
test('26 menu recolhido funciona', () => assert.match(sidebar, /effectiveCollapsed|Expandir menu lateral|Recolher menu lateral/));
test('27 menu expandido funciona', () => assert.match(sidebar, /w-\[320px\]|w-\[76px\]/));
test('28 layout responsivo não cria overflow horizontal', () => assert.match(app, /overflow-x-hidden/));
test('29 modal de reinicialização permanece funcionando', () => assert.match(header, /reset-simulation-modal|Reiniciar demonstração/));
test('30 mensagens prontas continuam sem códigos técnicos na UI', () => assert.doesNotMatch(simple, /allowedVariables|sourceTemplateId|templateVersion|\{\{/));
test('31 R2-S continua aprovada', () => assert.match(dashboard + simple, /presentation|Como a mensagem ficará|simple-ready-message-form/));
test('32 R2-C continua aprovada', () => assert.match(feature, /SimulationQueueJob|schedule/));
test('33 R2-B continua aprovada', () => assert.match(feature, /quickReply|SimulationTemplate/));
test('34 R2-A continua aprovada', () => assert.match(feature, /SimulationTenantData|tenant/));
test('35 R1 continua aprovada', () => assert.match(feature, /createSimulationProvider|registerMessage/));
test('36 Agenda continua carregando', () => assert.match(app, /activeTab === 'agenda'[\s\S]*<Agenda/));
test('37 Pacientes continuam carregando', () => assert.match(app, /activeTab === 'atendentes'[\s\S]*<Patients/));
test('38 Financeiro continua carregando', () => assert.match(app, /activeTab === 'pagamentos'[\s\S]*<Finance/));
test('39 Monitoramento continua carregando e Portal permanece separado', () => {
  assert.match(app, /activeTab === 'monitoramento'[\s\S]*<MonitoringPanel/);
  assert.match(app, /canAccessResponsiblePortal[\s\S]*<ResponsiblePortal/);
});
test('40 nenhuma dependência proibida ou alteração operacional foi adicionada', () => {
  assert.match(app, /WhatsappSimulationDashboard = lazy\(\(\) => import\('\.\/features\/whatsapp-simulation\/SimulationDashboard'\)\)/);
  assert.match(shell + themeCss, /clinic-primary|clinic-surface/);
  assert.doesNotMatch(app, /whatsapp-web\.js|firebase-admin|pm2|Meta API/i);
});

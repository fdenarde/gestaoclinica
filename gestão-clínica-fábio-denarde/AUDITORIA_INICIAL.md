# AUDITORIA INICIAL - SISTEMA GESTAO CLINICA FABIO DENARDE

Data da auditoria: 2026-06-04

Escopo: inventario estatico do projeto local em producao. Nenhum script operacional foi executado. Nenhum acesso ao Firestore foi realizado. Nenhum envio de WhatsApp foi disparado. Nenhum arquivo de codigo, configuracao, credencial, cache ou dado foi alterado nesta fase.

## 1. Resumo executivo

O projeto e um sistema critico de gestao clinica com dados reais de pacientes, agenda, historico clinico, financeiro, relatorios, agenda pessoal com alarmes e automacao de WhatsApp.

Stack principal:
- Frontend: React 19, TypeScript, Vite, Tailwind CSS 4.
- Banco: Firebase Firestore, database nomeado `ai-studio-587970e5-0653-44a5-93a3-be1a74301eda`.
- Autenticacao: Firebase Auth com Google.
- Storage: Firebase Storage inicializado no frontend.
- WhatsApp: `whatsapp-web.js` com `LocalAuth`, Puppeteer e `node-cron`.
- Processo em producao local: PM2 via `ecosystem.config.cjs`.
- Deploy: Vercel como principal, GitHub Pages como reserva, conforme documentacao do projeto.

Resultado inicial: o sistema tem sinais de funcionamento, mas tambem possui riscos criticos para producao, principalmente em seguranca de credenciais/sessao WhatsApp, escrita ampla em colecoes, scripts administrativos destrutivos e duplicacao de regras criticas entre frontend e robo.

## 2. Estrutura de pastas e arquivos

Raiz do workspace:
- `.git/`: repositorio Git.
- `.agent/`, `.claude/`: artefatos de agentes/assistentes.
- `dist/`: build na raiz externa.
- `node_modules/`: dependencias externas na raiz externa.
- `public/`: artefatos publicos externos.
- `gestão-clínica-fábio-denarde/`: projeto principal.
- `gestão-clínica-fábio-denarde.zip`: ZIP do projeto.
- `ecosystem.config.cjs`: configuracao PM2 com frontend e robo WhatsApp.
- `watch-and-deploy.cjs`: watcher antigo de deploy automatico, documentado como desativado.
- `package.json`, `package-lock.json`: manifestos externos minimos.

Projeto principal `gestão-clínica-fábio-denarde/`:
- `src/`: frontend React/TypeScript.
- `src/components/`: telas e componentes principais.
- `src/lib/`: funcoes utilitarias, regras de agenda/lembretes, alarmes e sons.
- `src/scripts/`: script de migracao de pacotes executavel a partir do app se importado.
- `public/sounds/`: arquivos WAV dos alarmes.
- `scratch/`: scripts de diagnostico, simulacao e alguns scripts com escrita/delecao no Firestore.
- `scripts/`: script de geracao de sons.
- `server.js`: robo principal de WhatsApp em producao.
- `force-send-reminders.js`: envio manual/forcado de lembretes via WhatsApp.
- `send-test-whatsapp.js`: envio real de mensagem de teste via WhatsApp.
- `dry_run_reminders.js`, `report-semana.js`, `test-messages.js`: simulacao/diagnostico de mensagens.
- `delete-celso.js`: script destrutivo que deleta sessao especifica.
- `firebase-key.json`: chave Admin SDK local. Conteudo nao foi aberto nesta auditoria por seguranca.
- `firebase-key - Copia e seguranca do robo whatsapp.json`: copia local de chave Admin SDK. Conteudo nao foi aberto.
- `.wwebjs_auth/`, `.wwebjs_auth_temp/`, `.wwebjs_cache/`: dados de sessao/cache do WhatsApp/Puppeteer.
- `firestore.rules`: regras Firestore.
- `firebase.json`, `.firebaserc`, `firebase-applet-config.json`: configuracao Firebase.
- `.env.example`: exemplo de variaveis.
- `safe-deploy.cjs`, `PublicarSistema.bat`: fluxo de publicacao segura.
- `IniciaRoboClinica.bat`, `IniciaFrontend.bat`, `start-frontend.cjs`: inicializacao local.

Arquivos de frontend principais:
- `src/App.tsx`: autenticacao, listeners Firestore, estado global e persistencia.
- `src/types.ts`: tipos de paciente, sessao, pagamento, reposicao, despesa, evolucao, configuracao e agenda pessoal.
- `src/constants.ts`: configuracoes de horarios fixos e dados padrao.
- `src/firebase.ts`: inicializacao Firebase client, Auth, Firestore e Storage.
- `src/lib/utils.ts`: regras centrais de agenda, feriados, sessoes virtuais e plano de lembretes WhatsApp.
- `src/lib/useAlarms.ts`: alarmes locais via Howler e notificacoes do navegador.
- `src/lib/alarmSounds.ts`: leitura/upload de sons para Firebase Storage e colecao global `alarm_sounds`.
- `src/components/Agenda.tsx`: agenda clinica, status de sessoes, reposicoes, bloqueios.
- `src/components/Patients.tsx`: cadastro, dados clinicos, sessoes, pacotes, pagamentos, evolucoes e links WhatsApp.
- `src/components/Finance.tsx`: financeiro, despesas, repasse automatico.
- `src/components/Dashboard.tsx`: resumo operacional e link WhatsApp de aniversario.
- `src/components/Reports.tsx`: relatorios PDF/CSV/backup.
- `src/components/Settings.tsx`: configuracoes, feriados, import/export de pacientes.
- `src/components/PersonalAgenda.tsx`: agenda pessoal.

## 3. Dependencias e bibliotecas

Dependencias diretas de producao declaradas:
- `@google/genai`
- `@tailwindcss/vite`
- `@vitejs/plugin-react`
- `clsx`
- `date-fns`
- `dotenv`
- `express`
- `firebase`
- `firebase-admin`
- `howler`
- `jspdf`
- `jspdf-autotable`
- `lucide-react`
- `motion`
- `node-cron`
- `papaparse`
- `qrcode-terminal`
- `react`
- `react-dom`
- `tailwind-merge`
- `vite`
- `whatsapp-web.js`

Dependencias de desenvolvimento:
- `typescript`
- `tsx`
- `tailwindcss`
- `autoprefixer`
- tipos de Node, Express, Howler e PapaParse.

Observacoes:
- `express` aparece como dependencia, mas nao foi identificado servidor HTTP Express ativo no codigo principal auditado.
- `@google/genai` e `GEMINI_API_KEY` aparecem no manifesto/configuracao, mas nao foi identificado uso direto em `src/` ou `server.js` nesta varredura.
- `firebase-admin` e chave local sao usados por muitos scripts fora do frontend, inclusive scripts destrutivos.

## 4. Variaveis de ambiente e configuracoes

`.env.example`:
- `GEMINI_API_KEY`: chave para API Gemini, descrita como requerida pelo template AI Studio.
- `APP_URL`: URL hospedada do applet.

`vite.config.ts`:
- Usa `process.env.VERCEL` ou `env.VERCEL` para decidir o `base`.
- Define `process.env.GEMINI_API_KEY` no bundle a partir de `env.GEMINI_API_KEY`.
- Usa `DISABLE_HMR` para controle de HMR.

Firebase client:
- `firebase-applet-config.json` contem `projectId`, `appId`, `apiKey`, `authDomain`, `firestoreDatabaseId`, `storageBucket`, `messagingSenderId`.
- A `apiKey` client do Firebase nao e, por si so, segredo administrativo, mas depende de regras corretas.

Firebase Admin:
- `firebase-key.json` e sua copia local sao credenciais administrativas sensiveis. Conteudo nao foi lido.
- Scripts Node usam `fs.readFileSync('./firebase-key.json')`.

## 5. Banco de dados, colecoes e relacionamentos

Banco Firestore:
- Project: `ai-studio-applet-webapp-e3283`.
- Database: `ai-studio-587970e5-0653-44a5-93a3-be1a74301eda`.

Modelo principal:
- `users/{userId}/settings/{settingId}`
- `users/{userId}/patients/{patientId}`
- `users/{userId}/sessions/{sessionId}`
- `users/{userId}/payments/{paymentId}`
- `users/{userId}/repositions/{repositionId}`
- `users/{userId}/expenses/{expenseId}`
- `users/{userId}/evolutions/{evolutionId}`
- `users/{userId}/agenda_pessoal/{agendaId}`
- `users/{userId}/packages/{packageId}`

Colecao global adicional identificada:
- `alarm_sounds`: usada por `src/lib/alarmSounds.ts`, fora de `users/{uid}`.

Relacionamentos principais:
- `patients.id` -> referenciado por `sessions.patientId`, `payments.patientId`, `repositions.patientId`, `evolutions.patientId`.
- `sessions.id` -> referenciado por `repositions.originalSessionId` e opcionalmente `evolutions.sessionId`.
- `payments.id` -> referenciado por `expenses.pagamento_origem_id` quando `auto_gerado=true`.
- `settings/config.holidays[]` -> usado para bloquear sessoes virtuais e envios de WhatsApp.

Tipos principais:
- `Patient`: dados cadastrais, responsavel, WhatsApp, agenda fixa, modalidade de pagamento, anamnese, observacoes clinicas e status.
- `Session`: paciente, data, hora, tipo, status, pacote, bloqueio manual e origem.
- `Payment`: paciente, valor, data, parcela, metodo e pacote.
- `Reposition`: paciente, sessao original e status da reposicao.
- `Expense`: descricao, valor, data, categoria, auto-geracao e pagamento de origem.
- `Evolution`: paciente, sessao opcional, data e notas clinicas.
- `PersonalAppointment`: compromisso pessoal, recorrencia, alarme, som e status.

## 6. Regras de seguranca Firestore

Arquivo: `firestore.rules`.

Padrao:
- Bloqueio global por padrao.
- Acesso permitido a subcolecoes de `users/{userId}` somente quando `request.auth.uid == userId`.

Riscos iniciais:
- Nao ha validacao de schema, tipos, enums, limites ou campos obrigatorios.
- Nao ha regra para `alarm_sounds`, apesar do frontend tentar ler/escrever essa colecao global.
- Nao ha regra de Storage em `firebase.json`, embora o frontend inicialize Storage e tente upload em `sounds/alarms`.

## 7. Fluxos principais

### 7.1 Login
- `src/firebase.ts` configura Firebase Auth e `GoogleAuthProvider`.
- `App.tsx` usa `onAuthStateChanged`.
- Sem usuario autenticado, mostra tela de login Google.

### 7.2 Carregamento de dados
- `App.tsx` abre listeners `onSnapshot` para `settings`, `patients`, `sessions`, `payments`, `repositions`, `expenses`, `evolutions`, `agenda_pessoal`.
- Todos os dados dessas colecoes sao carregados para um estado unico `AppState`.

### 7.3 Persistencia
- `updateState(newState)` em `App.tsx` compara arrays atuais e proximos.
- Para cada colecao alterada, deleta documentos presentes no estado atual e ausentes no novo array, e grava documentos novos/alterados via batch.
- Risco: qualquer estado local incompleto ou concorrencia de abas pode resultar em delecoes indevidas.

### 7.4 Agenda clinica
- `src/lib/utils.ts` gera sessoes processadas por data.
- Sessoes manuais vem de `sessions`.
- Sessoes virtuais sao derivadas de `patients.fixedDay`, `patients.fixedTime` e `doubleSession`.
- Feriados em `settings.holidays` bloqueiam sessoes virtuais e mensagens.
- `Agenda.tsx` permite marcar presenca, falta, falta do profissional, cancelar, reabrir, remover, criar bloqueios e reposicoes.

### 7.5 Pacientes e pacotes
- `Patients.tsx` cadastra pacientes e pode gerar sessoes/pagamentos iniciais.
- Mudanca de dia/horario fixo pode realinhar sessoes futuras.
- Pacotes sao inferidos por sessoes e tambem existe `src/scripts/migratePackages.ts` para criar/atualizar colecao `packages`.

### 7.6 Financeiro
- `Finance.tsx` lista pagamentos e despesas.
- Ao criar pagamento, cria despesa de repasse automatico de 20%.
- Um `useEffect` sincroniza despesas automaticas com pagamentos, podendo criar/remover despesas automaticas.

### 7.7 Relatorios
- `Reports.tsx` gera PDF via jsPDF/jsPDF-autotable, CSV e backup JSON client-side.

### 7.8 Agenda pessoal e alarmes
- `PersonalAgenda.tsx` gerencia compromissos pessoais.
- `useAlarms.ts` verifica alarmes por `setInterval` e `setTimeout`, toca sons via Howler, vibra quando suportado e pode criar `Notification` no navegador.

### 7.9 WhatsApp
- Mapeado separadamente em `MAPEAMENTO_WHATSAPP.md`.

## 8. APIs, webhooks, filas, cron jobs e servicos externos

APIs/servicos externos:
- Firebase Auth.
- Firebase Firestore client.
- Firebase Firestore Admin SDK.
- Firebase Storage.
- WhatsApp Web via `whatsapp-web.js`.
- Vercel/GitHub Pages para deploy conforme documentacao.
- Browser Notification API.
- Links externos `https://wa.me/...`.

APIs HTTP proprias:
- Nenhuma API HTTP propria foi identificada em uso. `express` esta instalado, mas nao ha servidor Express operacional encontrado.

Webhooks:
- Nenhum webhook foi identificado na varredura estatica.

Filas:
- Nenhum sistema de filas foi identificado.

Cron jobs:
- `server.js` agenda tres rotinas via `node-cron`: 06:30, 09:00, 12:30.
- PM2 inicia `server.js` como processo `RoboClinica`.

Servicos de e-mail:
- Nenhum envio de e-mail foi identificado. Existem campos de e-mail em configuracoes e relatorios, mas sem SMTP/nodemailer.

Notificacoes:
- Notificacoes locais do navegador via `Notification` em `useAlarms.ts`.
- Sons via Howler.

## 9. Scripts com potencial operacional

Scripts seguros somente se usados como leitura/simulacao:
- `dry_run_reminders.js`: simula plano de lembretes sem enviar.
- `report-semana.js`: relatorio/simulacao.
- `test-messages.js`: simula mensagens por console.
- Varios scripts em `scratch/` leem Firestore para diagnostico.

Scripts que podem enviar WhatsApp real:
- `server.js`
- `force-send-reminders.js`
- `send-test-whatsapp.js`

Scripts que podem alterar dados reais:
- `delete-celso.js`: deleta sessao especifica.
- `scratch/fix_celso.js`: atualiza paciente e deleta sessoes.
- `scratch/create_june_sessions.js`: cria sessoes.
- `src/scripts/migratePackages.ts`: deleta pacotes antigos, atualiza sessoes e cria pacotes.

## 10. Riscos tecnicos classificados

### CRITICO

1. Credenciais Admin SDK presentes no diretorio do projeto.
- Local: `firebase-key.json` e copia de seguranca.
- Impacto: acesso administrativo total ao Firestore se vazadas.
- Observacao: conteudo nao foi aberto.

2. Sessao/cache WhatsApp presentes no projeto e parte rastreada pelo Git.
- Local: `.wwebjs_auth/`, `.wwebjs_auth_temp/`, `.wwebjs_cache/`.
- Evidencia: `git ls-files` indicou arquivos rastreados em `.wwebjs_auth_temp` e `.wwebjs_cache`.
- Impacto: risco de exposicao de sessao/dados do navegador/WhatsApp.

3. Scripts destrutivos com Firebase Admin no repositorio.
- Locais: `delete-celso.js`, `scratch/fix_celso.js`, `scratch/create_june_sessions.js`, `src/scripts/migratePackages.ts`.
- Impacto: perda ou corrupcao de dados reais se executados por engano.

4. Escrita por sincronizacao de colecao inteira.
- Local: `src/App.tsx`.
- Impacto: risco de deletar documentos por estado local incompleto, concorrencia ou latencia.

### ALTO

5. Duplicacao de regra critica de agenda/lembrete entre frontend e robo.
- Locais: `src/lib/utils.ts`, `server.js`, scripts de simulacao.
- Impacto: divergencia pode causar envio indevido ou falta de envio.

6. WhatsApp manual forcado sem dry-run obrigatorio.
- Local: `force-send-reminders.js`.
- Impacto: mensagens reais para responsaveis em horarios/tipos errados.

7. `send-test-whatsapp.js` usa numero dos Ajustes se nenhum argumento for informado.
- Impacto: teste pode enviar mensagem real para telefone configurado da clinica.

8. Regras Firestore sem validacao de schema.
- Impacto: bugs de frontend podem persistir dados invalidos ou corrompidos.

9. `innerHTML` em toast.
- Local: `src/components/Common/Toast.tsx`.
- Impacto: XSS se mensagem vier de conteudo controlavel por usuario/importacao.

### MEDIO

10. Bundle de producao grande.
- Evidencia anterior: Vite alertou chunk principal > 500 KB.
- Impacto: carregamento lento e pior experiencia em rede ruim.

11. Uso disseminado de `Math.random()` para IDs.
- Impacto: baixa probabilidade de colisao, sem rastreabilidade robusta.

12. Integracao `alarm_sounds`/Storage incompleta.
- Local: `src/lib/alarmSounds.ts`.
- Impacto: falhas silenciosas e fallback para sons locais.

13. Componentes muito grandes concentram UI e dominio.
- Locais: `Patients.tsx`, `Agenda.tsx`, `Finance.tsx`.
- Impacto: manutencao dificil e alto risco de regressao.

14. Muitos scripts admin leem dados reais e imprimem dados sensiveis no terminal.
- Impacto: exposicao operacional em logs locais.

### BAIXO

15. Dependencias possivelmente nao usadas.
- Exemplos: `express`, `@google/genai`.
- Impacto: aumento de superficie e ruído de manutencao.

16. Arquivos de backup/temporarios no projeto.
- Exemplos: `Finance_bkp.tsx`, `temp_schedule*.json`, ZIP.
- Impacto: confusao e risco de publicar material indevido.

## 11. Testes e verificacoes ja realizadas

Verificacoes mecanicas feitas antes desta missao critica:
- `npm run lint`: passou.
- `npm run build`: passou com alerta de bundle grande.

Verificacoes nao realizadas nesta fase por seguranca:
- Nenhum script de WhatsApp foi executado.
- Nenhum script Firebase Admin foi executado.
- Nenhum teste end-to-end contra producao foi executado.
- Nenhuma migracao foi executada.
- Nenhum arquivo de credencial foi aberto.

## 12. Plano de correcao preliminar, sem execucao

Antes de qualquer alteracao, deve ser apresentado um plano especifico contendo:
- Arquivos afetados.
- Motivo.
- Impacto esperado.
- Riscos.
- Rollback.
- Validacao.

Prioridade recomendada:
1. Congelar execucao de scripts destrutivos e de envio manual ate revisao.
2. Fazer backup verificado do Firestore antes de qualquer mudanca.
3. Corrigir higiene de credenciais e sessoes WhatsApp com plano de rotacao.
4. Substituir persistencia ampla por operacoes granulares.
5. Unificar regra de agenda/lembretes em modulo compartilhado testado.
6. Reforcar regras Firestore e validar schemas.
7. Definir suite de testes de regressao para cadastro, agenda, financeiro, relatorios, login, permissoes e WhatsApp.

## 13. Condicao de parada

Qualquer alteracao que envolva:
- remocao de documentos,
- migracao de colecoes,
- alteracao de status/sessoes/pacotes,
- mudanca de logica WhatsApp,
- limpeza de credenciais/sessao,
- ou alteracao de regras de acesso,

deve parar para autorizacao explicita apos plano de rollback e validacao.

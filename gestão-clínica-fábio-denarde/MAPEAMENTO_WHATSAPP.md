# MAPEAMENTO WHATSAPP - SISTEMA GESTAO CLINICA FABIO DENARDE

Data da auditoria: 2026-06-04

Escopo: mapeamento estatico de todos os pontos encontrados que podem gerar, preparar, simular ou enviar mensagens WhatsApp. Nenhum script foi executado. Nenhuma mensagem foi enviada. Nenhuma sessao do WhatsApp foi iniciada.

## 1. Classificacao dos pontos WhatsApp

Foram identificadas tres classes:

1. Envio automatico real via `whatsapp-web.js`.
2. Envio manual/forcado real via scripts Node.
3. Links `https://wa.me/...` no frontend, que abrem o WhatsApp com mensagem pre-preenchida e dependem de acao humana para envio.

Nao foram identificados:
- Webhooks WhatsApp.
- Filas de mensagens.
- Servico externo oficial WhatsApp Business API.
- Envio por e-mail.

## 2. Infraestrutura WhatsApp

Biblioteca:
- `whatsapp-web.js`

Autenticacao:
- `LocalAuth` com `dataPath: './.wwebjs_auth'`.

Cache/sessao local:
- `.wwebjs_auth/`
- `.wwebjs_auth_temp/`
- `.wwebjs_cache/`

QRCode:
- `qrcode-terminal` imprime QR Code quando necessario.

Processo:
- `server.js` e iniciado por `npm run server`.
- PM2 configura processo `RoboClinica` em `ecosystem.config.cjs`.
- `IniciaRoboClinica.bat` aguarda 20 segundos, entra na pasta do projeto e executa `npm run server`.

Risco critico:
- Arquivos de sessao/cache do WhatsApp existem no projeto e parte foi detectada como rastreada pelo Git.

## 3. Rotina principal de producao: `server.js`

Local:
- `server.js`

Tipo:
- Envio automatico real via `client.sendMessage`.

Gatilho:
- Processo iniciado por PM2, `.bat` ou `npm run server`.
- Cron jobs internos via `node-cron`.

Cron jobs:
- `30 6 * * *`: executa `dispararLembretes('HOJE_MANHA')`.
- `0 9 * * *`: executa `dispararLembretes('AMANHA')`.
- `30 12 * * *`: executa `dispararLembretes('HOJE_TARDE')`.

Regras de dia:
- 06:30: pula domingo.
- 09:00: pula sabado, pois amanha seria domingo.
- 12:30: pula domingo.

Fonte de dados:
- `collectionGroup('settings')` para localizar usuarios/configuracoes.
- `users/{userId}/settings/config`.
- `users/{userId}/patients`.
- `users/{userId}/sessions` filtrado por data.

Destinatarios:
- Responsaveis dos pacientes (`patient.whatsapp`) para lembretes de sessao.
- Numero da clinica/admin (`settings.whatsapp`) quando o disparo de vespera encontra feriado/recesso.

Filtro de envio para pacientes:
- Paciente precisa existir.
- Paciente precisa estar `Ativo`.
- Sessao precisa ter status `Agendada`.
- Paciente precisa ter WhatsApp cadastrado.
- Sessao nao pode estar cancelada.
- Sessao nao pode estar bloqueada manualmente.
- Data alvo nao pode ser feriado/recesso.
- Turno precisa bater com tipo do disparo, quando `HOJE_MANHA` ou `HOJE_TARDE`.

Sessoes virtuais:
- Geradas a partir de `fixedDay`, `fixedTime` e `doubleSession`.
- Se paciente tem `doubleSession`, gera dois horarios consecutivos.
- O plano final deduplica por `patientId` e envia apenas o horario mais cedo.

Conteudo enviado para vespera (`AMANHA`):
```text
Bom dia! Ola, {guardianName}, tudo bem?

Passando para lembrar voce da sessao de *{patientName}* amanha, as *{time}*.

Aguardo sua confirmacao,
Ate logo!
```

Conteudo enviado no dia (`HOJE_MANHA` / `HOJE_TARDE`):
```text
Bom dia!/Boa tarde!
Aguardo voces hoje as *{timeFormatted}*!
Ate logo! 🙏🏼
```

Conteudo enviado ao admin em vespera de feriado:
```text
*Lembrete do Robo*

Ola! Lembrando que amanha e feriado/recesso de *{holidayName}*.

O envio de mensagens automaticas de lembrete para os pacientes esta suspenso para amanha.
```

Intervalo entre mensagens:
- `await delay(5000)` entre envios.

Tratamento de falhas:
- Erros de browser/Puppeteer contendo termos como `detached`, `Protocol error`, `closed`, `session`, `frame` causam `process.exit(1)`.
- PM2 deve reiniciar se configurado externamente.

Riscos:
- CRITICO: qualquer alteracao em `getSessionsForDate` ou `getWhatsappReminderPlan` pode alterar destinatarios.
- CRITICO: timezone usa `new Date()` e `toISOString()` em pontos do fluxo; pode haver risco de data UTC vs local dependendo do ambiente.
- ALTO: `collectionGroup('settings')` varre todos os usuarios com settings.
- ALTO: duplicacao de logica com `src/lib/utils.ts` e scripts auxiliares.

## 4. Envio manual forcado: `force-send-reminders.js`

Local:
- `force-send-reminders.js`

Tipo:
- Envio real via `client.sendMessage`.

Gatilho:
- Execucao manual do arquivo Node.
- Ao evento `ready`, executa automaticamente:
  - `dispararLembretes('HOJE_MANHA')`
  - `dispararLembretes('AMANHA')`
- Se `ready` nao disparar, evento `authenticated` agenda bypass em 30 segundos e emite `ready`.

Destinatarios:
- Responsaveis dos pacientes incluidos nos planos `HOJE_MANHA` e `AMANHA`.

Quando dispara:
- Imediatamente apos conexao/autenticacao do WhatsApp, sem depender do horario real do cron.

Conteudo:
- Mesmo modelo de `server.js` para pacientes.

Intervalo:
- `await delay(3000)` entre envios.

Riscos:
- CRITICO: pode disparar mensagens reais fora do horario programado.
- CRITICO: executa dois tipos de rotina em sequencia.
- ALTO: nao envia aviso de feriado ao admin nesta rotina, apenas pula se feriado.
- ALTO: nao exige dry-run previo.

Regra de protecao:
- Nao modificar nem executar sem identificar data alvo, usuarios encontrados por `collectionGroup('settings')`, pacientes afetados, tipo de rotina e conteudo final.

## 5. Envio de teste real: `send-test-whatsapp.js`

Local:
- `send-test-whatsapp.js`

Tipo:
- Envio real via `client.sendMessage`.

Gatilho:
- Execucao manual ou `npm run test-wpp`.
- Ao `ready`, executa `executeTest()`.
- Ao `authenticated`, aguarda 15 segundos e executa `executeTest()` como bypass.

Destinatario:
- Numero informado em `process.argv[2]`, se existir.
- Se nenhum numero for informado, usa `settings.whatsapp` do primeiro documento encontrado por `collectionGroup('settings')`.

Conteudo:
```text
🤖 *Simulacao de Lembrete (Robo)*

Bom dia/Boa tarde! Aguardo voces hoje as 14:00!
Ate logo! 🙏
```

Riscos:
- ALTO: se executado sem argumento, envia para o numero dos Ajustes.
- MEDIO: mensagem tem texto de simulacao, mas ainda e envio real.

## 6. Links WhatsApp no frontend: `Patients.tsx`

Local:
- `src/components/Patients.tsx`

Tipo:
- Links `https://wa.me/55...` com texto pre-preenchido.
- Nao enviam automaticamente; dependem de clique e confirmacao/envio no WhatsApp pelo usuario.

### 6.1 Link direto do paciente

Local aproximado:
- Lista/cartao do paciente e detalhes cadastrais.

Destinatario:
- `patient.whatsapp`.

Conteudo:
- Sem texto pre-preenchido em alguns links, apenas abre conversa.

Gatilho:
- Clique manual do usuario.

### 6.2 Confirmar sessao

Local:
- Header de acoes no modal do paciente.

Gatilho:
- Clique em `Confirmar Sessao`.

Destinatario:
- `patient.whatsapp`.

Conteudo:
```text
Ola {guardianName}! Confirmando a sessao de {patientName} em {dataAtual} as {patient.fixedTime}. Qualquer duvida estou a disposicao. Fabio Denarde.
```

Risco:
- MEDIO: usa `new Date()` atual, nao necessariamente a data da proxima sessao.
- MEDIO: usa `patient.fixedTime`, pode divergir de reposicao/sessao manual.

### 6.3 Lembrar pagamento

Condicao de exibicao:
- `patient.paymentModal === PARCELADO` e `realizedInPackage >= 4`.

Destinatario:
- `patient.whatsapp`.

Conteudo:
```text
Ola {guardianName}! Passando para lembrar que a 2a parcela do pacote de {patientName} (R$500,00) sera na proxima sessao. Qualquer duvida estou a disposicao. Fabio Denarde.
```

Risco:
- MEDIO: valor fixo R$500,00 embutido no texto.
- MEDIO: depende de inferencia de pacote/sessoes realizadas.

### 6.4 Lembrar renovacao

Condicao de exibicao:
- `realizedInPackage >= 8`.

Destinatario:
- `patient.whatsapp`.

Conteudo:
```text
Ola {guardianName}! O pacote de sessoes de {patientName} esta chegando ao fim. Gostaria de conversar sobre a continuidade do atendimento? Fabio Denarde.
```

Risco:
- MEDIO: depende de contagem de sessoes/pacote.

## 7. Link WhatsApp no dashboard: aniversariantes

Local:
- `src/components/Dashboard.tsx`

Tipo:
- Link `https://wa.me/55...` com texto pre-preenchido.

Gatilho:
- Clique manual em `Enviar Parabens`.

Destinatario:
- `patient.whatsapp`.

Conteudo:
```text
Ola, {guardianName}! Gostariamos de desejar um feliz aniversario para {patientName} que esta completando {ageToComplete} anos! 🎉🎂 Um grande abraco de toda a equipe!
```

Riscos:
- BAIXO/MEDIO: envio depende de clique manual.
- MEDIO: calculo de idade a completar usa data atual e dia do nascimento; deve ser validado em viradas de mes/ano.

## 8. Rotinas de simulacao e diagnostico que montam planos de WhatsApp

Estes arquivos nao foram executados nesta fase. Pela leitura/varredura, eles calculam ou imprimem planos/mensagens, mas nao foi identificado `client.sendMessage` neles:

- `dry_run_reminders.js`
- `report-semana.js`
- `test-messages.js`
- `scratch/inspect_june_1_to_6.js`
- `scratch/simulate_week_messages.js`
- `scratch/simulate_today.js`
- `scratch/full_weekly_summary.cjs`
- `scratch/weekly_summary.cjs`
- `scratch/generate_week_report.js`

Riscos:
- MEDIO: podem imprimir nomes, telefones, horarios e dados sensiveis no terminal/log.
- MEDIO: alguns scripts sao marcados na propria documentacao como menos confiaveis para feriados.
- ALTO: se copiados/adaptados com `sendMessage`, podem virar fonte de disparo real sem controle.

## 9. Pontos que armazenam ou alteram WhatsApp de pacientes/clinica

Frontend:
- `Patients.tsx`: cadastro e edicao de `patient.whatsapp`.
- `Settings.tsx`: edicao de `settings.whatsapp`.
- `Settings.tsx`: exportacao/importacao CSV de pacientes inclui WhatsApp.

Banco:
- `users/{uid}/patients/{patientId}.whatsapp`
- `users/{uid}/settings/config.whatsapp`

Riscos:
- ALTO: telefone incorreto em paciente causa envio para destinatario errado.
- ALTO: telefone incorreto em `settings.whatsapp` afeta testes e avisos ao admin.
- MEDIO: nao foi identificada validacao robusta de telefone antes de salvar.

## 10. Regras de bloqueio de envio automatico

Conforme `server.js` e `src/lib/utils.ts`, mensagens automaticas devem ser bloqueadas quando:
- Sessao manual esta bloqueada (`isBlocked`).
- Paciente nao existe.
- Paciente esta inativo/concluido.
- Sessao esta cancelada.
- Paciente nao tem WhatsApp.
- Status da sessao nao e `Agendada`.
- Data alvo e feriado/recesso.
- Sessao esta fora do turno da rotina.
- Sessao duplicada de paciente em sessao dupla: somente horario mais cedo deve enviar.

Qualquer mudanca nesses filtros exige:
1. Identificar impacto.
2. Identificar destinatarios.
3. Identificar gatilhos.
4. Identificar riscos.
5. Propor testes de validacao.

## 11. Testes obrigatorios antes de qualquer mudanca em WhatsApp

Antes de alterar qualquer arquivo relacionado a WhatsApp:

1. Gerar dry-run para uma semana completa sem enviar mensagens.
2. Comparar plano do frontend (`src/lib/utils.ts`) com plano do robo (`server.js`).
3. Validar feriado/recesso.
4. Validar paciente sem WhatsApp.
5. Validar paciente inativo.
6. Validar sessao cancelada.
7. Validar status `Realizada`, `Falta`, `Falta.Prof`.
8. Validar sessao dupla.
9. Validar reposicao.
10. Validar bloqueio manual.
11. Validar que nenhum script manual sera executado durante testes.
12. Validar timezone/data local do ambiente onde PM2 roda.

## 12. Plano de rollback especifico para WhatsApp

Antes de qualquer alteracao:
- Registrar versao atual de `server.js`.
- Registrar versao atual de `src/lib/utils.ts`.
- Registrar versao atual de scripts de envio manual.
- Garantir que PM2 nao reinicie automaticamente uma versao parcialmente alterada.
- Ter comando documentado para parar `RoboClinica`.
- Ter backup de configuracoes `settings/config`.
- Ter dry-run validado por data/tipo antes de religar.

## 13. Condicoes de parada

Parar imediatamente e pedir autorizacao se:
- Houver duvida sobre destinatarios.
- Houver divergencia entre frontend e robo.
- Houver feriado/recesso envolvido.
- Houver paciente com telefone ambiguo.
- Houver risco de duplicidade de envio.
- Houver qualquer mudanca em `server.js`, `force-send-reminders.js`, `send-test-whatsapp.js`, `src/lib/utils.ts`, `Patients.tsx` ou `Dashboard.tsx` que altere conteudo, gatilho, destinatario ou filtro.

## 14. Lista consolidada de pontos de envio/mensagem

| Gravidade | Arquivo | Tipo | Gatilho | Destinatario | Envia automaticamente? |
|---|---|---|---|---|---|
| CRITICO | `server.js` | Lembrete automatico | Cron 06:30, 09:00, 12:30 | Responsaveis/admin | Sim |
| CRITICO | `force-send-reminders.js` | Lembrete forcado | Execucao manual + ready/authenticated | Responsaveis | Sim |
| ALTO | `send-test-whatsapp.js` | Teste real | Execucao manual + ready/authenticated | Numero argumento ou settings.whatsapp | Sim |
| MEDIO | `Patients.tsx` | Confirmar sessao | Clique manual | Responsavel | Nao, abre link |
| MEDIO | `Patients.tsx` | Lembrar pagamento | Clique manual | Responsavel | Nao, abre link |
| MEDIO | `Patients.tsx` | Lembrar renovacao | Clique manual | Responsavel | Nao, abre link |
| BAIXO/MEDIO | `Dashboard.tsx` | Parabens aniversario | Clique manual | Responsavel | Nao, abre link |
| MEDIO | Scripts dry-run/simulacao | Plano/console | Execucao manual | Apenas console | Nao identificado |

# Gestão Clínica Fábio Denarde — Documentação do Projeto

> Última atualização: 02/06/2026
>
> Use este documento para orientar qualquer IA ou desenvolvedor que for trabalhar neste projeto.

---

## 1. VISÃO GERAL

Sistema completo de gestão clínica para atendimento especializado (neuropsicopedagogia). Possui agenda clínica, agenda pessoal com alarmes, controle financeiro, relatórios, evolução de pacientes e um robô de WhatsApp que envia lembretes automáticos aos responsáveis.

| Item | Detalhe |
|---|---|
| Nome | Gestão Clínica Fábio Denarde |
| Stack | React 19 + TypeScript + Vite + Tailwind CSS 4 |
| Banco | Firebase Firestore (banco nomeado `ai-studio-587970e5-0653-44a5-93a3-be1a74301eda`) |
| Auth | Firebase Auth (Google) |
| Robô WhatsApp | `whatsapp-web.js` + Puppeteer + node-cron |
| Gerenciador | PM2 (2 processos: frontend + robô) |
| Deploy principal | **Vercel** — `https://gestaoclinica-solucoes.vercel.app/` |
| Deploy reserva | GitHub Pages — `https://fdenarde.github.io/gestaoclinica/` |
| Repositório | `https://github.com/fdenarde/gestaoclinica` |

---

## 2. ESTRUTURA DE PASTAS

```
D:\Backup Projeto Clinica completo\
├── ecosystem.config.cjs          # PM2: frontend + robô (AutoDeployWatcher DESATIVADO)
├── watch-and-deploy.cjs          # Script antigo de auto-deploy (DESATIVADO — NÃO USE)
│
└── gestão-clínica-fábio-denarde\
    ├── server.js                 # ROBÔ WHATSAPP (cron jobs 06:30, 09:00, 12:30)
    ├── safe-deploy.cjs           # Script SEGURO de deploy (USE ESTE)
    ├── PublicarSistema.bat       # Atalho Windows — 2 cliques para publicar
    ├── PROJECT_CONTEXT.md        # Este documento
    ├── package.json              # Dependências e scripts
    ├── vite.config.ts            # Config do Vite (base path condicional VERCEL)
    ├── tsconfig.json
    ├── firebase.json             # Firestore config (sem hosting)
    ├── firestore.rules           # Regras de segurança por usuário
    ├── firebase-key.json         # Admin SDK key (gitignored — NUNCA commitar)
    ├── firebase-applet-config.json  # Client SDK config (commitado)
    │
    ├── src\
    │   ├── App.tsx               # Entry point, auth, navegação, listeners Firestore
    │   ├── types.ts              # TODOS os tipos/interfaces/enums (SessionStatus, Patient, Session, etc.)
    │   ├── constants.ts          # SCHEDULE_CONFIG (dias e horários de atendimento)
    │   ├── index.css             # Tailwind + tema (cores, fontes)
    │   ├── firebase.ts           # Inicialização Firebase client
    │   ├── components\
    │   │   ├── Agenda.tsx        # Agenda clínica semanal (CORRIGIDA — mobile seguro)
    │   │   ├── PersonalAgenda.tsx # Agenda pessoal com alarmes sonoros
    │   │   ├── Dashboard.tsx     # Resumo do dia
    │   │   ├── Patients.tsx      # Cadastro de pacientes (dias/horários fixos)
    │   │   ├── Settings.tsx      # Configurações + feriados/recessos
    │   │   ├── Reports.tsx       # Relatórios
    │   │   ├── Payments.tsx      # Financeiro
    │   │   ├── Expenses.tsx      # Despesas
    │   │   ├── Evolutions.tsx    # Evolução clínica
    │   │   └── Common\
    │   │       ├── Modal.tsx     # Componente modal reutilizável
    │   │       └── Toast.tsx     # Notificações toast
    │   └── lib\
    │       ├── utils.ts          # LÓGICA CENTRAL: getSessionsForDate,
    │       │                     #   getWhatsappReminderPlan, feriados, etc.
    │       │                     #   (idêntico ao server.js — alterações devem
    │       │                     #    ser replicadas nos DOIS arquivos)
    │       └── useAlarms.ts      # Hook de alarmes sonoros (Howler.js)
    │
    ├── scratch\                   # Scripts de diagnóstico/simulação
    │   ├── inspect_june_1_to_6.js    # Auditoria semanal (ESPELHO FIEL do server.js)
    │   ├── simulate_week_messages.js # Simula envios do robô WhatsApp
    │   ├── dry_run_reminders.js      # Dry-run de lembretes (sem enviar WhatsApp)
    │   ├── view_settings.js          # Lê configurações + feriados do Firestore
    │   ├── list_fixed.js             # Lista pacientes com dia/horário fixo
    │   ├── diagnose_week.js          # Diagnóstico de pacientes/sessões da semana
    │   ├── generate_week_report.js   # ⚠️ NÃO CONFIÁVEL — não verifica feriados
    │   └── ... (outros scripts)
    │
    └── dist\                      # Build de produção (gitignored)
```

---

## 3. FLUXO DE DEPLOY (PUBLICAR SISTEMA)

### 3.1 Como publicar — 2 cliques

**Arquivo:** `PublicarSistema.bat` na pasta `gestão-clínica-fábio-denarde`.

O script executa 6 etapas automáticas:

| Etapa | Descrição | Se falhar |
|---|---|---|
| 1 | Verifica arquivos sensíveis (firebase-key, .wwebjs_auth, node_modules) | Para tudo |
| 2 | `npm run lint` (TypeScript) | Para tudo |
| 3 | `npm run build` (Vite) | Para tudo |
| 4 | Mostra resumo do que será publicado + links | — |
| 5 | Verifica .gitignore | Avisa, mas continua |
| 6 | Publica GitHub Pages (reserva) + `git add -A` + `git commit` + `git push origin main` | Para tudo |

O `git push` dispara o **Vercel** automaticamente (~1 minuto para atualizar).

### 3.2 Método principal: Vercel

O Vercel está conectado ao repositório `fdenarde/gestaoclinica`. Ao receber push no `main`, faz build e deploy automático.

**Link principal:** `https://gestaoclinica-solucoes.vercel.app/`

### 3.3 Método reserva: GitHub Pages

Publica a pasta `dist/` no branch `gh-pages`.

**Link reserva:** `https://fdenarde.github.io/gestaoclinica/`

### 3.4 AutoDeployWatcher — DESATIVADO

O watcher automático (`watch-and-deploy.cjs`) foi **removido do PM2** e **comentado no `ecosystem.config.cjs`**. Ele fazia commit/push cegamente a cada alteração de arquivo — perigoso.

**Nunca reative.** Use apenas `PublicarSistema.bat` ou `npm run safe-deploy`.

### 3.5 PM2 — Processos ativos

| Nome | Status | Script | Descrição |
|---|---|---|---|
| ClinicaFrontend | online | `start-frontend.cjs` | Vite dev server (porta 3000) |
| RoboClinica | online | `server.js` | WhatsApp bot |
| ~~AutoDeployWatcher~~ | removido | `watch-and-deploy.cjs` | — |

---

## 4. ROBÔ WHATSAPP (server.js)

### 4.1 Cron jobs

| Horário | Tipo | Alvo | Pula |
|---|---|---|---|
| 06:30 | `HOJE_MANHA` | Sessões do dia com hora < 12 | Domingo |
| 09:00 | `AMANHA` | Todas as sessões do dia seguinte | Sábado (amanhã = domingo) |
| 12:30 | `HOJE_TARDE` | Sessões do dia com hora ≥ 12 | Domingo |

### 4.2 Funções centrais — DUPLICADAS (manter sincronizadas)

As funções `getSessionsForDate` e `getWhatsappReminderPlan` existem em **dois lugares idênticos**:

| Arquivo | Uso |
|---|---|
| `src/lib/utils.ts` | Frontend (Agenda visual + dry-run) |
| `server.js` | Robô WhatsApp |

**⚠️ Regra crítica:** qualquer alteração em uma DEVE ser replicada na outra.

### 4.3 Lógica de geração de sessões

1. **Sessões manuais:** registros em `users/{uid}/sessions` com `date`, `time`, `status`
2. **Sessões virtuais (fixas):** geradas do campo `fixedDay` + `fixedTime` do paciente, se não houver sessão manual no mesmo horário
3. **Sessões duplas** (`doubleSession: true`): ocupam 2 horários consecutivos. Mensagem única com o horário mais cedo
4. **isValid / blockedReason:** usado pelo robô para filtrar o que enviar. Status ≠ "Agendada" → `isValid: false, blockedReason: 'status inválido'` — impede envio de WhatsApp para sessões finalizadas
5. **Feriados:** bloqueiam TODAS as mensagens (manuais e virtuais)

### 4.4 Bloqueios de envio

| Condição | blockedReason | Envia WhatsApp? |
|---|---|---|
| Sessão bloqueada manual (`isBlocked: true`) | `sessão manual bloqueadora` | Não |
| Paciente inativo | `paciente inativo` | Não |
| Status = Cancelada | `sessão cancelada` | Não |
| Sem WhatsApp cadastrado | `paciente sem WhatsApp` | Não |
| Status ≠ Agendada (Falta, Falta.Prof, Realizada, etc.) | `status inválido` | Não |
| Data é feriado | `feriado/recesso` | Não (bloqueia tudo) |

### 4.5 Modelos de mensagem

**Véspera (AMANHA):**
```
Bom dia! Olá, {guardianName}, tudo bem?

Passando para lembrar você da sessão de *{patientName}* amanhã, às *{time}*.

Aguardo sua confirmação,
Até logo!
```

**Dia (HOJE_MANHA / HOJE_TARDE):**
```
Bom dia! / Boa tarde!
Aguardo vocês hoje às *{timeFormatted}*!
Até logo! 🙏🏼
```

Formatação: `14:00` → `14h`, `14:30` → `14:30h`

### 4.6 Feriados

Cadastrados em `users/{uid}/settings/config.holidays`. O sistema gera automaticamente:
- Nacionais fixos (Confraternização, Tiradentes, Independência, etc.)
- Estaduais/municipais (Vila Velha, Nossa Senhora da Penha)
- Móveis (Páscoa, Carnaval, Corpus Christi + emenda)

Feriados bloqueiam: geração de sessões virtuais, plano de mensagens, envios. Na véspera de feriado, o robô avisa o admin.

---

## 5. AGENDA CLÍNICA (Agenda.tsx)

### 5.1 Interação nos cards (DESKTOP + MOBILE + TABLET)

| Dispositivo | Interação | Resultado |
|---|---|---|
| Desktop (hover) | Passar mouse no card (Agendada) | Overlay com botões rápidos: OK, Falta, Falta Prof., Cancelar, Remover |
| Desktop (clique) | Clicar no card (qualquer status) | Abre modal com ações apropriadas para o status |
| Mobile/Tablet (toque) | Tocar no card (qualquer status) | Abre modal com ações — **NUNCA executa ação automática** |

### 5.2 Ações disponíveis por status (modal)

| Status | Ações |
|---|---|
| **Agendada** | OK, Falta, Falta Prof., Cancelar, Remover |
| **Realizada** | ↻ Reabrir (volta p/ Agendada), Remover |
| **Falta** | ↻ Reabrir, Remover |
| **Falta Prof.** | ↻ Reabrir, Remover |
| **Cancelada** | ↻ Reabrir, Remover |
| **Reposição** | OK, Falta, Falta Prof., Cancelar, Remover |
| **Virtual/Fixo** | OK, Falta, Falta Prof., Cancelar (cria sessão real ao clicar) |
| **Bloqueado** | Remover |

### 5.3 `getStatusLabel` — NÃO retorna mais "Inválida"

A função usa `session.status` como fonte primária. Status como Falta.Prof, Cancelada, Realizada mostram o nome correto, **nunca** "Inválida".

### 5.4 Cores e legenda

| Status | Cor do card | Badge |
|---|---|---|
| Agendada | Branco | Verde |
| Realizada | Azul claro | Azul |
| Falta | Vermelho claro | Vermelho |
| Falta Prof. | Laranja claro | Laranja |
| Cancelada | Rosa/cinza | Cinza |
| Reposição | Azul claro | Azul |
| Bloqueado | Marrom | Marrom |
| Disponível | Verde tracejado | — |

A legenda de cores aparece **abaixo da grade semanal**, adaptada responsivamente.

### 5.5 Propriedade `isValid` no `ProcessedSession`

- `isValid: true` → sessão Agendada com paciente ativo e WhatsApp → **robô envia lembrete**
- `isValid: false` → **robô NÃO envia lembrete**
- **Importante:** a UI NÃO deve usar `isValid` para decidir o que mostrar ao usuário. Use `session.status` diretamente.

---

## 6. ESTRUTURA DO BANCO (Firestore)

Database: `ai-studio-587970e5-0653-44a5-93a3-be1a74301eda`

```
users/{userId}/
├── settings/config        # ClinicSettings (name, whatsapp, holidays[], etc.)
├── patients/{patientId}   # Patient (name, guardianName, fixedDay, fixedTime,
│                          #   doubleSession?, status, whatsapp, etc.)
├── sessions/{sessionId}   # Session (patientId, date, time, type, status,
│                          #   packageNumber, notes?, isBlocked?, blockName?)
├── payments/{paymentId}
├── repositions/{repoId}   # Reposition (patientId, originalSessionId, status)
├── expenses/{expenseId}
├── evolutions/{evolutionId}
└── agenda_pessoal/{apptId} # PersonalAppointment
```

### 6.1 Tipos principais (ver `src/types.ts`)

**SessionStatus enum:**
- `Agendada`, `Realizada`, `Falta`, `Falta.Prof`, `Cancelada`, `Reposição`

**Patient:** `id, name, birthDate, guardianName, whatsapp, fixedDay, fixedTime, doubleSession?, status ('Ativo'|'Concluído'), paymentModal, ...`

**Session:** `id, patientId, date, time, type (SIMPLES|DUPLA), status, notes?, packageNumber, isBlocked?, blockName?, ...`

**ClinicSettings:** `name, specialty, title, email, whatsapp, address, holidays: [{id, date, name}], ...`

**ProcessedSession** (extends Session): `isVirtual: boolean, isValid: boolean, blockedReason?: string`

---

## 7. CONFIGURAÇÃO DE HORÁRIOS (constants.ts)

```typescript
SCHEDULE_CONFIG = {
  'segunda': ['14:00','15:00','16:00','17:00','18:00','19:00'],
  'terça':  ['14:00','15:00','16:00','17:00','18:00','19:00'],
  'quarta': ['14:00','15:00','16:00','17:00','18:00','19:00'],
  'quinta': ['14:00','15:00','16:00','17:00','18:00','19:00'],
  'sexta':  ['14:00','15:00','16:00','17:00','18:00','19:00'],
  'sábado': ['07:00','08:00','09:00','10:00','11:00','14:00'],
}
```

Horários customizados com `:30` (ex: 17:30) são suportados via campo manual.

---

## 8. REGRAS IMPORTANTES

### 8.1 NUNCA FAÇA

- ❌ Commitar `firebase-key.json` ou qualquer arquivo de credencial
- ❌ Commitar `.wwebjs_auth`, `.wwebjs_cache`, `node_modules`
- ❌ Reativar o `AutoDeployWatcher`
- ❌ Fazer deploy sem antes rodar lint + build
- ❌ Enviar mensagens reais no WhatsApp durante testes
- ❌ Alterar `utils.ts` ou `server.js` sem replicar mudanças no outro
- ❌ Usar o script antigo `npm run deploy` (faz `git add .` cegamente)
- ❌ Usar `session.isValid` para decidir o que mostrar na UI — use `session.status`
- ❌ Retornar "Inválida" como status no `getStatusLabel` para statuses conhecidos

### 8.2 SEMPRE FAÇA

- ✅ Use `safe-deploy.cjs` ou `PublicarSistema.bat` para publicar
- ✅ Se alterar `getSessionsForDate` ou `getWhatsappReminderPlan`, altere nos DOIS arquivos (`utils.ts` E `server.js`)
- ✅ Teste com `scratch/inspect_june_1_to_6.js` — é o espelho fiel do server.js
- ✅ `generate_week_report.js` NÃO verifica feriados — não use como referência
- ✅ Horários usam `normalizeTime()` — garante formato `HH:MM` com 2 dígitos
- ✅ O campo `fixedDay` aceita: "segunda", "terça", "quarta", "quinta", "sexta", "sábado"

---

## 9. SCRIPTS DE DIAGNÓSTICO (pasta `scratch/`)

| Script | Função | Confiável? |
|---|---|---|
| `inspect_june_1_to_6.js` | Auditoria completa: agenda + planos de mensagem + bloqueios | ✅ Sim (espelho do server.js) |
| `simulate_week_messages.js` | Simula envios do robô por dia/horário | ✅ Sim |
| `dry_run_reminders.js` | Dry-run de lembretes (`--date` `--tipo`) | ✅ Sim |
| `view_settings.js` | Lê feriados e configurações do Firestore | ✅ Sim |
| `list_fixed.js` | Lista pacientes com dia/horário fixo | ✅ Sim |
| `diagnose_week.js` | Varre pacientes + sessões manuais da semana | ✅ Sim |
| `generate_week_report.js` | Simula envios da semana | ⚠️ **Não verifica feriados** |

---

## 10. COMANDOS ÚTEIS

```bash
# Desenvolvimento local
npm run dev                # Frontend em http://localhost:3000
npm run server             # Robô WhatsApp (ou IniciaRoboClinica.bat)
npm run lint               # TypeScript check (tsc --noEmit)
npm run build              # Build de produção (vite build)

# Deploy
npm run safe-deploy        # OU clique em PublicarSistema.bat

# PM2
pm2 list                   # Ver processos
pm2 restart RoboClinica    # Reiniciar robô
pm2 logs RoboClinica       # Ver logs do robô
pm2 logs RoboClinica --lines 50  # Últimas 50 linhas

# Diagnóstico (rodar da pasta gestão-clínica-fábio-denarde)
node scratch/inspect_june_1_to_6.js
node scratch/dry_run_reminders.js
node scratch/view_settings.js
```

---

## 11. PACIENTES ATUAIS (02/06/2026)

| Paciente | Responsável | Dia fixo | Horário | Dupla? | WhatsApp |
|---|---|---|---|---|---|
| Isabelly | Tatiane | quinta | 16:00 | Não | 27 99860-7197 |
| Luiza | Josi | sábado | 08:00 | Não | 27 98900-0374 |
| Nicolas | Leila | sábado | 07:00 | Não | 27 99639-5476 |
| Celso | Debriane | sexta | 14:00 | **Sim** | 27 99868-3352 |
| Alicia | Alexandre | terça | 16:00 | Não | 27 99915-1030 |
| Eliza | Camila | quinta | 15:00 | Não | 27 98823-2580 |
| Weslley | Antoniana | quinta | 18:00 | Não | 27 99714-6990 |

---

## 12. LINKS

| Descrição | URL |
|---|---|
| Sistema (Vercel) | https://gestaoclinica-solucoes.vercel.app/ |
| Sistema (GitHub Pages) | https://fdenarde.github.io/gestaoclinica/ |
| Repositório GitHub | https://github.com/fdenarde/gestaoclinica |
| Local dev | http://localhost:3000 |

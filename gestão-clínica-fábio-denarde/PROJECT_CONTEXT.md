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
| Gerenciador | PM2 (3 processos: frontend, robô, watcher desativado) |
| Deploy principal | **Vercel** — `https://gestaoclinica-solucoes.vercel.app/` |
| Deploy reserva | GitHub Pages — `https://fdenarde.github.io/gestaoclinica/` |
| Repositório | `https://github.com/fdenarde/gestaoclinica` |

---

## 2. ESTRUTURA DE PASTAS

```
D:\Backup Projeto Clinica completo\
├── ecosystem.config.cjs          # PM2: frontend + robô (watcher desativado)
├── watch-and-deploy.cjs          # Script antigo de auto-deploy (DESATIVADO)
│
└── gestão-clínica-fábio-denarde\
    ├── server.js                 # ROBÔ WHATSAPP (cron jobs 06:30, 09:00, 12:30)
    ├── safe-deploy.cjs           # Script SEGURO de deploy (USE ESTE)
    ├── PublicarSistema.bat       # Atalho Windows para publicar
    ├── package.json              # Dependências e scripts
    ├── vite.config.ts            # Config do Vite (base path condicional)
    ├── tsconfig.json
    ├── firebase.json             # Firestore config (sem hosting)
    ├── firestore.rules           # Regras de segurança
    ├── firebase-key.json         # Admin SDK key (gitignored, NUNCA commitar)
    ├── firebase-applet-config.json  # Client SDK config (commitado)
    │
    ├── src\
    │   ├── App.tsx               # Entry point, auth, navegação, listeners
    │   ├── types.ts              # TODOS os tipos/interfaces/enums
    │   ├── constants.ts          # Dias, horários (SCHEDULE_CONFIG)
    │   ├── index.css             # Tailwind + tema (cores, fontes)
    │   ├── firebase.ts           # Inicialização Firebase client
    │   ├── components\
    │   │   ├── Agenda.tsx        # Agenda clínica semanal (CORRIGIDA)
    │   │   ├── PersonalAgenda.tsx # Agenda pessoal com alarmes
    │   │   ├── Dashboard.tsx     # Resumo do dia
    │   │   ├── Patients.tsx      # Cadastro de pacientes
    │   │   ├── Settings.tsx      # Configurações + feriados
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
    │       └── useAlarms.ts      # Hook de alarmes sonoros
    │
    ├── scratch\                   # Scripts de diagnóstico/simulação
    │   ├── inspect_june_1_to_6.js    # Auditoria mais confiável da semana
    │   ├── simulate_week_messages.js # Simulador de mensagens WhatsApp
    │   ├── view_settings.js          # Lê configurações do Firestore
    │   ├── list_fixed.js             # Lista pacientes com horário fixo
    │   ├── diagnose_week.js          # Diagnóstico de pacientes/sessões
    │   └── ... (outros scripts)
    │
    └── dist\                      # Build de produção (gitignored)
```

---

## 3. FLUXO DE DEPLOY (PUBLICAR SISTEMA)

### 3.1 Método principal: Vercel (automático via GitHub)

O Vercel está conectado ao repositório `fdenarde/gestaoclinica`. Ao fazer `git push origin main`, o Vercel detecta e publica automaticamente.

**Link principal:** `https://gestaoclinica-solucoes.vercel.app/`

### 3.2 Método reserva: GitHub Pages

O script também publica a pasta `dist/` no branch `gh-pages` como backup.

**Link reserva:** `https://fdenarde.github.io/gestaoclinica/`

### 3.3 Como publicar (usuário leigo)

**Arquivo:** `PublicarSistema.bat` — dois cliques.

O script (`safe-deploy.cjs`) executa 6 etapas:
1. Verifica arquivos sensíveis (firebase-key, .wwebjs_auth, node_modules)
2. Roda `npm run lint` (TypeScript) — para se der erro
3. Roda `npm run build` (Vite) — para se falhar
4. Mostra resumo do que será publicado
5. Verifica .gitignore
6. Publica no GitHub Pages (reserva) + `git commit` + `git push`

O `git push` dispara o Vercel automaticamente (~1 minuto para atualizar).

### 3.4 AutoDeployWatcher (DESATIVADO)

O watcher automático (`watch-and-deploy.cjs`) foi **removido do PM2** e **comentado no `ecosystem.config.cjs`**. Ele fazia commit/push cegamente a cada alteração — isso era perigoso.

**Nunca reative o AutoDeployWatcher.**

### 3.5 PM2 — Processos ativos

| Nome | Status | Descrição |
|---|---|---|
| ClinicaFrontend | online | Vite dev server (porta 3000) |
| RoboClinica | online | WhatsApp bot (server.js) |
| ~~AutoDeployWatcher~~ | removido | — |

---

## 4. ROBÔ WHATSAPP (server.js)

### 4.1 Cron jobs

| Horário | Tipo | Alvo | Pula |
|---|---|---|---|
| 06:30 | `HOJE_MANHA` | Sessões do dia antes das 12h | Domingo |
| 09:00 | `AMANHA` | Todas as sessões do dia seguinte | Sábado (amanhã = domingo) |
| 12:30 | `HOJE_TARDE` | Sessões do dia ≥ 12h | Domingo |

### 4.2 Funções centrais

As funções `getSessionsForDate` e `getWhatsappReminderPlan` existem em **dois lugares idênticos**:

| Arquivo | Uso |
|---|---|
| `src/lib/utils.ts` | Frontend (Agenda visual) |
| `server.js` | Robô WhatsApp |

**Regra crítica:** qualquer alteração em uma DEVE ser replicada na outra.

### 4.3 Lógica de sessões

1. **Sessões manuais:** registros em `users/{uid}/sessions` com `date` e `status`
2. **Sessões virtuais (fixas):** geradas a partir do campo `fixedDay` + `fixedTime` do paciente, se não houver sessão manual sobrepondo o mesmo horário
3. **Feriados:** bloqueiam TODAS as mensagens (manuais e virtuais)
4. **Sessões duplas** (`doubleSession: true`): paciente ocupa 2 horários consecutivos. Mensagem única com horário mais cedo
5. **Bloqueios:** Cancelada, Falta.Prof, status ≠ Agendada → sem mensagem

### 4.4 Modelos de mensagem

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

Formatação de horário: `14:00` → `14h`, `14:30` → `14:30h`

### 4.5 Feriados

Cadastrados em `users/{uid}/settings/config.holidays`. O sistema gera automaticamente nacionais + estaduais (ES/Vila Velha) + móveis (Páscoa, Carnaval, Corpus Christi).

Feriados bloqueiam: geração de sessões virtuais, plano de mensagens, envio de lembretes. No `AMANHA`, o robô avisa o admin que as mensagens estão suspensas.

---

## 5. AGENDA CLÍNICA (Agenda.tsx)

### 5.1 Comportamento dos cards

| Dispositivo | Interação | Resultado |
|---|---|---|
| Desktop (hover) | Passar mouse no card | Overlay com botões rápidos (OK, Falta, Falta Prof., Cancelar, Remover) |
| Desktop (clique) | Clicar no card | Abre modal com todas as ações + detalhes |
| Mobile/Tablet (toque) | Tocar no card | Abre modal com todas as ações (toque NUNCA cancela) |

### 5.2 Cores e status

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

A legenda de cores aparece **abaixo da grade semanal**, em todos os dispositivos.

### 5.3 Sessões virtuais (fixas)

Ao clicar em OK/Falta/Falta Prof./Cancelar numa sessão fixa, uma **sessão real** é criada automaticamente com o pacote correto.

---

## 6. ESTRUTURA DO BANCO (Firestore)

Database: `ai-studio-587970e5-0653-44a5-93a3-be1a74301eda`

```
users/{userId}/
├── settings/config        # ClinicSettings (name, holidays[], whatsapp, etc.)
├── patients/{patientId}   # Patient (name, fixedDay, fixedTime, doubleSession, etc.)
├── sessions/{sessionId}   # Session (patientId, date, time, status, type, etc.)
├── payments/{paymentId}
├── repositions/{repoId}   # Reposition (patientId, originalSessionId, status)
├── expenses/{expenseId}
├── evolutions/{evolutionId}
└── agenda_pessoal/{apptId} # PersonalAppointment
```

### 6.1 Tipos principais (ver `src/types.ts`)

**Patient:** `id, name, guardianName, whatsapp, fixedDay, fixedTime, doubleSession?, status ('Ativo'|'Concluído'), paymentModal, ...`

**Session:** `id, patientId, date, time, type (SIMPLES|DUPLA), status (Agendada|Realizada|Falta|Falta.Prof|Cancelada|Reposição), packageNumber, notes?, isBlocked?, blockName?, ...`

**ClinicSettings:** `name, whatsapp, holidays: [{id, date, name}], ...`

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

Horários com `:30` (ex: 17:30) são suportados via campo customizado.

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

### 8.2 SEMPRE FAÇA

- ✅ Use `safe-deploy.cjs` ou `PublicarSistema.bat` para publicar
- ✅ Se alterar `getSessionsForDate` ou `getWhatsappReminderPlan`, altere nos DOIS arquivos (`utils.ts` E `server.js`)
- ✅ Teste com `scratch/inspect_june_1_to_6.js` antes de confiar em simulações
- ✅ Horários usam `normalizeTime()` que garante formato `HH:MM` com 2 dígitos
- ✅ O campo `fixedDay` aceita: "segunda", "terça", "quarta", "quinta", "sexta", "sábado"

---

## 9. SCRIPTS DE DIAGNÓSTICO (pasta `scratch/`)

| Script | Função |
|---|---|
| `inspect_june_1_to_6.js` | Auditoria completa da semana com agenda + planos de mensagem (ESPELHO FIEL do server.js) |
| `simulate_week_messages.js` | Simula envios do robô para uma semana |
| `view_settings.js` | Lê feriados e configurações do Firestore |
| `list_fixed.js` | Lista pacientes com dia/horário fixo |
| `diagnose_week.js` | Varre pacientes + sessões manuais da semana |
| `dry_run_reminders.js` | Dry-run de lembretes (sem enviar WhatsApp) |

Para rodar: `node scratch/nome_do_script.js` (a partir de `gestão-clínica-fábio-denarde`).

---

## 10. COMANDOS ÚTEIS

```bash
# Desenvolvimento
npm run dev                # Frontend em localhost:3000
npm run server             # Robô WhatsApp (ou IniciaRoboClinica.bat)
npm run lint               # TypeScript check (tsc --noEmit)
npm run build              # Build de produção (vite build)

# Deploy
npm run safe-deploy        # OU clique em PublicarSistema.bat

# PM2
pm2 list                   # Ver processos
pm2 restart RoboClinica    # Reiniciar robô
pm2 logs RoboClinica       # Ver logs do robô
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

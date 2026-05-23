# Documentação de Regras e Funcionamento do Robô do WhatsApp

Esta documentação descreve o funcionamento do robô de automação do WhatsApp (`server.js`) integrado ao Sistema de Gestão Clínica, explicando a lógica de agendamentos, geração de sessões virtuais, envio de lembretes e regras de negócio para evitar spams e conflitos.

---

## 1. Visão Geral da Arquitetura

O robô do WhatsApp opera como um serviço em segundo plano (gerenciado pelo PM2).
* **Biblioteca Principal:** `whatsapp-web.js` (com Puppeteer em modo headless para autenticação e envio).
* **Banco de Dados:** Firestore (Firebase), com dados estruturados por usuário (`users/{userId}/`).
* **Coleções Consultadas:** 
  * `users/{userId}/patients` (Dados cadastrais dos pacientes, dias e horários fixos).
  * `users/{userId}/sessions` (Sessões agendadas manualmente).
  * `users/{userId}/settings/config` (Configurações da clínica, incluindo telefone do administrador e feriados cadastrados).

---

## 2. Cronogramas de Envio (Horários dos Disparos)

O robô possui três alarmes diários configurados via `node-cron`:

| Horário | Tipo de Disparo | Destino/Filtro | Comportamento |
| :--- | :--- | :--- | :--- |
| **06:30** | `HOJE_MANHA` | Sessões do dia atual iniciadas **antes das 12:00** | Pula aos domingos. Envia confirmação de presença para o próprio dia. |
| **09:00** | `AMANHA` | Todas as sessões do **dia seguinte** | Pula aos sábados (não envia lembretes para domingo). Lembrete prévio de véspera. |
| **12:30** | `HOJE_TARDE` | Sessões do dia atual iniciadas **às 12:00 ou depois** | Pula aos domingos. Envia confirmação de presença para o próprio dia. |

---

## 3. Lógica de Geração de Sessões: Reais vs. Virtuais

Para compor a lista de envios de uma data específica, o robô unifica duas fontes:

1. **Sessões Reais (Manuais):**
   * Consultadas diretamente da coleção `sessions` do Firestore para a data-alvo.
   * Apenas sessões com status exatamente igual a **"Agendada"** são consideradas para disparo.
2. **Sessões Virtuais (Horários Fixos):**
   * Geradas dinamicamente com base nos dados dos pacientes ativos (`status === 'Ativo'`) cujo campo `fixedDay` corresponda ao dia da semana da data-alvo.
   * **Bloqueio por Sessão Manual:** Uma sessão virtual *não é gerada* se já existir qualquer sessão manual na coleção `sessions` para o mesmo paciente, no mesmo dia e exatamente no mesmo horário (ex: se o paciente foi marcado manualmente com status "Falta" ou "Desmarcada" para aquele horário fixo).
   * **Sessões Extras:** Sessões agendadas manualmente em horários alternativos (diferentes do fixo) não anulam o envio da sessão fixa correspondente.

---

## 4. Regras de Prevenção de Spam (Mensagens Duplas)

Para garantir que os pais ou responsáveis não recebam múltiplas notificações redundantes, o robô executa a seguinte lógica de agrupamento antes do envio:

* **Agrupamento por ID do Paciente:** O robô agrupa a lista final de sessões combinadas (reais + virtuais) utilizando o ID único de cada paciente.
* **Seleção do Horário Mais Cedo:** Caso um paciente possua mais de uma sessão no mesmo turno ou dia (seja por sessões consecutivas/duplas ou reposições), o robô seleciona apenas o **horário de início mais cedo** e gera uma única mensagem de lembrete.
* **Tratamento de Irmãos (Mesmo Telefone):** Como o agrupamento é feito por `patientId` (e não por número de telefone), se dois irmãos diferentes estiverem agendados para o mesmo dia sob o mesmo número de contato, o robô enviará uma mensagem separada para cada um deles.

---

## 5. Modelos das Mensagens de Envio

### A. Lembrete de Véspera (Tipo: `AMANHA`)
Disparado às 09:00 do dia anterior.
> "{Saudação}! Olá, {Nome do Responsável}, tudo bem?
> 
> Passando para lembrar você da sessão de *{Nome do Paciente}* amanhã, às *{Horário}*.
> 
> Aguardo sua confirmação,
> Até logo!"

### B. Confirmação do Dia (Tipos: `HOJE_MANHA` / `HOJE_TARDE`)
Disparado no próprio dia às 06:30 ou 12:30.
> "{Saudação}!
> Aguardo vocês hoje às *{Horário formatado}*!
> Até logo! 🙏🏼"

* **Regra de Formatação do Horário:** Horas exatas (ex: `14:00`) são encurtadas para `14h`. Horas quebradas (ex: `14:30`) mantêm o formato completo `14:30h`.

---

## 6. Tratamento de Feriados e Bloqueios

Ao calcular os envios para um determinado dia, o robô verifica o array de feriados configurados em `users/{userId}/settings/config`.
* **Bloqueio:** Se a data-alvo coincidir com um feriado cadastrado, todos os disparos automáticos para pacientes são **suspensos** para essa data.
* **Aviso ao Administrador:** Nos disparos de véspera (`AMANHA`), se houver um feriado no dia seguinte, o robô envia uma mensagem para o número de WhatsApp configurado da clínica informando que as mensagens automáticas foram suspensas:
  > "*Lembrete do Robô*
  > 
  > Olá! Lembrando que amanhã é feriado/recesso de *{Nome do Feriado}*.
  > 
  > O envio de mensagens automáticas de lembrete para os pacientes está suspenso para amanhã."

---

## 7. Scripts de Diagnóstico e Simulação

Criamos utilitários na pasta `scratch/` para validar a agenda e simular os disparos sem enviar mensagens reais:

* **[diagnose_week.js](file:///d:/Backup%20Projeto%20Clinica%20completo/gest%C3%A3o-cl%C3%ADnica-f%C3%A1bio-denarde/scratch/diagnose_week.js):** Varre os pacientes e sessões manuais diretamente do Firestore para a semana desejada para auditar inconsistências.
* **[simulate_week_messages.js](file:///d:/Backup%20Projeto%20Clinica%20completo/gest%C3%A3o-cl%C3%ADnica-f%C3%A1bio-denarde/scratch/simulate_week_messages.js):** Simula passo a passo cada alarme (`06:30`, `09:00`, `12:30`) para cada dia da semana, imprimindo no console o nome do paciente, responsável e o texto exato da mensagem correspondente.

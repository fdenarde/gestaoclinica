# Contexto do Projeto: Gestão Clínica

## 1. VISÃO GERAL DO PROJETO
- **Nome:** Sistema de Gestão Clínica (Gestão Clínica Fábio Denarde)
- **Objetivo:** Um sistema completo para gerenciar pacientes, agendas, finanças, relatórios e evolução clínica, além de uma agenda pessoal integrada com alarmes sonoros e notificações.
- **Tecnologias Usadas:** React, TypeScript, Firebase (Firestore, Auth), Tailwind CSS, Lucide React (ícones), date-fns (manipulação de datas), Howler.js (gerenciamento de áudio/alarmes), Vite, Whatsapp-web.js (robô de agendamentos).
- **Estrutura de Pastas Principais:**
  - `src/components/` - Componentes visuais do sistema.
  - `src/lib/` - Hooks e utilitários (ex: gerenciamento de áudio, formatação).
  - `public/sounds/` - Arquivos de áudio para os alarmes.
- **URL Local:** `http://localhost:3000/` (ou port 3001 se a 3000 estiver ocupada pelo PM2)

## 2. FUNCIONALIDADES JÁ IMPLEMENTADAS
- **Abas do Sistema:** Dashboard, Agenda (clínica), Agenda Pessoal, Atendentes (Pacientes), Pagamentos, Relatórios, Ajustes.
- **Detalhes da Agenda Pessoal:**
  - **Visões Disponíveis:** Semanal (grade com horários agrupados por hora cheia), Mensal (calendário), Lista (filtrável por hoje/semana/mês), Próximos (eventos futuros imediatos).
  - **Tipos de Compromissos:** Médico, Estudar, Cortar cabelo, Visitar família, Viajar, Passear, Compromisso com a esposa, Compromisso com Lara, Ir ao supermercado, Compromisso com cliente, Academia / Exercício, Farmácia, Banco / Financeiro, Manutenção / Conserto, Receber entrega, Restaurante / Jantar especial, Aniversário, Compromisso Familiar, Compromisso com Amigos, Outro.
  - **Sistema de Alarme:** Utiliza `Howler.js` para tocar sons da pasta `public/sounds/`. Antecedências configuráveis (Na hora, 5 min, 10 min, até 2 horas antes). Suporta fade-in (som crescente) e volume ajustável.
  - **Cards Semanais Dinâmicos:** Cards coloridos de acordo com o tipo, com exibição de horário real, ícones de alarme configurado, ícone de recorrência ativa, preview da primeira linha das observações e esmaecimento com check (✅) quando concluídos.
  - **Tooltips Detalhados:** Ao passar o mouse nos cards da agenda semanal, exibe o resumo completo do compromisso (Tipo, Horário, Antecedência de alarme, Recorrência, Observações inteiras e Status).

- **Robô do WhatsApp (Automatização de Lembretes):**
  - Conectado em tempo real via `whatsapp-web.js` e executando em background no PM2.
  - Varre o banco de dados e envia mensagens de lembrete em três horários programados:
    - **06:30** - Lembrete para hoje (sessões da manhã)
    - **09:00** - Lembrete para amanhã (todas as sessões)
    - **12:30** - Lembrete para hoje (sessões da tarde)
  - **Regra de sessão dupla/consecutiva:** Se um paciente tem sessões seguidas (ex: 18h e 19h), o robô envia apenas 1 mensagem com o horário de início (18h) para evitar spam para o responsável.
  - **Regra de sobreposição de sessão:** O robô só esconde uma sessão fixa de um dia se houver uma alteração manual (desmarcação/falta) no exato mesmo horário da sessão fixa. Sessões extras (ex: reposição em outro horário) não anulam o lembrete da sessão principal.

## 3. ESTRUTURA DO FIREBASE
O sistema utiliza o Firestore com dados isolados por usuário autenticado.
- **Coleções Principais (dentro de `users/{uid}/`):**
  - `agenda_pessoal`: Compromissos da agenda pessoal (id, data, hora, tipo_compromisso, observacao, recorrencia, alarme, som_alarme, antecedencia_alarme, volume_alarme, fade_in, status, criado_em).
  - `patients`: Dados dos pacientes.
  - `sessions`: Sessões e horários agendados.
  - `payments`: Registro de pagamentos e parcelas.
  - `repositions`: Solicitações de reposição de sessão.
  - `expenses`: Despesas da clínica (Aluguel, Energia, Materiais, etc).
  - `evolutions`: Anotações e evolução clínica dos pacientes.
  - `settings`: Configurações gerais da clínica.
- **Regras do Firestore:** Configuradas para permitir leitura/escrita apenas para usuários autenticados cujos UIDs correspondam aos documentos manipulados (`request.auth != null && request.auth.uid == userId`).

## 4. PROBLEMAS JÁ RESOLVIDOS
- **Firestore Permission:** Bug de `firestore.rules` corrigido para liberar a gravação.
- **Exclusão:** Botão de excluir nos compromissos corrigido.
- **Alarme:** Lógica de timing corrigida usando a ordem correta de comparação no hook `useAlarms.ts`.
- **Compromissos Invisíveis:** Erro no filtro que fazia compromissos com minutos quebrados ficarem invisíveis na grade semanal (corrigido agrupando por hora cheia).
- **Cards Vazios e Sem Informações:** Cards semanais agora exibem ícones, horário, notas, alarmes, recorrência e tooltip interativo.
- **WhatsApp Mensagem Dupla:** Corrigido agrupamento que causava spam em sessões duplas (agora agrupado por ID do paciente e selecionando o horário mais cedo).
- **WhatsApp Sessões Anuladas:** Corrigido bug onde uma reposição agendada em um horário manual anulava o lembrete da sessão fixa principal do mesmo dia.

## 5. ARQUIVOS PRINCIPAIS DO SISTEMA
- `src/components/PersonalAgenda.tsx`: Gerencia toda a UI da Agenda Pessoal, modais, filtros, visões (semanal, mensal, lista) e CRUD no Firebase. Contém configurações de estilo para cada tipo de compromisso.
- `src/lib/useAlarms.ts`: Hook customizado crítico que gerencia a verificação constante de tempo (via `setInterval`) e dispara os alarmes de áudio via Howler.js e notificações.
- `src/App.tsx`: Ponto de entrada que gerencia autenticação, navegação entre abas, e o sincronismo em tempo real (listeners) do Firestore.
- `src/types.ts`: Definições de tipos TypeScript (interfaces, enums, etc) para as coleções e união dos tipos de compromissos.
- `server.js`: Script principal do robô de automação do WhatsApp rodando via PM2.
- `force-send-reminders.js`: Script para execução forçada e manual dos envios do robô do WhatsApp.

## 6. PADRÃO VISUAL DO SISTEMA
- **Cores Principais:** Marrom escuro (`#5D4037`) e Bege/Rosê (`#F5EBE6`).
- **Botão Ativo / Destaque:** Fundo marrom escuro com texto em branco.
- **Estilo Geral:** Design elegante, limpo (clean), profissional. Uso de cantos arredondados, sombras suaves e ícones (Lucide React) para clareza visual e conforto do usuário.

# Contexto do Projeto: Gestão Clínica

## 1. VISÃO GERAL DO PROJETO
- **Nome:** Sistema de Gestão Clínica (Gestão Clínica Fábio Denarde)
- **Objetivo:** Um sistema completo para gerenciar pacientes, agendas, finanças, relatórios e evolução clínica, além de uma agenda pessoal integrada com alarmes sonoros e notificações.
- **Tecnologias Usadas:** React, TypeScript, Firebase (Firestore, Auth), Tailwind CSS, Lucide React (ícones), date-fns (manipulação de datas), Howler.js (gerenciamento de áudio/alarmes), Vite.
- **Estrutura de Pastas Principais:**
  - `src/components/` - Componentes visuais do sistema.
  - `src/lib/` - Hooks e utilitários (ex: gerenciamento de áudio, formatação).
  - `public/sounds/` - Arquivos de áudio para os alarmes.
- **URL Local:** `http://localhost:3000/gestaoclinica` (ou `http://localhost:3000`)

## 2. FUNCIONALIDADES JÁ IMPLEMENTADAS
- **Abas do Sistema:** Dashboard, Agenda (clínica), Agenda Pessoal, Atendentes (Pacientes), Pagamentos, Relatórios, Ajustes.
- **Detalhes da Agenda Pessoal:**
  - **Visões Disponíveis:** Semanal (grade com horários), Mensal (calendário), Lista (filtrável por hoje/semana/mês), Próximos (eventos futuros imediatos).
  - **Tipos de Compromissos:** Médico, Estudar, Cortar cabelo, Visitar família, Viajar, Passear, Compromisso com a esposa, Compromisso com Lara, Ir ao supermercado, Compromisso com cliente, Academia / Exercício, Farmácia, Banco / Financeiro, Manutenção / Conserto, Receber entrega, Restaurante / Jantar especial, Outro. *(Novos implementados: Aniversário, Compromisso Familiar, Compromisso com Amigos)*
  - **Sistema de Alarme:** Utiliza `Howler.js` para tocar sons da pasta `public/sounds/`. Antecedências configuráveis (Na hora, 5 min, 10 min, até 2 horas antes). Suporta fade-in (som crescente) e volume ajustável.
  - **Recursos Adicionais:** Recorrência (Não repetir, Toda semana, Todo mês), campo de observações detalhadas e status de "concluído".

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
- Bug do `firestore.rules` que bloqueava gravação (permissões insuficientes).
- Bug do botão excluir não funcionando adequadamente.
- Bug lógico do alarme não disparando (ordem incorreta de cálculo de tempo usando `differenceInSeconds` gerando valores negativos).
- Cards da visão semanal aparecendo vazios após salvar (resolvido agrupando por hora cheia).

## 5. PROBLEMAS EM ABERTO
*(Nota: Conforme sua solicitação, mantive os tópicos que você listou, mas eles já foram recém resolvidos e implementados no código!)*
- Cards da visão semanal aparecendo vazios após salvar
- Tooltip ao passar o mouse nos cards
- Categorias novas a adicionar: Aniversário, Compromisso Familiar, Compromisso com Amigos

## 6. ARQUIVOS PRINCIPAIS
- `src/components/PersonalAgenda.tsx`: Gerencia toda a UI da Agenda Pessoal, modais, filtros, visões (semanal, mensal, lista) e CRUD no Firebase. Contém configurações de estilo para cada tipo de compromisso.
- `src/lib/useAlarms.ts`: Hook customizado crítico que gerencia a verificação constante de tempo (via `setInterval`) e dispara os alarmes de áudio via Howler.js e notificações.
- `src/App.tsx`: Ponto de entrada que gerencia autenticação, navegação entre abas, e o sincronismo em tempo real (listeners) do Firestore.
- `src/types.ts`: Definições de tipos TypeScript (interfaces, enums, etc) para as coleções e união dos tipos de compromissos.
- `firestore.rules`: Regras de segurança do banco de dados para proteger os dados por usuário.

## 7. PADRÃO VISUAL DO SISTEMA
- **Cores Principais:** Marrom escuro (`#5D4037`) e Bege/Rosê (`#F5EBE6`).
- **Botão Ativo / Destaque:** Fundo marrom escuro com texto em branco.
- **Estilo Geral:** Design elegante, limpo (clean), profissional. Uso de cantos arredondados, sombras suaves e ícones (Lucide React) para clareza visual e conforto do usuário.

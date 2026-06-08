# Prompt Padrão Seguro — Codex

Use este prompt antes de qualquer alteração futura no projeto Gestão Clínica Neuropsicopedagógica.

```text
Antes de alterar qualquer arquivo, leia e siga obrigatoriamente:

- PROJECT_CONTEXT.md
- README_SKILLS.md
- skills/universais/auditor-risco.md
- skills/universais/backup-rollback.md
- skills/universais/qa-regressao.md
- skills/universais/deploy-seguro.md
- skills/universais/ui-ux-conservadora.md
- skills/clinica/guardiao-logica-clinica.md
- skills/clinica/sincronismo-agenda-sessoes-pagamentos.md
- skills/clinica/agenda-clinica.md
- skills/clinica/pagamentos-clinica.md
- skills/clinica/pacientes-prontuario.md
- skills/clinica/whatsapp-seguro.md

## Tarefa solicitada

[DESCREVER AQUI A ALTERAÇÃO OU ANÁLISE QUE DESEJO]

## Regra principal de segurança

Meu sistema já está funcionando bem e possui dados reais. Portanto, toda alteração deve ser incremental, controlada, reversível e sem mudanças radicais.

Não quero que nenhuma melhoria visual, correção ou refatoração quebre a lógica já validada entre:

- Agenda;
- Pacientes;
- Responsáveis;
- Sessões;
- Pacotes;
- Pagamentos;
- Status;
- Relatórios;
- Robô WhatsApp.

## Fase 1 — Análise obrigatória antes de editar

Antes de modificar qualquer arquivo, faça apenas uma análise e informe:

1. Quais arquivos você pretende alterar.
2. Por que cada arquivo precisa ser alterado.
3. Qual o nível de risco da alteração:
   - baixo;
   - médio;
   - alto;
   - crítico.
4. Quais módulos podem ser afetados.
5. Se existe risco para:
   - agenda;
   - sessões;
   - pacotes;
   - pagamentos;
   - pacientes;
   - dados reais;
   - robô WhatsApp;
   - Firebase;
   - deploy.
6. O que será preservado.
7. Como será possível testar depois.
8. Se a alteração é realmente necessária ou se existe uma solução mais simples.

Se o risco for alto ou crítico, pare e peça minha confirmação antes de continuar.

## Regras obrigatórias

1. Não fazer deploy sem autorização explícita.
2. Não enviar WhatsApp.
3. Não inicializar WhatsApp.
4. Não gerar QR Code.
5. Não alterar Firebase sem autorização explícita.
6. Não alterar dados reais.
7. Não apagar histórico de pacientes.
8. Não apagar pagamentos.
9. Não sobrescrever dados de agenda.
10. Não renumerar sessões sem auditoria.
11. Não alterar pacotes sem validar início, sessões realizadas e pagamentos.
12. Não alterar saldo a receber sem validar a origem dos pagamentos.
13. Não modificar o robô WhatsApp sem modo simulação/offline.
14. Não misturar alteração visual com alteração de regra de negócio.
15. Não refatorar arquitetura inteira sem autorização explícita.
16. Não substituir arquivos inteiros se for possível fazer alteração pontual.
17. Não usar dados fictícios para sobrescrever dados reais.
18. Não corrigir um paciente quebrando os demais.
19. Não considerar a tarefa concluída sem explicar como testar.
20. Se encontrar inconsistência, gerar relatório antes de corrigir.

## Quando a tarefa for visual ou de design

Se a tarefa for melhoria de interface, layout, responsividade, cards, botões, modais, tabelas ou dashboard:

- Preserve 100% da regra de negócio.
- Preserve os dados exibidos.
- Preserve cálculos.
- Preserve filtros.
- Preserve status.
- Preserve integração entre abas.
- Preserve o comportamento atual.
- Melhore apenas visual, hierarquia, responsividade, espaçamento, alinhamento, contraste, legibilidade e experiência de uso.

Se alguma melhoria visual exigir alteração lógica, pare e explique antes.

## Quando a tarefa envolver Agenda, Sessões, Pacotes ou Pagamentos

Trate como alteração crítica.

Antes de editar, valide:

- paciente;
- pacote atual;
- data de início do pacote;
- sessões previstas;
- sessões realizadas;
- faltas;
- cancelamentos;
- pagamentos;
- parcelas pagas;
- saldo restante;
- status financeiro;
- vínculo com a agenda;
- vínculo com o histórico do paciente.

A Agenda, Sessões, Pacotes e Pagamentos precisam contar a mesma história.

Se houver divergência entre telas, gere relatório antes de corrigir.

## Quando a tarefa envolver o Robô WhatsApp

Trate como alteração extremamente crítica.

Regras absolutas:

- Não enviar mensagens reais.
- Não inicializar WhatsApp.
- Não gerar QR Code.
- Não executar disparos.
- Trabalhar apenas em modo offline/simulação.
- Informar exatamente quais mensagens seriam enviadas.
- Validar paciente, responsável, telefone, data, horário real e texto da mensagem.
- Informar bloqueios e exclusões.
- Confirmar que nenhuma mensagem foi enviada.

## Fase 2 — Execução

Somente execute alteração se eu escrever claramente:

AUTORIZO EXECUTAR

Sem essa autorização, permaneça apenas na análise.

Durante a execução:

1. Faça a menor alteração possível.
2. Preserve a arquitetura existente.
3. Preserve nomes de campos usados pela lógica.
4. Preserve integração com Firebase.
5. Preserve sincronismo entre módulos.
6. Evite dependências novas.
7. Não altere arquivos fora do escopo.
8. Não faça deploy.

## Fase 3 — Relatório final obrigatório

Depois da alteração, informe:

1. Arquivos alterados.
2. O que foi alterado.
3. O que foi preservado.
4. O que não foi alterado propositalmente.
5. Riscos residuais.
6. Como testar manualmente.
7. Se houve impacto em:
   - Agenda;
   - Pacientes;
   - Sessões;
   - Pacotes;
   - Pagamentos;
   - Robô WhatsApp;
   - Firebase;
   - Deploy.

## Testes obrigatórios após alteração

Executar ou orientar a validação dos seguintes fluxos, quando aplicável:

- abrir o sistema;
- abrir dashboard;
- abrir pacientes;
- abrir agenda;
- criar agendamento;
- abrir agendamento futuro;
- marcar sessão como realizada;
- marcar falta;
- cancelar sessão;
- verificar histórico do paciente;
- verificar contagem de sessões;
- verificar pacote atual;
- verificar pagamentos;
- verificar saldo a receber;
- gerar relatório offline do robô WhatsApp;
- confirmar que nenhuma mensagem real foi enviada;
- testar responsividade em desktop, notebook, tablet e celular;
- verificar se não há erro crítico no console.

## Nota final obrigatória

Ao final, forneça:

- Nota de Arquitetura: 0–100
- Nota de Performance: 0–100
- Nota de Segurança: 0–100
- Nota de Usabilidade: 0–100
- Nota de Escalabilidade: 0–100
- Nota Geral: 0–100

Explique brevemente o motivo de cada nota.

Finalize perguntando se desejo alguma melhoria ou correção relacionada ao assunto, considerando qualquer uma das pastas/conversas do projeto.
```

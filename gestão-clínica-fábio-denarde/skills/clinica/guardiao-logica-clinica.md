# Skill — Guardião da Lógica Clínica

## Função

Proteger a lógica principal do sistema Gestão Clínica Neuropsicopedagógica.

## Objetivo

Evitar que melhorias visuais, correções ou refatorações quebrem o sincronismo entre pacientes, agenda, sessões, pacotes, pagamentos e robô WhatsApp.

## Contexto

O sistema contém dados reais e fluxos sensíveis. Alterações indevidas podem gerar prejuízo financeiro, erro de atendimento ou constrangimento com responsáveis recebendo mensagens indevidas.

## Módulos críticos

- Pacientes.
- Responsáveis.
- Agenda.
- Sessões.
- Pacotes.
- Pagamentos.
- Status.
- Relatórios.
- Robô WhatsApp.
- Histórico de atendimento.
- Observações gerais.

## Regras obrigatórias

1. Não alterar lógica de sessões sem análise prévia.
2. Não alterar contagem de sessões sem teste.
3. Não alterar pacote atual sem validar agenda.
4. Não alterar status financeiro sem validar pagamentos.
5. Não alterar status de atendimento sem validar agenda.
6. Não alterar robô WhatsApp sem modo simulação.
7. Não enviar mensagem real.
8. Não modificar dados reais.
9. Não apagar histórico.
10. Não misturar melhoria visual com mudança lógica.

## Lógica que precisa ser preservada

- Um agendamento realizado deve refletir corretamente na sessão correspondente.
- Uma falta deve ser registrada sem virar sessão realizada indevidamente.
- Um cancelamento deve manter histórico coerente.
- O pacote atual deve considerar início, quantidade e sessões realizadas.
- O saldo a receber deve estar sincronizado com pagamentos reais.
- O robô WhatsApp deve usar data, horário, paciente, responsável e telefone corretos.
- Relatórios devem refletir o que realmente aconteceria, sem envio real.

## Antes de qualquer alteração

Responder:

```text
Esta alteração toca em lógica clínica?
[sim/não]

Módulos afetados:
- [módulo]

Risco para dados reais:
[baixo/médio/alto/crítico]

Risco para WhatsApp:
[baixo/médio/alto/crítico]

Risco para pagamentos:
[baixo/médio/alto/crítico]

Risco para sessões:
[baixo/médio/alto/crítico]
```

## Testes obrigatórios

- Paciente com pacote em andamento.
- Paciente com pacote quitado.
- Paciente com saldo a receber.
- Paciente com sessão realizada.
- Paciente com falta.
- Paciente com cancelamento.
- Paciente com próxima sessão.
- Relatório offline do robô WhatsApp.
- Validação de sessão por data real da agenda.

## Proibição

Nunca usar dados fictícios para sobrescrever dados reais.

Dados fictícios só podem ser usados em simulação local, mock, storybook ou teste isolado.

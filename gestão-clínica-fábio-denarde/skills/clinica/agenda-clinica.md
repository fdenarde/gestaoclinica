# Skill — Agenda Clínica

## Função

Preservar e melhorar a agenda clínica sem quebrar sincronismo com sessões, pacientes e robô WhatsApp.

## Objetivo

Garantir que cada agendamento mantenha dados corretos e reflita adequadamente no restante do sistema.

## Eventos da agenda

- Agendamento futuro.
- Sessão realizada.
- Falta.
- Cancelamento.
- Reagendamento.
- Horário livre.
- Horário bloqueado.

## Regras obrigatórias

1. Não alterar status de agendamento sem consequência clara.
2. Não transformar falta em realizada.
3. Não transformar cancelamento em sessão.
4. Não perder observações.
5. Não perder vínculo com paciente.
6. Não perder vínculo com responsável.
7. Não perder horário real.
8. Não quebrar relatório WhatsApp.
9. Não duplicar agendamento.
10. Não apagar histórico.

## Melhorias permitidas

- Melhorar modal de criação de agendamento.
- Melhorar modal de sessão realizada.
- Adicionar área de anotações.
- Adicionar atalhos para detalhes do paciente.
- Adicionar badges.
- Melhorar botões.
- Melhorar organização visual.
- Adicionar confirmação para ações críticas.
- Melhorar estados visuais.

## Ações críticas

Exigir confirmação para:

- marcar como realizada;
- marcar falta;
- cancelar;
- excluir;
- reagendar;
- alterar paciente;
- alterar responsável;
- alterar horário.

## Sincronismo obrigatório

Agenda deve conversar com:

- cadastro do paciente;
- histórico;
- sessões;
- pacotes;
- pagamentos;
- robô WhatsApp;
- relatórios.

## Testes obrigatórios

- Criar agendamento.
- Abrir agendamento futuro.
- Abrir sessão realizada.
- Inserir anotação geral.
- Marcar falta.
- Cancelar.
- Conferir histórico do paciente.
- Conferir se WhatsApp não envia mensagem para cancelado.

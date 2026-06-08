# Skill — Sincronismo Agenda, Sessões e Pagamentos

## Função

Garantir sincronismo entre Agenda, Sessões, Pacotes e Pagamentos.

## Objetivo

Evitar divergências como:

- sessão contada em número errado;
- sessão repetida;
- pacote incorreto;
- saldo a receber errado;
- paciente quitado aparecendo como pendente;
- paciente pendente aparecendo como quitado;
- agendamento realizado sem refletir no pacote;
- pacote novo contando sessões antigas;
- WhatsApp usando data ou horário incorreto.

## Conceitos críticos

### Agenda

Fonte de datas e horários dos atendimentos.

### Sessões

Devem refletir atendimentos realizados, faltas ou cancelamentos conforme a lógica do sistema.

### Pacotes

Devem respeitar:

- início do pacote;
- quantidade contratada;
- sessões realizadas dentro do pacote;
- status do pacote;
- parcelas relacionadas.

### Pagamentos

Devem refletir:

- valor combinado;
- parcelas pagas;
- saldo restante;
- data de pagamento;
- status financeiro.

## Regras obrigatórias

1. Não contar sessões fora do pacote atual.
2. Não duplicar sessão.
3. Não renumerar sessões antigas sem necessidade.
4. Não inferir pagamento sem registro.
5. Não alterar saldo com base apenas na tela.
6. Não usar dados visuais como fonte da verdade.
7. Sempre validar lógica a partir dos dados persistidos.
8. Não corrigir um paciente quebrando os demais.
9. Não alterar todos os pacientes sem simulação.
10. Se houver divergência, gerar relatório antes de corrigir.

## Auditoria esperada

Ao analisar sincronismo, gerar:

```text
Paciente:
Pacote atual:
Data de início do pacote:
Sessões esperadas:
Sessões encontradas:
Sessões realizadas:
Faltas:
Cancelamentos:
Pagamentos:
Saldo:
Divergência encontrada:
Correção proposta:
Risco:
```

## Testes obrigatórios

- Paciente com pacote 1 finalizado.
- Paciente que iniciou pacote 2.
- Paciente com parcela restante.
- Paciente sem pendência.
- Paciente com sessão realizada recentemente.
- Paciente com falta.
- Paciente cancelado.
- Paciente com agendamento futuro.

## Regra de ouro

A Agenda, Sessões, Pacotes e Pagamentos devem contar a mesma história.

Se uma tela diz uma coisa e outra tela diz outra, a alteração deve parar e gerar relatório de divergência.

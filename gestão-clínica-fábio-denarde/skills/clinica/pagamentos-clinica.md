# Skill — Pagamentos da Clínica

## Função

Proteger e melhorar a lógica financeira do sistema da clínica.

## Objetivo

Garantir que valores recebidos, saldo a receber, pacotes, parcelas e status financeiro estejam coerentes.

## Módulos relacionados

- Pacientes.
- Pacotes.
- Sessões.
- Pagamentos.
- Agenda.
- Dashboard financeiro.
- Relatórios.

## Regras obrigatórias

1. Não alterar saldo sem validar origem do pagamento.
2. Não marcar parcela como paga sem registro.
3. Não alterar valor de pacote sem autorização.
4. Não misturar receita bruta com saldo a receber.
5. Não considerar agendamento como pagamento.
6. Não considerar sessão realizada como pagamento.
7. Não alterar histórico financeiro.
8. Não apagar registros antigos.
9. Não recalcular todos os pacientes sem relatório.
10. Não usar valores fictícios em produção.

## Conceitos

### Receita bruta mensal

Total de valores efetivamente recebidos ou lançados como recebidos no mês, conforme regra atual do sistema.

### Saldo a receber

Valores pendentes, parcelas futuras ou restantes, conforme pacote e pagamentos registrados.

### Pacote

Conjunto de sessões contratadas, normalmente vinculado a valor e forma de pagamento.

## Melhorias visuais permitidas

- Destacar receita bruta.
- Destacar saldo a receber.
- Separar valores recebidos de pendentes.
- Usar cards claros.
- Usar badges de status.
- Melhorar legibilidade.
- Melhorar responsividade.
- Criar alerta para pendências.

## Melhorias lógicas só com cautela

- Recalcular saldo.
- Reclassificar status.
- Alterar pacote atual.
- Ajustar contagem de sessões.
- Corrigir parcela.
- Migrar estrutura de pagamentos.

## Auditoria financeira esperada

```text
Paciente:
Pacote atual:
Valor do pacote:
Parcelas previstas:
Parcelas pagas:
Saldo restante:
Sessões realizadas:
Status financeiro atual:
Divergência:
Correção proposta:
Risco:
```

## Testes obrigatórios

- Paciente com pacote quitado.
- Paciente com parcela pendente.
- Paciente com pacote novo.
- Paciente com pagamento parcial.
- Paciente sem débito.
- Paciente com sessão realizada e sem pagamento.
- Paciente com saldo a receber.

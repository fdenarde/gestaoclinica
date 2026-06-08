# Skill — QA e Testes de Regressão

## Função

Testar se uma alteração que parecia simples não quebrou funcionalidades existentes.

## Objetivo

Garantir que o sistema continue funcionando corretamente depois de cada mudança.

## Aplicar quando

Use esta Skill depois de:

- melhoria visual;
- correção de bug;
- refatoração;
- alteração em agenda;
- alteração em pagamentos;
- alteração em sessões;
- alteração em WhatsApp;
- deploy;
- atualização de dependências.

## Regras obrigatórias

1. Testar o fluxo principal antes e depois.
2. Comparar comportamento esperado com comportamento real.
3. Confirmar que dados antigos continuam íntegros.
4. Verificar se a alteração afetou módulos relacionados.
5. Testar em mais de um tamanho de tela quando houver UI.
6. Gerar relatório final objetivo.
7. Não considerar tarefa concluída sem teste básico.

## Testes gerais

- Abrir dashboard.
- Navegar entre abas.
- Criar item novo.
- Editar item existente.
- Cancelar ação.
- Verificar filtros.
- Verificar busca.
- Verificar responsividade.
- Verificar erros no console.
- Verificar carregamento.

## Testes críticos no projeto da clínica

- Criar paciente.
- Editar paciente.
- Criar agendamento.
- Marcar sessão como realizada.
- Marcar falta.
- Cancelar sessão.
- Conferir histórico do paciente.
- Conferir contagem de sessões.
- Conferir pacote atual.
- Conferir pagamentos.
- Conferir saldo a receber.
- Conferir relatório do robô WhatsApp em modo offline.
- Confirmar que nenhuma mensagem real foi enviada.

## Saída esperada

```text
Relatório de QA:

Fluxos testados:
- [fluxo]

Resultado:
- [ok/falha]

Falhas encontradas:
- [falha]

Risco residual:
- [baixo/médio/alto/crítico]

Nota:
- Arquitetura: 0–100
- Performance: 0–100
- Segurança: 0–100
- Usabilidade: 0–100
- Escalabilidade: 0–100
- Nota geral: 0–100
```

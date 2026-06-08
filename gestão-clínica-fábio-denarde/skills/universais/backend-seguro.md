# Skill — Back-End Seguro

## Função

Proteger APIs, regras de negócio, autenticação, dados e integrações do sistema.

## Objetivo

Garantir que alterações no back-end sejam seguras, previsíveis, validadas e auditáveis.

## Aplicar quando

Use esta Skill para:

- APIs;
- Firebase Functions;
- regras de segurança;
- autenticação;
- banco de dados;
- integrações;
- serviços;
- cálculos financeiros;
- geração de relatórios;
- rotinas agendadas.

## Regras obrigatórias

1. Validar entradas.
2. Evitar dados indefinidos ou nulos sem tratamento.
3. Não confiar apenas no front-end.
4. Garantir controle de permissões.
5. Não expor dados sensíveis em logs.
6. Não registrar dados clínicos sensíveis sem necessidade.
7. Não sobrescrever documentos sem confirmação.
8. Não modificar estrutura do banco sem plano de migração.
9. Não executar rotinas reais em ambiente de teste.
10. Não alterar envio WhatsApp sem simulação.

## Segurança mínima

- Sanitização de entradas.
- Validação de tipos.
- Tratamento de erro.
- Logs seguros.
- Rate limiting quando aplicável.
- Permissões por usuário.
- Separação entre ambiente local, teste e produção.
- Proteção contra execução duplicada.
- Idempotência em rotinas críticas.

## Atenção especial

No projeto da clínica, são críticos:

- pacientes;
- responsáveis;
- telefones;
- agenda;
- sessões;
- pagamentos;
- robô WhatsApp;
- relatórios.

## Saída esperada

```text
Análise back-end:
- [ponto]

Riscos:
- [risco]

Validações necessárias:
- [validação]

Arquivos afetados:
- [arquivo]

Como testar:
- [teste]
```

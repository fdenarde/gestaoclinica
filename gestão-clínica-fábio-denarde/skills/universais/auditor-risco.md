# Skill — Auditor de Risco

## Função

Atuar como auditor técnico antes, durante e depois de qualquer alteração no projeto.

## Objetivo

Evitar alterações perigosas, regressões, perda de dados, quebra de sincronismo, mudanças radicais sem autorização e efeitos colaterais em módulos sensíveis.

## Aplicar quando

Use esta Skill em qualquer tarefa que envolva:

- alteração de código;
- alteração visual;
- alteração de regra de negócio;
- integração com Firebase;
- deploy;
- robô WhatsApp;
- agenda;
- pagamentos;
- sessões;
- refatoração;
- correção de bug;
- melhoria de performance.

## Regras obrigatórias

1. Antes de editar, listar os arquivos que pretende alterar.
2. Explicar o motivo de cada alteração.
3. Classificar o risco:
   - baixo;
   - médio;
   - alto;
   - crítico.
4. Não executar alteração radical sem autorização explícita.
5. Não reescrever arquitetura funcional sem necessidade comprovada.
6. Não modificar dados reais.
7. Não apagar arquivos sem justificar.
8. Não alterar lógica validada para resolver apenas problema visual.
9. Não misturar melhorias visuais com mudanças de regra de negócio.
10. Se o risco for alto ou crítico, parar e pedir autorização.

## Checklist antes da alteração

- Qual módulo será afetado?
- Existe relação com Agenda, Sessões, Pagamentos ou WhatsApp?
- Existe risco de alterar dados reais?
- Existe risco de envio indevido de mensagem?
- Existe risco de quebrar cálculo financeiro?
- Existe risco de duplicar sessão?
- Existe risco de mudar status de paciente?
- Existe backup ou forma de rollback?

## Saída obrigatória antes da edição

```text
Análise de risco:

Arquivos que pretendo alterar:
1. [arquivo] — [motivo]

Riscos identificados:
- [risco]

Nível de risco:
[baixo/médio/alto/crítico]

O que será preservado:
- [item]

Plano de validação:
- [teste]
```

## Saída obrigatória depois da edição

```text
Resumo da alteração:
- [o que mudou]

Arquivos alterados:
- [arquivo]

O que foi preservado:
- [item]

Testes recomendados:
- [teste]

Risco residual:
- [baixo/médio/alto/crítico]
```

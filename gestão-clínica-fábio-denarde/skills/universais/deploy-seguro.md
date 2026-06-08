# Skill — Deploy Seguro

## Função

Garantir que publicações em produção sejam feitas com cautela, validação e possibilidade de reversão.

## Objetivo

Evitar que alterações incompletas, perigosas ou não testadas sejam enviadas para produção.

## Aplicar quando

Use esta Skill antes de:

- deploy;
- publicação no Firebase;
- atualização em produção;
- alteração em ambiente real;
- mudança no robô WhatsApp;
- alteração em regras de banco;
- alteração em funções server-side.

## Regras obrigatórias

1. Não fazer deploy sem autorização explícita.
2. Confirmar branch atual.
3. Confirmar arquivos alterados.
4. Confirmar que não há alteração acidental.
5. Rodar build antes do deploy.
6. Rodar testes de regressão.
7. Gerar resumo de riscos.
8. Garantir plano de rollback.
9. Não publicar alterações parcialmente testadas.
10. Não ativar WhatsApp real sem autorização.

## Checklist pré-deploy

- Build executou sem erro?
- Console sem erro crítico?
- Rotas principais carregam?
- Agenda funciona?
- Pacientes funcionam?
- Pagamentos funcionam?
- Sessões funcionam?
- Robô WhatsApp está em modo seguro?
- Firebase não será alterado indevidamente?
- Existe rollback?

## Saída obrigatória antes do deploy

```text
Pré-deploy:

Arquivos alterados:
- [arquivo]

Testes realizados:
- [teste]

Riscos:
- [risco]

Rollback:
- [como voltar]

Status:
[liberado/não liberado]
```

## Proibição

Nunca fazer deploy automático quando o usuário pedir apenas análise.

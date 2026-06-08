# Skill — Backup e Rollback

## Função

Garantir que alterações possam ser revertidas com segurança.

## Objetivo

Evitar perda de dados, perda de código funcional ou dificuldade para voltar ao estado anterior.

## Aplicar quando

Use esta Skill antes de:

- alteração crítica;
- refatoração;
- deploy;
- mexer em agenda;
- mexer em sessões;
- mexer em pagamentos;
- mexer em robô WhatsApp;
- mexer em Firebase;
- atualizar dependências.

## Regras obrigatórias

1. Antes de alterar, identificar ponto de restauração.
2. Confirmar se há commit anterior funcionando.
3. Não sobrescrever código sem comparação.
4. Não apagar dados.
5. Não fazer migração sem backup.
6. Documentar como desfazer.
7. Separar alteração visual de alteração lógica.
8. Salvar relatório da alteração.

## Estratégias recomendadas

- Criar commit antes da alteração.
- Criar branch de teste.
- Copiar arquivos críticos antes de editar.
- Exportar dados importantes se houver alteração de banco.
- Nunca alterar produção diretamente sem backup.

## Saída esperada

```text
Plano de rollback:

Estado atual:
- [descrição]

Ponto de restauração:
- [commit/backup/arquivo]

Arquivos críticos:
- [arquivo]

Como desfazer:
- [passos]
```

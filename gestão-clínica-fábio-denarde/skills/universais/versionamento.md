# Skill — Versionamento

## Função

Organizar mudanças do projeto com histórico claro e controle de versão.

## Objetivo

Evitar confusão sobre o que mudou, quando mudou e se a versão deveria ser incrementada.

## Aplicar quando

Use esta Skill em:

- novas funcionalidades;
- correções importantes;
- mudanças visuais relevantes;
- ajustes de sincronismo;
- deploy;
- release para produção.

## SemVer simplificado

Use a lógica:

```text
MAJOR.MINOR.PATCH
```

Exemplo:

```text
1.5.2
```

## Quando alterar PATCH

Use PATCH quando houver:

- correção pequena;
- ajuste visual pequeno;
- bug pontual;
- melhoria sem nova funcionalidade.

Exemplo:

```text
1.5.1 → 1.5.2
```

## Quando alterar MINOR

Use MINOR quando houver:

- nova funcionalidade;
- melhoria relevante de interface;
- novo relatório;
- novo botão;
- novo fluxo secundário.

Exemplo:

```text
1.5.2 → 1.6.0
```

## Quando alterar MAJOR

Use MAJOR quando houver:

- mudança estrutural grande;
- nova arquitetura;
- migração de dados;
- quebra de compatibilidade;
- reformulação geral do sistema.

Exemplo:

```text
1.6.0 → 2.0.0
```

## Regras

1. Toda versão precisa ter changelog.
2. Deploy em produção deve registrar versão.
3. Mudança crítica precisa de teste.
4. Não aumentar versão sem alteração real.
5. Não deixar alteração grande sem atualizar versão.

## Saída esperada

```text
Versão sugerida:
[versão]

Motivo:
- [motivo]

Changelog:
- [item]
```

# Checklist — Pré-Deploy

Use antes de qualquer publicação em produção.

## Segurança

- [ ] O usuário autorizou deploy explicitamente.
- [ ] Não há alteração acidental.
- [ ] Não há dados sensíveis em logs.
- [ ] Não há envios WhatsApp ativos indevidos.
- [ ] Não há QR Code sendo gerado.
- [ ] Não há alteração de Firebase sem autorização.

## Código

- [ ] Build executa sem erro.
- [ ] Console sem erro crítico.
- [ ] Dependências conferidas.
- [ ] Arquivos alterados revisados.
- [ ] Não houve refatoração desnecessária.
- [ ] Não houve alteração radical sem necessidade.

## Clínica

- [ ] Agenda validada.
- [ ] Pacientes validados.
- [ ] Sessões validadas.
- [ ] Pacotes validados.
- [ ] Pagamentos validados.
- [ ] Robô WhatsApp validado em modo offline.
- [ ] Relatórios validados.

## Rollback

- [ ] Existe commit anterior funcional.
- [ ] Existe plano para desfazer.
- [ ] Arquivos críticos identificados.
- [ ] Usuário sabe o que foi alterado.

## Decisão

```text
Deploy liberado?
[sim/não]

Motivo:
[descrição]
```

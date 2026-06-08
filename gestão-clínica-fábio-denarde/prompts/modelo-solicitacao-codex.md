# Prompt Modelo — Solicitação Segura ao Codex

Use este prompt como base para qualquer tarefa no projeto.

```text
Antes de alterar qualquer arquivo, leia e siga:

- PROJECT_CONTEXT.md
- skills/universais/auditor-risco.md
- skills/universais/backup-rollback.md
- skills/universais/qa-regressao.md
- skills/clinica/guardiao-logica-clinica.md
- skills/clinica/sincronismo-agenda-sessoes-pagamentos.md

Tarefa:
[descreva a tarefa aqui]

Regras obrigatórias:
1. Não fazer deploy.
2. Não enviar WhatsApp.
3. Não inicializar WhatsApp.
4. Não gerar QR Code.
5. Não alterar Firebase sem autorização.
6. Não alterar dados reais.
7. Não alterar regra de negócio validada sem explicar.
8. Não alterar lógica de sessões, pacotes, pagamentos ou agenda sem relatório.
9. Antes de editar, listar os arquivos que pretende alterar e o motivo.
10. Se houver risco alto ou crítico, parar e pedir confirmação.

Ao final, forneça:
- Arquivos alterados.
- O que foi preservado.
- Como testar.
- Nota de Arquitetura: 0–100.
- Nota de Performance: 0–100.
- Nota de Segurança: 0–100.
- Nota de Usabilidade: 0–100.
- Nota de Escalabilidade: 0–100.
- Nota Geral: 0–100.
- Pergunte se desejo alguma melhoria ou correção relacionada ao assunto, considerando qualquer uma das pastas/conversas do projeto.
```

# Prompt — Correção de Sincronismo Crítico

```text
Antes de alterar qualquer arquivo, leia:
- PROJECT_CONTEXT.md
- skills/universais/auditor-risco.md
- skills/universais/backup-rollback.md
- skills/universais/qa-regressao.md
- skills/clinica/guardiao-logica-clinica.md
- skills/clinica/sincronismo-agenda-sessoes-pagamentos.md
- skills/clinica/pagamentos-clinica.md
- skills/clinica/agenda-clinica.md

Problema:
Há divergência de sincronismo entre Agenda, Sessões, Pacotes e Pagamentos.

Objetivo:
Analisar e corrigir com extrema cautela, sem causar perda de dados, sem alterar dados reais sem relatório, sem afetar o robô WhatsApp e sem quebrar pacientes que já estão corretos.

Regras obrigatórias:
1. Primeiro analisar sem alterar.
2. Gerar relatório de divergências.
3. Não corrigir em massa sem simulação.
4. Não alterar dados reais sem autorização.
5. Não alterar robô WhatsApp.
6. Não fazer deploy.
7. Não usar valores fictícios.
8. Não sobrescrever histórico.
9. Não renumerar sessões sem justificar.
10. Antes de editar, listar arquivos e riscos.

Relatório obrigatório por paciente afetado:
- Paciente.
- Pacote atual.
- Data de início do pacote.
- Sessões esperadas.
- Sessões encontradas.
- Sessões realizadas.
- Faltas.
- Cancelamentos.
- Pagamentos.
- Saldo.
- Divergência.
- Causa provável.
- Correção proposta.
- Risco.

Ao final:
- Informe se a correção é segura.
- Informe se precisa de confirmação antes de aplicar.
- Dê notas de Arquitetura, Performance, Segurança, Usabilidade, Escalabilidade e Nota Geral.
- Pergunte se desejo alguma melhoria ou correção relacionada ao assunto, considerando qualquer uma das pastas/conversas do projeto.
```

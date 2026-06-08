# PROMPT CURTO — SEGURANÇA E SINCRONISMO PARA CODEX

Use Goal Mode neste projeto.

Projeto: Gestão Clínica Neuropsicopedagógica.

Objetivo:
Analisar e corrigir a solicitação atual preservando o sincronismo entre Agenda, Pacientes, Pacotes, Sessões, Pagamentos e Robô WhatsApp.

Regras obrigatórias:
1. Não enviar mensagens pelo WhatsApp.
2. Não inicializar WhatsApp.
3. Não gerar QR Code.
4. Não executar scripts de envio real.
5. Não apagar dados reais.
6. Não alterar dados de pacientes, responsáveis, telefones, agenda ou pagamentos sem necessidade.
7. Não alterar a lógica do robô WhatsApp sem autorização explícita.
8. Não fazer deploy antes de testar localmente.
9. Não trocar cálculo real por mock, valor fixo ou dado fictício.
10. Não corrigir apenas o visual quando houver regra de negócio envolvida.

Antes de editar:
1. Analise os arquivos relacionados.
2. Explique a lógica atual.
3. Identifique riscos de quebra.
4. Informe quais arquivos serão alterados.
5. Só depois execute a correção.

Regras de sincronismo:
1. A Agenda deve ser a principal referência para datas, horários e status.
2. A aba Pagamentos deve refletir corretamente pacote atual, sessões, parcelas e saldo.
3. Sessões antigas não podem entrar em pacote novo.
4. Agendamentos futuros não contam como sessões realizadas.
5. Cancelamentos não contam como sessões realizadas.
6. Faltas só contam como sessão se essa já for a regra atual do sistema.
7. O robô WhatsApp deve usar apenas dados corretos da agenda real.

Após corrigir, teste:
1. Agenda.
2. Pacientes.
3. Pacotes.
4. Sessões.
5. Pagamentos.
6. Saldo a receber.
7. Parcelas.
8. Robô WhatsApp em modo seguro/offline.
9. Console do navegador.
10. Build/lint/testes, quando existirem.

Relatório final obrigatório:
- Problema encontrado.
- Arquivos analisados.
- Arquivos alterados.
- Lógica anterior.
- Lógica corrigida.
- Testes realizados.
- Resultado dos testes.
- Confirmação de que o robô WhatsApp não foi executado.
- Confirmação de que nenhuma mensagem foi enviada.
- Confirmação de que nenhum QR Code foi gerado.
- Riscos restantes.
- Orientação se devo ou não fazer deploy.
- Nota de Arquitetura: 0–100.
- Nota de Performance: 0–100.
- Nota de Segurança: 0–100.
- Nota de Usabilidade: 0–100.
- Nota de Escalabilidade: 0–100.
- Nota Geral: 0–100.

Ao final, pergunte:
“Deseja que eu faça alguma melhoria ou correção adicional relacionada a este assunto, considerando qualquer uma das pastas ou conversas do projeto?”

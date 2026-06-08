# PROMPT LONGO — SEGURANÇA, SINCRONISMO E GOAL MODE PARA CODEX

Use Goal Mode neste projeto.

Projeto: Gestão Clínica Neuropsicopedagógica.

Objetivo principal:
Analisar, corrigir e proteger o sincronismo entre Agenda, Pacientes, Pacotes, Sessões, Pagamentos, Relatórios e Robô WhatsApp, sempre com extrema cautela, pois o sistema contém dados reais de pacientes, responsáveis, horários de atendimento, valores financeiros e lógica de mensagens automáticas.

IMPORTANTE:
Antes de qualquer alteração, faça uma análise completa do impacto.
Não altere arquivos diretamente sem antes entender a lógica atual.
Não trate a solicitação como uma simples melhoria visual.
Sempre preserve a lógica funcional existente, principalmente Agenda, Sessões, Pacotes, Pagamentos e Robô WhatsApp.

REGRAS DE SEGURANÇA OBRIGATÓRIAS:
1. Não enviar mensagens reais pelo WhatsApp.
2. Não inicializar WhatsApp.
3. Não gerar QR Code.
4. Não executar scripts de envio real.
5. Não acionar automações reais de lembrete.
6. Não apagar dados reais.
7. Não sobrescrever arquivos críticos sem verificar antes.
8. Não alterar estrutura de banco/dados sem backup, migração segura ou explicação clara.
9. Não alterar a lógica do robô WhatsApp sem autorização explícita.
10. Não fazer deploy antes de validar o funcionamento local.
11. Não alterar dados de pacientes, responsáveis, telefones, pagamentos ou agenda sem necessidade.
12. Não substituir cálculo real por valor fixo, mock, dado fictício ou simulação visual.
13. Não corrigir apenas a aparência se o problema envolver regra de negócio.
14. Não considerar a tela visual como fonte única de verdade; validar também a origem dos dados no código.

ÁREAS CRÍTICAS DO SISTEMA:
- Agenda;
- Cadastro de pacientes;
- Detalhes do paciente;
- Pacotes de atendimento;
- Sessões realizadas;
- Faltas;
- Cancelamentos;
- Agendamentos futuros;
- Pagamentos;
- Parcelas;
- Receita bruta;
- Saldo a receber;
- Relatórios;
- Robô WhatsApp;
- Relatório offline do robô;
- Textos automáticos enviados aos responsáveis;
- Telefones dos responsáveis;
- Status financeiro dos pacientes.

REGRAS DE SINCRONISMO:
1. A Agenda deve ser a principal referência para datas, horários e status dos atendimentos.
2. A aba Pagamentos deve refletir corretamente os pacotes, sessões realizadas, parcelas pagas e saldo a receber.
3. O Cadastro do Paciente deve permanecer sincronizado com Agenda e Pagamentos.
4. Sessões antigas não podem ser contadas dentro de um pacote novo.
5. Agendamentos futuros não podem ser contados como sessões realizadas.
6. Cancelamentos não devem ser contados como sessões realizadas.
7. Faltas só devem contar como sessão consumida se essa já for a regra atual do sistema.
8. O número da sessão deve respeitar a sequência lógica real do paciente.
9. O pacote atual deve considerar data de início, sessões vinculadas e pagamentos correspondentes.
10. O robô WhatsApp deve usar apenas dados corretos da agenda real.
11. Alterações visuais não podem modificar regras de cálculo.
12. Dados financeiros devem ser calculados com base na mesma fonte usada pelas telas principais.

ANTES DE EDITAR, FAÇA:
1. Mapear onde a Agenda salva os atendimentos.
2. Mapear onde os pacientes são cadastrados.
3. Mapear onde o pacote atual é definido.
4. Mapear como as sessões são numeradas.
5. Mapear como a aba Pagamentos calcula sessões realizadas.
6. Mapear como a aba Pagamentos calcula parcelas pagas e saldo a receber.
7. Mapear se o robô WhatsApp consulta diretamente a Agenda, os pacientes ou outra fonte intermediária.
8. Identificar riscos de quebra no sincronismo.
9. Informar quais arquivos provavelmente precisarão ser alterados.
10. Explicar brevemente a lógica atual antes de modificar.
11. Verificar se existem dados mockados, duplicados, derivados ou desatualizados.
12. Verificar se a alteração pedida afeta outras abas.

SE A TAREFA ENVOLVER PAGAMENTOS:
Verifique cuidadosamente:
- receita bruta;
- saldo a receber;
- parcelas pagas;
- parcelas pendentes;
- pacote atual;
- data de início do pacote atual;
- sessões realizadas dentro do pacote atual;
- sessões antigas;
- faltas;
- cancelamentos;
- agendamentos futuros;
- diferença entre valor contratado, valor pago e valor em aberto.

A aba Pagamentos não deve exibir dados fictícios, duplicados ou fora de sincronismo com Agenda e Cadastro do Paciente.

SE A TAREFA ENVOLVER AGENDA:
Verifique cuidadosamente:
- criação de agendamento;
- edição de agendamento;
- exclusão de agendamento;
- status: agendado, realizado, falta e cancelado;
- horário real da sessão;
- paciente vinculado;
- responsável vinculado;
- impacto no pacote atual;
- impacto no contador de sessões;
- impacto em pagamentos;
- impacto no robô WhatsApp;
- impacto no relatório offline do robô.

SE A TAREFA ENVOLVER ROBÔ WHATSAPP:
Trabalhe somente em modo seguro/offline, salvo autorização explícita.

Obrigatório:
- Não enviar mensagens.
- Não inicializar WhatsApp.
- Não gerar QR Code.
- Não executar envio real.
- Não disparar lembretes.
- Não modificar telefones de responsáveis.
- Não alterar textos oficiais sem mostrar antes.
- Não alterar regras de véspera, dia do atendimento, manhã, tarde ou bloqueios sem relatório.
- Não executar scripts como force-send-reminders, send-reminders, start-bot ou similares sem autorização explícita.
- Se precisar testar o robô, use apenas simulação offline ou relatório offline.

SE A TAREFA ENVOLVER DESIGN/FRONT-END:
Melhore o visual sem quebrar regra de negócio.
Antes de alterar componentes visuais que exibem dados reais, confirme de onde os dados vêm.
Não substituir cálculo real por mock, valor fixo ou dado fictício.

Manter responsividade profissional para:
- monitor desktop de 22";
- notebooks;
- tablets;
- telas menores;
- celular, se aplicável.

Melhorar:
- hierarquia visual;
- espaçamentos;
- legibilidade;
- tamanho de fonte;
- contraste;
- alinhamento;
- botões;
- cards;
- modais;
- mensagens de erro;
- estados vazios;
- feedback visual;
- acessibilidade.

TESTES OBRIGATÓRIOS:
Após qualquer alteração, testar:
1. Criar agendamento.
2. Editar agendamento.
3. Marcar sessão como realizada.
4. Marcar falta.
5. Marcar cancelamento.
6. Verificar se o número da sessão ficou correto.
7. Verificar se o pacote atual ficou correto.
8. Verificar se a aba Pagamentos atualizou corretamente.
9. Verificar se o saldo a receber está correto.
10. Verificar se parcelas pagas e pendentes estão corretas.
11. Verificar se o cadastro do paciente continua sincronizado.
12. Verificar se o robô WhatsApp não foi executado.
13. Verificar se nenhum QR Code foi gerado.
14. Verificar se nenhuma mensagem foi enviada.
15. Verificar responsividade visual.
16. Verificar console do navegador.
17. Rodar testes/lint/build quando existirem.
18. Verificar se não houve regressão em outras abas.
19. Validar o comportamento com pelo menos dois pacientes diferentes.
20. Validar casos de pacote novo, pacote antigo, sessão realizada, falta, cancelamento e agendamento futuro.

CASOS DE ATENÇÃO:
Sempre que possível, validar casos reais citados pelo usuário, como:
- Weslley: verificar pacote atual, data de início do pacote e sessões exibidas.
- Luiza: verificar pendência de parcela e saldo restante.
- Outros pacientes: verificar se não houve alteração indevida nos que já estavam corretos.

RELATÓRIO FINAL OBRIGATÓRIO:
Ao finalizar, entregue um relatório com:

1. Resumo do problema encontrado.
2. Arquivos analisados.
3. Arquivos alterados.
4. Lógica anterior.
5. Lógica corrigida.
6. Riscos identificados.
7. Como o sincronismo foi preservado.
8. Testes realizados.
9. Resultado dos testes.
10. Resultado específico dos pacientes analisados.
11. Confirmação explícita de que o robô WhatsApp não foi executado.
12. Confirmação explícita de que nenhuma mensagem foi enviada.
13. Confirmação explícita de que nenhum QR Code foi gerado.
14. Pendências ou riscos restantes, se houver.
15. Orientação se devo ou não fazer deploy.
16. Nota de Arquitetura: 0–100.
17. Nota de Performance: 0–100.
18. Nota de Segurança: 0–100.
19. Nota de Usabilidade: 0–100.
20. Nota de Escalabilidade: 0–100.
21. Nota Geral: 0–100.

Ao final, pergunte:
“Deseja que eu faça alguma melhoria ou correção adicional relacionada a este assunto, considerando qualquer uma das pastas ou conversas do projeto?”

# CHECKPOINT — Agenda, numeração e reagendamento

Atualizado em: 22/06/2026 13:28:41 (America/Sao_Paulo)

## Objetivo

Corrigir estruturalmente na aba Agenda:

1. perda de foco no campo de observação durante a digitação;
2. divergência entre a numeração “Sessão será” e o resumo do pacote após cancelar/excluir um horário;
3. ausência de um fluxo seguro para reagendar uma sessão sem cancelar, excluir e recriar o atendimento.

A solução foi implementada para todos os atendentes, sem condição especial por nome ou por documento real.

## Estado inicial do Git

- Branch informada no pacote: `main`.
- HEAD informado no pacote: `dbec501f312cdbc00fd5d9203ad3c46c9c2e40a0`.
- Alterações preexistentes informadas:
  - `../.gitignore` modificado;
  - `docs/VALIDACAO_VISUAL_MONITORAMENTO.md` não rastreado;
  - `logs/audit/` não rastreado;
  - `relatorios/` não rastreado;
  - `src/components/Monitoring/MonitoringUiPreview.tsx` não rastreado;
  - `../q` não rastreado.
- Nenhum arquivo estava em stage no pacote recebido.

## Alterações preexistentes preservadas

As alterações acima não foram editadas, removidas nem incorporadas ao pacote de correção. O trabalho ficou restrito aos arquivos listados neste checkpoint.

## Arquivos auditados

Principais arquivos examinados:

- `src/components/Agenda.tsx`;
- `src/components/Common/Modal.tsx`;
- `src/App.tsx`;
- `src/lib/sessionSequence.ts`;
- `src/lib/utils.ts`;
- `src/types.ts`;
- `shared/sessionRemoval.js`;
- `shared/sessionPackageSummary.js`;
- testes de Agenda, pacote, cancelamento, Portal, Galeria, Google Fotos e Monitoramento.

## Causa do bloqueio do campo de anotações

O `Modal` executava novamente o efeito responsável por capturar e restaurar o foco sempre que a função `onClose` mudava. Na Agenda, `onClose` é normalmente fornecida como função inline. Cada caractere digitado atualizava o estado do formulário, provocava nova renderização, criava outra função `onClose` e reiniciava o efeito. O foco era deslocado novamente para o botão de fechar, interrompendo a digitação contínua no `textarea`.

## Correção do campo de anotações

- `onClose` e `closeDisabled` passaram a ser acompanhados por referências atualizadas separadamente.
- O efeito de foco do modal depende apenas da abertura do modal e da referência de foco inicial.
- A digitação no campo continua exclusivamente em estado local por `setNotes`.
- Não foi introduzida gravação no Firebase a cada tecla.
- Backspace, seleção, colagem, acentos, pontuação e quebra de linha deixam de provocar remontagem ou perda de foco causada pelo modal.

## Causa da divergência de numeração

A Agenda possuía uma janela de estado desatualizado após gravações confirmadas no Firestore. `updateState` persistia o lote, mas aguardava o retorno do listener para refletir o novo conjunto de sessões na interface. Nesse intervalo, uma sessão cancelada ou removida ainda podia permanecer localmente como `Agendada`. Ao criar rapidamente outro horário, o cálculo da próxima posição considerava o registro antigo e avançava indevidamente de 9 para 10.

Além disso, a regra de sequência não possuía uma fonte compartilhada em JavaScript para testar explicitamente tombstones e registros removidos.

## Fonte de verdade adotada

Foi criada `shared/sessionScheduling.js` como regra pura, reutilizada pelo adaptador TypeScript `src/lib/sessionSequence.ts`.

A regra:

- considera apenas o mesmo `patientId`;
- ignora bloqueios e registros marcados com `removedFromAgenda`;
- considera como concluídas as situações já aceitas pelo sistema;
- considera como futuras somente sessões `Agendada` válidas;
- não reserva posição por sessão `Cancelada` ou removida;
- ordena de forma determinística por data, horário e ID;
- preserva um número lógico após reagendamento para que mover o horário não crie outra utilização.

Após um lote ser confirmado pelo Firestore, `App.tsx` agora reflete imediatamente o `newState` localmente. O listener permanece como fonte autoritativa, mas não existe mais a janela em que a Agenda reutilizava a sessão antiga para o cálculo seguinte.

## Regra de sessões concluídas

Entram na sequência clínica, conforme a regra já existente:

- `Realizada`;
- `Reposição`;
- `late_cancellation_no_replacement`;
- `Falta` somente quando `consumesPackage === true`.

Não entram:

- sessões bloqueadas;
- tombstones removidos;
- cancelamentos comuns;
- faltas sem consumo do pacote;
- registros de outro atendente.

## Regra de sessões futuras

Somente sessões `Agendada`, válidas e não removidas reservam posições futuras. Quando existem oito sessões concluídas e nenhum outro agendamento futuro válido, a próxima sessão é 9, independentemente de haver histórico de uma sessão cancelada e removida.

## Regra de cancelamento

- `Cancelada` não é tratada como sessão concluída.
- `Cancelada` não entra na lista de futuras válidas.
- O cancelamento não aumenta o contador do pacote.
- O estado confirmado é refletido localmente após o lote ser persistido.

## Regra de exclusão

- Sessão manual continua sendo removida fisicamente da lista.
- Ocorrência fixa usa tombstone para impedir que o horário virtual reapareça.
- Tombstone é idempotente e não entra no cálculo do pacote.
- Repetir a remoção não produz segundo efeito.
- Uma ocorrência fixa reagendada continua suprimindo o horário fixo original.

## Modelagem do reagendamento

Foi adicionada a ação **Reagendar sessão** para:

- ocorrência fixa virtual válida;
- sessão `Agendada`;
- sessão de `Reposição`.

Não aparece para sessão concluída, cancelada, removida ou bloqueada.

Comportamento:

- exibe atendente, data/horário atual e número lógico;
- permite nova data e horário;
- valida data fechada, dia sem expediente, horário inválido, ausência de mudança e conflito no destino;
- para sessão real, mantém o mesmo `id` e atualiza o mesmo documento;
- para ocorrência fixa ainda virtual, materializa apenas uma sessão persistente e guarda a origem fixa para impedir a recriação do cartão anterior;
- preserva atendente, tipo, observação, pacote e demais campos por espalhamento do registro original;
- registra `rescheduledAt`, `rescheduledBy` e histórico limitado às 20 alterações mais recentes;
- preserva `logicalSessionPosition`, `logicalSessionNumber` e `packageNumber`; a posição absoluta impede duplicidade mesmo quando a 9ª sessão é movida para depois da 10ª;
- possui trava síncrona por `useRef`, estado de carregamento e botão desabilitado para impedir clique duplo;
- não cria listener, cron, migração ou gravação em massa.

## Arquivos criados

- `shared/sessionScheduling.js`;
- `tests/agenda-rescheduling.test.mjs`;
- `docs/CHECKPOINT_CONTINUIDADE_AGENDA_REAGENDAMENTO.md`.

## Arquivos modificados

- `shared/sessionRemoval.js`;
- `src/App.tsx`;
- `src/components/Agenda.tsx`;
- `src/components/Common/Modal.tsx`;
- `src/lib/sessionSequence.ts`;
- `src/lib/utils.ts`;
- `src/types.ts`;
- `tests/late-cancellation-no-replacement.test.mjs`;
- `tests/session-removal.test.mjs`.

## Testes criados

Coberturas adicionadas:

- cenário 8/10 após cancelar e excluir;
- canceladas, tombstones e outro atendente não reservam posição;
- duas sessões futuras válidas ocupam 9 e 10;
- reagendamento real preserva ID, paciente, observação, posição e número lógico;
- registro gerado não contém campos `undefined` incompatíveis com Firestore;
- ocorrência fixa virtual é materializada e suprime a origem;
- reagendar a 9ª sessão para depois da 10ª não gera números duplicados e a sessão seguinte passa para o próximo ciclo;
- tentativa de reagendar para o mesmo horário é idempotente;
- modal não reinicia o efeito de foco por função `onClose` inline;
- Agenda não grava observação a cada tecla;
- trava contra clique duplo está presente;
- ocorrência fixa reagendada continua suprimindo o horário original.

## Testes executados

### Testes específicos

Comando:

`node --test tests/agenda-rescheduling.test.mjs tests/session-removal.test.mjs tests/late-cancellation-no-replacement.test.mjs`

Resultado final: **23/23 aprovados**.

### Regressão relacionada

Comando executado sobre:

- `agenda-rescheduling`;
- `session-removal`;
- `session-package-summary`;
- `late-cancellation-no-replacement`;
- `responsible-portal-packages`;
- `activity-gallery-status`;
- `google-photos-albums`;
- `monitoring-panel`.

Resultado final: **123/123 aprovados**.

### Suíte completa disponível no ZIP sanitizado

Comando:

`node --test tests/*.test.mjs`

Resultado: **362 aprovados de 367; 5 falhas fora do escopo desta tarefa**.

Falhas registradas:

1. teste de Activity Records não encontrou `drive-api-server.js`, arquivo não incluído no ZIP sanitizado recebido;
2. teste visual legado esperava texto antigo do Monitoramento e diverge do estado preexistente do pacote;
3. teste administrativo do WhatsApp não encontrou `ecosystem.config.cjs`, arquivo não incluído no ZIP sanitizado;
4. teste operacional do WhatsApp não encontrou `server.js`, arquivo não incluído no ZIP sanitizado;
5. teste preexistente de concorrência do ledger do WhatsApp falhou isoladamente esperando `sender-a`; o WhatsApp não foi modificado nem iniciado.

Nenhuma dessas cinco falhas toca os arquivos da correção da Agenda.

## Teste manual local

Não executado nesta cópia isolada porque ela não possui sessão autenticada nem deve acessar o Firebase de produção ou dados reais. O teste manual no navegador local permanece obrigatório após aplicar o pacote no repositório verdadeiro, antes de qualquer commit, push ou deploy.

Cenários manuais pendentes:

1. digitar, editar e colar texto na observação;
2. com dados controlados, cancelar/excluir um horário e conferir que o substituto continua na posição correta;
3. reagendar uma sessão existente e atualizar a página para confirmar persistência e manutenção da numeração.

## Resultado do lint

`npm run lint` (`tsc --noEmit`): **aprovado**.

Observação: a cópia sanitizada não continha `firebase-applet-config.json`; foi usado somente no ambiente isolado um arquivo fictício temporário para permitir a resolução de módulo. Esse arquivo não integra o pacote de entrega.

## Resultado do TypeScript

Aprovado pelo comando oficial `npm run lint`, que executa `tsc --noEmit`.

## Resultado do build

`npm run build`: **aprovado**.

- Vite concluiu a transformação de 3.234 módulos.
- Nenhum artefato de `dist` integra o pacote de entrega.

## Resultado do git diff --check

`git diff --check`: **aprovado** em repositório temporário criado a partir do pacote original e contendo somente os 12 arquivos criados/modificados desta entrega.

O comando deverá ser repetido no repositório real após a aplicação, porque ele também verificará as alterações preexistentes do computador. A entrega foi preparada sem credenciais, `node_modules`, `dist` ou arquivos temporários.

## Riscos ou inconsistências históricas

- Não foi feita migração nem correção de documentos reais.
- Registros antigos sem metadados de reagendamento continuam sendo calculados pela regra histórica determinística.
- A implementação não tenta adivinhar vínculos financeiros inexistentes.
- O fluxo geral de `updateState` do projeto trata erros internamente; esse comportamento preexistente não foi ampliado para evitar uma alteração transversal fora do escopo.
- A suíte de WhatsApp mantém falha preexistente no teste de concorrência; não foi corrigida por restrição de escopo e segurança.

## Correções de dados que exigiriam autorização

Nenhuma correção em massa foi executada. Caso um documento real já tenha número persistido historicamente incorreto, primeiro deverá ser feito diagnóstico somente leitura após o código estar validado localmente. Qualquer ajuste de documento real exige autorização específica e backup.

## Revisão de consumo do Firebase

A solução:

- não adiciona listener;
- não carrega coleção extra;
- não grava durante a digitação;
- altera somente a sessão reagendada dentro da sincronização já existente;
- não introduz padrão N+1;
- não cria agregação, cron ou migração;
- reflete localmente apenas o lote já confirmado, reduzindo operações repetidas motivadas por estado visual atrasado.

## Próximo passo exato

1. aplicar o pacote no repositório real com backup automático;
2. executar testes específicos, lint, build e `git diff --check` localmente;
3. realizar os três testes manuais no navegador local;
4. enviar os resultados para revisão;
5. não executar commit, push ou deploy antes da aprovação do teste manual.

## Confirmações

- Nenhum commit executado.
- Nenhum push executado.
- Nenhum deploy executado.
- Nenhuma Firebase Rule publicada.
- Nenhum dado real consultado, criado, editado ou excluído.
- Nenhum paciente real modificado.
- Nenhum pagamento real modificado.
- Nenhum WhatsApp iniciado ou alterado.
- Nenhum PM2 iniciado ou alterado.
- Nenhuma credencial incluída na entrega.

---

## Continuação após teste visual — sincronismo da numeração

Data: 22/06/2026.

### Resultado do primeiro teste manual

O campo de observação e o build permaneceram aprovados, porém o teste visual com Alicia mostrou que o card da Agenda ainda exibia `Sessão será 10`, enquanto o resumo compartilhado `Sessões Restantes (Pacote atual)` mostrava corretamente 8 sessões realizadas e 2 restantes.

A primeira correção foi, portanto, classificada como incompleta para a numeração real.

### Causa complementar encontrada

A função compartilhada da Agenda ainda montava a sequência com critérios diferentes do card de pacote:

- considerava estados que consomem financeiramente o pacote, mas que o card não classifica como sessão realizada;
- permitia que registros antigos ainda marcados como `Agendada`, anteriores à última sessão realizada, reservassem posição;
- não reproduzia explicitamente o cenário real de segundo pacote com 18 sessões históricas e 8 realizadas no ciclo atual.

Assim, a tela podia avançar para 10 mesmo quando o card correto permanecia em 8/10.

### Segunda correção aplicada

Arquivo principal alterado:

- `shared/sessionScheduling.js`.

A numeração exibida na Agenda passou a usar o mesmo conceito do card de pacote:

- somente `Realizada` e `Reposição` avançam a base de sessões realizadas;
- `Cancelada`, tombstone e bloqueio não reservam posição;
- faltas e falta sem reposição mantêm seus efeitos financeiros em módulos próprios, mas não criam divergência visual com o contador de sessões realizadas;
- registros legados `Agendada` anteriores à última sessão realizada são ignorados na reserva da próxima posição;
- sessões futuras válidas continuam recebendo posições sequenciais;
- posições lógicas estáveis de reagendamentos continuam preservadas.

### Testes adicionais

Foram adicionados cenários para:

1. segundo pacote com 18 sessões históricas, 8 no ciclo atual e próxima sessão igual a 9;
2. registro antigo ainda marcado como `Agendada` antes da última realizada;
3. falta consumida e falta sem reposição sem divergência em relação ao card de sessões realizadas.

### Validação da continuação

- regressão relacionada: **126/126 aprovada**;
- TypeScript (`npm run lint`): aprovado;
- build Vite: aprovado;
- módulos transformados: 3.234;
- nenhum Firebase acessado;
- nenhum dado real alterado;
- nenhum WhatsApp ou PM2 iniciado;
- nenhum commit, push ou deploy executado.

### Próximo passo atualizado

Aplicar o hotfix incremental sobre a primeira correção já instalada e repetir apenas a conferência visual da numeração antes de qualquer commit.

# AUDITORIA — NUMERAÇÃO DE SESSÕES CONSECUTIVAS

Atualizado em: 23/06/2026 14:05 (America/Sao_Paulo)

## Estado da tarefa

Correção preparada e validada em pacote técnico isolado. A aplicação no repositório real e a validação visual local ainda são obrigatórias antes de qualquer commit, push ou deploy.

## Estado inicial recebido

- Branch: `main`.
- Commit HEAD: `2d2128df8bbaee56f8ae01d3afe33416380e3873`.
- Nenhum arquivo estava no stage.
- Alterações preexistentes informadas e preservadas:
  - `../.gitignore` modificado;
  - `docs/VALIDACAO_VISUAL_MONITORAMENTO.md` não rastreado;
  - `logs/audit/` não rastreado;
  - `relatorios/` não rastreado;
  - `src/components/Monitoring/MonitoringUiPreview.tsx` não rastreado;
  - `../q` não rastreado.

## Causa raiz confirmada

A regra compartilhada de sequência já conseguia numerar corretamente vários horários do mesmo atendente quando todos os registros estavam presentes na fonte de cálculo.

O erro estava na Agenda: os textos `Sessão será X` eram calculados somente com `state.sessions`, que contém os registros persistidos. Ocorrências fixas ainda virtuais, especialmente o segundo horário de uma sessão dupla, eram exibidas por `getSessionsForDate`, mas não eram adicionadas à fonte usada pela numeração.

Consequências observadas:

- o primeiro horário persistido podia mostrar número;
- o segundo horário virtual podia ficar sem número;
- ao navegar para a semana seguinte, ocorrências virtuais da semana anterior não eram consideradas;
- a sequência podia aparentar avançar apenas uma vez por dia, apesar de cada horário representar uma sessão independente.

## Regra anterior

- a Agenda exibia horários persistidos e virtuais;
- a numeração recebia apenas os horários persistidos;
- cada ocorrência virtual era analisada fora da sequência completa;
- a etiqueta `DUPLA` não era a causa direta, mas tornava o problema mais visível porque o segundo horário costuma permanecer virtual.

## Regra corrigida

A Agenda passa a montar uma fonte única de sequência contendo:

1. todas as sessões persistidas já carregadas no estado;
2. todas as ocorrências fixas virtuais entre a data atual e o fim da semana exibida;
3. deduplicação por ID e por `patientId + data + horário`;
4. ordenação já existente por data, horário e ID;
5. sequência independente por `patientId`.

Cada horário é uma sessão independente, com ou sem a etiqueta `DUPLA`.

Exemplo validado:

- 26/06 14:00 → Sessão 1;
- 26/06 15:00 → Sessão 2;
- 03/07 14:00 → Sessão 3;
- 03/07 15:00 → Sessão 4.

## Escopo global

A correção não contém condição por nome e não depende do atendente Celso. A regra é aplicada a todos os atendentes porque o agrupamento permanece baseado em `patientId`.

Também foram testados:

- três horários consecutivos no mesmo dia sem etiqueta `DUPLA`;
- dois atendentes diferentes no mesmo horário;
- dois registros com IDs de atendentes diferentes;
- combinação de horário persistido com horário virtual;
- quatro horários totalmente virtuais em duas semanas;
- deduplicação de uma ocorrência virtual já materializada.

Nenhuma consulta ao Firebase de produção foi executada para procurar nomes reais. A verificação de dados reais deverá ser apenas visual, no ambiente local, após aplicar a correção.

## Impacto sobre pacotes e sessões restantes

A estrutura de pacotes não foi refatorada.

- Sessões já persistidas continuam sendo documentos independentes.
- Relatórios e o card de sessões restantes continuam usando suas regras compartilhadas atuais.
- A correção evita gravar no segundo horário virtual o mesmo `packageNumber` do primeiro horário quando ele for materializado.
- Não houve migração nem regravação de documentos antigos.
- Não houve alteração em pagamentos.

## Impacto sobre Pendências e Relatórios

Nenhuma regra de Pendências ou Relatórios foi alterada porque a causa estava na fonte de cálculo da Agenda. As regras compartilhadas de pacote permaneceram intactas.

## Arquivos criados

- `docs/AUDITORIA_SESSOES_CONSECUTIVAS.md`.

## Arquivos modificados

- `shared/sessionScheduling.js`;
- `src/lib/sessionSequence.ts`;
- `src/components/Agenda.tsx`;
- `tests/agenda-rescheduling.test.mjs`.

## Testes específicos executados

Comando:

`node --test tests/agenda-rescheduling.test.mjs tests/session-removal.test.mjs tests/late-cancellation-no-replacement.test.mjs`

Resultado: **31/31 aprovados**.

Coberturas novas:

- sessão dupla mista, com primeiro horário persistido e segundo virtual;
- continuidade 1, 2, 3 e 4 entre duas semanas;
- quatro ocorrências totalmente virtuais;
- horários consecutivos sem etiqueta `DUPLA`;
- independência por `patientId`;
- deduplicação de ocorrência materializada;
- uso da fonte combinada pela interface da Agenda.

## Regressão relacionada

Foi executada a seleção de testes de Agenda, remoção, pacote, cancelamento, Portal, Galeria, Google Fotos e Monitoramento.

Resultado do pacote sanitizado: **129/130 aprovados**.

A única falha ocorreu porque `firestore.rules` não estava incluído no ZIP sanitizado. Esse arquivo não pertence à correção e deverá existir no repositório real.

## Suíte completa disponível no pacote sanitizado

Resultado: **293/305 aprovados**.

As 12 falhas foram classificadas como externas à correção:

- arquivos omitidos pelo pacote sanitizado, como `firestore.rules` e `scripts/activate-whatsapp-robust-live.ps1`;
- módulos/servidores não incluídos no ZIP técnico;
- duas falhas preexistentes de concorrência do ledger do WhatsApp.

Nenhuma falha apontou os quatro arquivos modificados nesta correção.

## Sintaxe

- `shared/sessionScheduling.js`: `node --check` aprovado;
- `tests/agenda-rescheduling.test.mjs`: `node --check` aprovado;
- `src/components/Agenda.tsx`: transpilação sintática TypeScript/TSX aprovada;
- `src/lib/sessionSequence.ts`: transpilação sintática TypeScript aprovada.

## Lint e build

Não puderam ser concluídos no pacote isolado porque o ZIP foi criado sem `node_modules`, sem `firebase-applet-config.json` e sem outras dependências locais. O `npm run lint` falhou exclusivamente por módulos ausentes no ambiente sanitizado.

Após aplicar no repositório real, executar obrigatoriamente:

- testes específicos;
- regressão relacionada;
- `npm run lint`;
- `npm run build`;
- `git diff --check`;
- validação visual local.

## Validação visual obrigatória

Conferir na Agenda local:

- 26/06, 14:00 → Sessão 1;
- 26/06, 15:00 → Sessão 2;
- 03/07, 14:00 → Sessão 3;
- 03/07, 15:00 → Sessão 4.

Se o pacote real já estiver em outra posição, os números iniciais podem ser diferentes, mas devem continuar consecutivos e individuais em cada horário.

Também conferir qualquer outro atendente que possua dois ou mais horários no mesmo dia.

## Riscos restantes

- A correção depende de validação local com o estado real já carregado pela aplicação.
- Nenhum documento antigo foi migrado; dados históricos ambíguos permanecem preservados.
- Navegar para semanas muito distantes faz a Agenda calcular as ocorrências virtuais desde a data atual até o fim da semana exibida. O cálculo é local e não cria leituras adicionais no Firebase, mas deverá ser observado quanto ao desempenho em navegação extrema.

## Confirmações

- nenhum commit executado;
- nenhum push executado;
- nenhum deploy executado;
- nenhuma Firebase Rule publicada;
- nenhum dado real alterado;
- nenhuma agenda real modificada;
- nenhum pagamento modificado;
- nenhum WhatsApp iniciado ou alterado;
- nenhum PM2 iniciado, parado ou modificado.

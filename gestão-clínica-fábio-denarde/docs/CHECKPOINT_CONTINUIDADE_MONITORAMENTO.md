# Checkpoint — Tela de Monitoramento

## 1. Objetivo da tarefa

Auditar, implementar e validar localmente o novo perfil e ambiente "Monitoramento" no projeto Gestão Clínica Neuropsicopedagógica, preservando áreas existentes, dados reais, domínio oficial, WhatsApp, PM2, deploy, commits e publicações.

## 2. Data e hora da última atualização

2026-06-21 15:49:53 -03:00

## 3. Estado inicial do repositório

* pasta do projeto: `D:\Projeto Gestão Clínica - Repositório\gestão-clínica-fábio-denarde`
* branch: `main`
* commit HEAD: `6d458f60128bbe2d1eeff52c201b51136584cf57`
* status inicial:
  * `M ../.gitignore`
  * `?? logs/audit/`
  * `?? relatorios/`
  * `?? ../q`
* alterações preexistentes: as alterações listadas acima já existiam antes desta tarefa e não devem ser revertidas nem incluídas como parte da implementação de Monitoramento.
* domínio oficial: `https://gestaoclinica-solucoes.vercel.app`
* scripts observados em `package.json`: `dev`, `build`, `preview`, `clean`, `lint`, `server`, auditorias/testes de WhatsApp offline, testes de Drive, registros de atividades, Portal do Responsável, galeria de atividades e Google Photos.

## 4. Restrições confirmadas

* sem commit;
* sem push;
* sem deploy;
* sem publicação de regras;
* sem alteração de dados reais;
* sem WhatsApp;
* sem PM2;
* sem credenciais.

## 5. Auditoria realizada

Arquivos analisados:

* `package.json`: scripts disponíveis incluem `lint` (`tsc --noEmit`), `build`, testes de acesso, Portal do Responsável, Galeria de Atividades e Google Photos.
* `src/types/access.ts`: contrato já possui `AccessRole = 'admin' | 'professional' | 'responsible' | 'monitoring'`; porém `AccessRequestRole` excluía `monitoring`.
* `api/_lib/accessPermissions.js`: permissões canônicas já incluem `monitoring`, contexto adicional controlado e bloqueios absolutos de escrita para Monitoramento.
* `api/_lib/accessContext.js`: identifica o administrador principal por `PRIMARY_ADMIN_EMAIL = 'fdenarde@gmail.com'` e resolve o UID pelo Firebase Auth, sem depender apenas do texto do nome.
* `api/access.js`: cadastro público usa `ACCESS_ROLES = new Set(['professional', 'responsible'])`; solicitações são gravadas em `accessRequests`, `accessApprovals` e `accessProfiles`; aprovação/rejeição em `reviewRequest`; revogação em `revokeRequest`; vínculo de responsável em `linkResponsiblePatient`; Portal do Responsável em `getResponsiblePortalData`; pré-visualização administrativa do responsável em `getAdminResponsiblePortalData`.
* `src/components/Auth/AccessPortal.tsx`: login/cadastro público; formulário exige nome, e-mail, telefone/WhatsApp e perfil; atualmente exibe apenas Profissional e Responsável.
* `src/components/Auth/AccessRequestsAdminCard.tsx`: painel administrativo lista solicitações, aprova, rejeita, revoga e vincula responsáveis a atendentes; ainda não há suspensão nem validade opcional na UI.
* `src/App.tsx`: acesso interno atualmente limitado a Admin/Profissional; Responsável usa portal separado; listeners internos leem `users/{user.uid}/settings`, `patients`, `sessions`, `payments`, `repositions`, `expenses`, `evolutions`, `agenda_pessoal` e `externalRegistrationForms`; isso não serve para Monitoramento porque o workspace correto é o do administrador principal, não o UID do monitor.
* `src/components/Dashboard.tsx`: Dashboard atual usa `state` completo e possui ações de escrita para presença/faltas; não pode ser reutilizado diretamente para Monitoramento.
* `src/components/Agenda.tsx`: Agenda atual usa `state` completo e possui criação/edição/exclusão/observações/financeiro/WhatsApp; não pode ser reutilizada diretamente para Monitoramento.
* `src/components/GooglePhotosAlbums/ResponsibleGooglePhotosGallery.tsx`: usa `listGooglePhotosAlbums` com `scope: 'portal'`, mesma regra autorizada do Portal do Responsável.
* `src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx`: usa `scope: 'manage'` e expõe controles administrativos conforme permissões.
* `shared/googlePhotosAlbums.js` e `api/_lib/googlePhotosAlbumsRepository.js`: já existem filtros de visibilidade para portal e para `activeContext === 'monitoring'`, mas o `scope: 'portal'` bloqueava Monitoramento.
* `firestore.rules`: regras locais protegem por proprietário em `users/{userId}` e admin em `accessProfiles`; não há regra local específica para Monitoramento.
* `tests/access-permissions.test.mjs` e `tests/access-auth-flow.test.mjs`: testes existentes afirmavam que Monitoramento era reconhecido sem abrir cadastro público nem painel interno; precisarão ser atualizados para a nova fase.

Arquitetura encontrada:

* cadastro público: `AccessPortal.tsx` chama `submitAccessRequest` em `src/lib/accessApi.ts`, que chama `api/access.js` com `action: 'requestAccess'`.
* seleção de perfil: `AccessPortal.tsx`, tipo `AccessRequestRole` e validação `validateRequest` em `api/access.js`.
* coleções de solicitação: `accessRequests` guarda `uid`, `email`, `displayName`, `phone`, `role`, `linkedPatientName`, `notes`, `status` e datas/revisor; `accessApprovals` guarda aprovação por hash de e-mail; `accessProfiles` guarda perfil efetivo por UID.
* fluxo atual: criar solicitação pendente; listar solicitações; aprovar/rejeitar; revogar; vincular atendente a responsável. Suspensão e validade já existem no contrato de perfil (`suspension`, `temporaryAccess`) mas sem interface completa neste painel.
* permissões: Admin tem quase tudo; Profissional escreve nas áreas de clínica; Responsável acessa portal próprio; Monitoramento já é somente leitura no contrato e tem bloqueios absolutos de escrita.
* vínculo profissional-atendente: dados clínicos ficam sob `users/{ownerUserId}`; o identificador interno do profissional principal é o UID resolvido via `getAuth().getUserByEmail('fdenarde@gmail.com')`.
* origem Dashboard/Agenda atuais: listeners globais no `App.tsx` para subcoleções do usuário logado.
* origem Galeria: Google Photos API local, com pacotes por `users/{ownerUserId}/googlePhotosAlbumPackages`; autorização do responsável por `scope: 'portal'` e `visibleToGuardian/status`.
* botão Google Fotos atual: link/âncora "Abrir Atividade" no portal e "Abrir álbum" na área profissional.
* risco de leituras excessivas: reutilizar listeners globais do `App.tsx` para Monitoramento carregaria coleções completas e o workspace errado. A solução precisa usar endpoint sanitizado, intervalo de semana para agenda, lista de atendentes do workspace principal e galeria por paciente/pacote.
* riscos de regressão: alterar `AccessRequestRole`, `canAccessInternalSystem`, Google Photos scope e testes de acesso pode afetar login/cadastro/portal se não houver testes focados.

## 6. Decisões técnicas adotadas

* Criar este checkpoint antes das alterações funcionais.
* Preservar alterações preexistentes fora do escopo.
* Não executar scripts de WhatsApp, deploy, publicação de rules, PM2 ou escrita em Firebase real.
* Implementar Monitoramento por endpoint/API sanitizado no workspace do administrador principal, em vez de ativar os listeners globais do sistema interno para o usuário de Monitoramento.
* Reutilizar autorização da Galeria do Responsável via `scope: 'portal'` para Monitoramento, ajustando somente o bloqueio que impedia esse perfil de usar o mesmo escopo de visualização.

## Continuação — Controles administrativos

Retomada em 2026-06-21 15:39:59 -03:00.

Objetivo desta continuação:

* concluir suspensão administrativa;
* concluir validade opcional;
* implementar solicitação e resposta de informações adicionais;
* revisar a consulta de até 2.000 sessões do resumo do Monitoramento;
* atualizar testes e validação local;
* manter este checkpoint sincronizado com `D:\Downloads\CHECKPOINT_CONTINUIDADE_MONITORAMENTO.md`.

Estado encontrado na retomada:

* branch atual: `main`;
* commit HEAD: `6d458f60128bbe2d1eeff52c201b51136584cf57`;
* status Git:
  * `M ../.gitignore` preexistente;
  * arquivos modificados da etapa Monitoramento anterior em `api`, `shared`, `src` e `tests`;
  * `?? docs/CHECKPOINT_CONTINUIDADE_MONITORAMENTO.md`;
  * `?? shared/monitoringPanel.js`;
  * `?? src/components/Monitoring/`;
  * `?? tests/monitoring-panel.test.mjs`;
  * `?? logs/audit/`, `?? relatorios/`, `?? ../q` preexistentes.
* diff atual: 11 arquivos rastreados modificados, 317 inserções e 17 remoções, além dos novos arquivos não rastreados da etapa anterior.
* divergências encontradas: a seção "Resumo para a próxima sessão" ainda descrevia o estado inicial antigo como se nenhum arquivo funcional tivesse sido modificado; será corrigida nesta retomada.

## Modelagem de suspensão

Implementada nesta continuação.

Decisão adotada:

* suspensão é reversível e não altera `status` para `revoked`;
* o acesso continua com `status: approved`, mas recebe `suspension.active = true`;
* o bloqueio é aplicado no backend por `buildEffectiveAccessContext`/`assertProfileAvailability`;
* campos registrados quando acionado pelo administrador:
  * `suspendedAt`;
  * `suspendedBy`;
  * `suspendedByEmail`;
  * `suspensionReason`;
  * `suspension.active`;
  * `suspension.startedAt`;
  * `suspension.reason`.
* reativação registra:
  * `reactivatedAt`;
  * `reactivatedBy`;
  * `reactivatedByEmail`;
  * `suspension.active = false`.
* a reativação não remove revogação e não ignora validade expirada; se o acesso também estiver expirado, permanece bloqueado até renovação/removal da validade.

## Modelagem de validade

Implementada nesta continuação.

Decisão adotada:

* campo principal: `expiresAt`;
* compatibilidade com o modelo existente: `temporaryAccess.endsAt` é espelhado com o mesmo valor;
* ausência de `expiresAt` ou valor nulo significa "Sem prazo";
* a interface administrativa usa data `AAAA-MM-DD`;
* a API transforma a data escolhida no fim do dia em `America/Sao_Paulo`, usando `03:00:00.000Z` do dia seguinte, evitando expirar no início da data exibida;
* expiração é calculada em leitura, sem cron, sem rotina agendada e sem gravação periódica;
* mensagem para Monitoramento expirado: "Seu acesso ao Monitoramento expirou. Entre em contato com o administrador."

## Fluxo de informações adicionais

Implementado nesta continuação.

Decisão adotada:

* novo estado mínimo: `information_requested`, porque os estados existentes não representavam "aguardando resposta do solicitante";
* o estado não concede acesso, pois `buildEffectiveAccessContext` exige `status === 'approved'`;
* administrador usa ação `requestAdditionalInformation`;
* campos registrados:
  * `informationRequestMessage`;
  * `informationRequestedAt`;
  * `informationRequestedBy`;
  * `informationRequestedByEmail`;
  * `informationResponseMessage`;
  * `informationRespondedAt`;
  * `informationHistory` limitado por uso operacional.
* solicitante responde via `respondAdditionalInformation`;
* resposta exige UID/e-mail do proprietário da solicitação;
* resposta retorna a solicitação para `pending`, sem liberar acesso;
* conteúdo é renderizado como texto/textarea, sem HTML.

## Revisão da consulta de sessões

Revisada nesta continuação.

Consulta atual:

* arquivo: `api/access.js`;
* função: `getMonitoringPanelData`;
* resumo: `sessionsRef.limit(2000).get()`;
* agenda semanal: `where('date', '>=', weekRange.start).where('date', '<=', weekRange.end).orderBy('date').limit(250)`;
* motivo técnico: o modelo atual não possui campo/índice confiável de profissional por sessão ou por atendente que permita filtrar diretamente por Fábio Denarde sem migração;
* frequência: uma chamada ao abrir a área de Monitoramento;
* cache: adicionado cache curto no cliente em `src/lib/accessApi.ts` com `MONITORING_PANEL_CACHE_MS = 60 * 1000` e deduplicação por `monitoringPanelRequests`;
* troca de abas: não dispara nova leitura, pois `MonitoringPanel` mantém os dados em estado local.

Decisão:

* manter temporariamente a consulta única limitada a 2.000 sessões;
* não substituir por N+1 por atendente;
* não criar listener global;
* não criar migração ou agregação automática nesta sessão;
* documentar migração futura para reduzir leituras com índice/filtro de profissional.

## Otimizações de leituras aplicadas

* Cache curto e deduplicação de requisições em `getMonitoringPanelData`.
* Alternância entre abas do Monitoramento usa o mesmo estado carregado.
* Agenda continua usando consulta por intervalo da semana atual.
* Não foi introduzido listener Firestore global.
* Não foi introduzido padrão N+1 para sessões.

## Limitações que exigem migração futura

Migração futura recomendada:

* adicionar campo `professionalOwnerId` ou `responsibleProfessionalId` nos documentos de `patients` e/ou `sessions`;
* preencher historicamente com o UID do profissional responsável, começando pelo UID resolvido de `fdenarde@gmail.com`;
* criar índice Firestore para `sessions` por `professionalOwnerId` e, quando necessário, `date`;
* validar a migração primeiro em emulador/fixture exportada, nunca direto em dados reais;
* manter script reversível que remova o campo criado em caso de rollback;
* após a migração, substituir a leitura `limit(2000)` por consulta filtrada por profissional e/ou período conforme a tela.

## Novos testes

Criado `tests/access-admin-controls.test.mjs`, cobrindo:

* estado `information_requested`;
* suspensão bloqueando acesso;
* reativação removendo apenas suspensão;
* validade ausente/futura/vencida;
* mensagem de expiração do Monitoramento;
* ações administrativas exclusivas;
* resposta do solicitante com validação de proprietário;
* rejeição de mensagens vazias e datas inválidas;
* interface pública sem HTML;
* interface administrativa com ações e histórico;
* cache curto do Monitoramento;
* consulta limitada sem listener global e sem N+1.

## Resultado da validação local

Validação desta continuação:

* `npm run lint`: aprovado.
* `node --test tests/access-permissions.test.mjs tests/access-auth-flow.test.mjs tests/monitoring-panel.test.mjs tests/access-admin-controls.test.mjs`: 33 pass, 0 fail.
* `npm run test:responsible-portal`: 20 pass, 0 fail.
* `npm run test:activity-gallery`: 35 pass, 0 fail.
* `npm run test:google-photos-albums`: 28 pass, 0 fail.
* `npm run build`: aprovado.
* `git diff --check`: aprovado, apenas avisos LF/CRLF do Git no Windows.

Falha investigada:

* a primeira execução dos testes focados falhou porque o teste de `onSnapshot` varria `api/access.js` inteiro; a verificação foi corrigida para limitar o escopo à função `getMonitoringPanelData`, que é o comportamento relevante.

Checagens finais:

* status final mantém alterações preexistentes: `../.gitignore`, `logs/audit/`, `relatorios/`, `../q`.
* busca simples por credenciais nos diffs sensíveis encontrou apenas variáveis `decodedToken`, sem valores secretos.
* nenhum commit, push, deploy, publicação de rules, WhatsApp ou PM2 executado.

## Acabamento visual dos controles administrativos

Retomada em 2026-06-21 16:31:19 -03:00.

Objetivo desta etapa:

* realizar exclusivamente o acabamento visual e a validação final da interface do perfil Monitoramento;
* substituir os `window.prompt` usados nos controles administrativos por modais dedicados, responsivos e consistentes com o sistema;
* manter a arquitetura funcional já aprovada;
* não realizar migração de dados;
* não modificar a consulta `sessions limit(2000)`, salvo regressão comprovada.

Estado encontrado na retomada:

* branch atual: `main`;
* commit HEAD: `6d458f60128bbe2d1eeff52c201b51136584cf57`;
* status Git:
  * `M ../.gitignore` preexistente;
  * arquivos modificados da implementação de Monitoramento em `api`, `shared`, `src` e `tests`;
  * `?? docs/CHECKPOINT_CONTINUIDADE_MONITORAMENTO.md`;
  * `?? shared/monitoringPanel.js`;
  * `?? src/components/Monitoring/`;
  * `?? tests/access-admin-controls.test.mjs`;
  * `?? tests/monitoring-panel.test.mjs`;
  * `?? logs/audit/`, `?? relatorios/`, `?? ../q` preexistentes.
* diff atual: 11 arquivos rastreados modificados, 1078 inserções e 38 remoções, além dos arquivos não rastreados da etapa Monitoramento.
* divergências encontradas: nenhuma divergência operacional em relação ao checkpoint anterior; o item pendente "prompts para modais" corresponde ao objetivo desta etapa.

Auditoria inicial de interações nativas:

* `src/components/Auth/AccessRequestsAdminCard.tsx`, função `review`: `window.prompt` para validade opcional ao aprovar acesso Monitoramento.
* `src/components/Auth/AccessRequestsAdminCard.tsx`, função `requestMoreInformation`: `window.prompt` para mensagem de informações adicionais.
* `src/components/Auth/AccessRequestsAdminCard.tsx`, função `suspend`: `window.confirm` para suspensão e `window.prompt` para motivo opcional.
* `src/components/Auth/AccessRequestsAdminCard.tsx`, função `changeValidity`: `window.prompt` para alteração/remoção de validade.
* `src/components/Auth/AccessRequestsAdminCard.tsx`, função `revoke`: `window.confirm` para revogação; mantido temporariamente como confirmação existente fora do objetivo principal dos prompts administrativos de Monitoramento, a ser reavaliado na revisão final.
* interações nativas localizadas em `Dashboard`, `Agenda`, `App`, `Patients`, `Finance`, `GooglePhotosAlbums`, `ActivityRecords`, `PersonalAgenda` e `Notifications` foram consideradas fora do escopo desta etapa.

Padrão visual encontrado:

* componente reutilizável: `src/components/Common/Modal.tsx`;
* sistema de mensagens: `src/components/Common/Toast.tsx`;
* campos já usam classes `clinic-input`, `textarea` e `input type="date"` em formulários existentes;
* decisão: reutilizar `Modal` e `showToast`, criando somente um componente específico pequeno para as ações administrativas de acesso se necessário.

## Interações nativas substituídas

Atualizado em 2026-06-21 16:37:58 -03:00.

Substituições realizadas no fluxo administrativo de acesso:

* `src/components/Auth/AccessRequestsAdminCard.tsx`, aprovação de Monitoramento: removido `window.prompt` da validade opcional; adotado modal "Definir validade" com opções "Sem prazo" e "Válido até uma data".
* `src/components/Auth/AccessRequestsAdminCard.tsx`, solicitação de informações adicionais: removido `window.prompt`; adotado modal "Solicitar mais informações" com textarea obrigatório e contador `0/1200`.
* `src/components/Auth/AccessRequestsAdminCard.tsx`, suspensão: removidos `window.confirm` e `window.prompt`; adotado modal "Suspender acesso" com motivo opcional, contador `0/500` e ação visualmente bloqueadora.
* `src/components/Auth/AccessRequestsAdminCard.tsx`, reativação: adotado modal "Reativar acesso" com explicação de que validade e revogação continuam sendo verificadas.
* `src/components/Auth/AccessRequestsAdminCard.tsx`, validade: removido `window.prompt`; adotado modal "Definir validade", "Alterar validade" ou "Renovar acesso", conforme estado.
* `src/components/Auth/AccessRequestsAdminCard.tsx`, revogação: substituído `window.confirm` por modal "Revogar acesso", preservando a mensagem de risco e sem permitir reativação acidental.

Busca final:

* comando: `rg -n "window\.prompt|\bprompt\(|window\.confirm|\bconfirm\(|window\.alert|\balert\(" src\components\Auth\AccessRequestsAdminCard.tsx src\components\Auth\AccessPortal.tsx src\components\Common\Modal.tsx`
* resultado: nenhum uso encontrado nesses arquivos.
* confirmações nativas em `Dashboard`, `Agenda`, `App`, `Patients`, `Finance`, `GooglePhotosAlbums`, `ActivityRecords`, `PersonalAgenda` e `Notifications` permanecem fora do escopo desta etapa.

## Modais implementados ou reutilizados

Reutilizado:

* `src/components/Common/Modal.tsx`.

Ajustes no modal comum:

* `role="dialog"`;
* `aria-modal="true"`;
* `aria-labelledby` vinculado ao título;
* foco inicial por `initialFocusRef`;
* restauração de foco ao fechar;
* fechamento por Escape quando não há envio em andamento;
* bloqueio de fechar por Escape/backdrop/botão X durante envio por `closeDisabled`;
* conteúdo continua rolável por `max-h` e `overflow-y-auto` existentes.

Modais no card administrativo:

* "Suspender acesso": motivo opcional, limite 500, trim/normalização antes do envio, erro no modal, botão bloqueado durante envio.
* "Reativar acesso": confirmação visual, loading e mensagem sobre validade/revogação.
* "Definir validade" / "Alterar validade" / "Renovar acesso": opções "Sem prazo" e "Válido até uma data", campo `type="date"`, validação local de `AAAA-MM-DD`, pré-preenchimento quando há validade, remoção do prazo ao escolher "Sem prazo".
* "Solicitar mais informações": textarea obrigatório, limite 1200, validação de espaços, erro no modal e atualização do card após sucesso.
* "Revogar acesso": confirmação visual em modal, sem conceder acesso nem reativar revogados.

Não foi criada biblioteca nova de modal.

## Estados visuais revisados

Estados revisados em `src/components/Auth/AccessRequestsAdminCard.tsx`:

* Pendente: exibe Aprovar, Rejeitar e Solicitar mais informações.
* Aguardando informações: exibe pergunta, data e indicação de que aguarda resposta; não exibe aprovação enquanto a resposta não volta para `pending`.
* Resposta recebida e pendente: após resposta do solicitante, volta a `pending` e exibe pergunta/resposta no card, com Aprovar, Rejeitar e Solicitar mais informações.
* Ativo sem prazo: status ativo, "Sem prazo", Suspender acesso, Revogar acesso e Definir validade.
* Ativo com validade futura: status ativo, "Válido até DD/MM/AAAA", Suspender acesso, Revogar acesso e Alterar validade.
* Suspenso: status Suspenso, motivo quando informado, Reativar acesso, Revogar acesso e validade atual.
* Expirado: status Expirado, "Expirado em DD/MM/AAAA", botão Renovar acesso e possibilidade de remover validade escolhendo "Sem prazo".
* Revogado/desativado/cancelado: status Revogado e histórico; sem reativação acidental.
* Rejeitado: status Rejeitado; sem ação que conceda acesso.

Área do solicitante em `src/components/Auth/AccessPortal.tsx` revisada:

* pergunta do administrador em destaque;
* data da solicitação quando disponível;
* textarea com limite 1200 e contador;
* botão "Enviar informações para análise" desabilitado para resposta vazia ou envio em andamento;
* mensagem de sucesso após resposta;
* retorno visual para pendente com pergunta e resposta preservadas;
* nenhuma liberação automática de acesso.

## Acessibilidade e responsividade

Aplicado:

* título associado ao diálogo por `aria-labelledby`;
* campos dentro de `label`;
* foco inicial no campo ou botão mais relevante;
* retorno de foco ao elemento anterior ao fechar;
* fechamento por botão Cancelar;
* Escape habilitado quando não há envio em andamento;
* fechamento acidental bloqueado durante envio;
* modal preserva layout mobile com `items-end`, largura cheia e altura máxima rolável;
* botões usam `disabled` e estados visuais;
* erros internos usam `role="alert"`;
* textos de pergunta/resposta usam JSX textual e `whitespace-pre-wrap`, sem HTML.

## Validação visual executada

Não houve execução visual real em navegador com dados ou ações administrativas.

Validação segura executada:

* auditoria estrutural do JSX dos modais;
* verificação de responsividade por classes existentes (`max-h`, `overflow-y-auto`, `flex-col-reverse`, `sm:flex-row`, `w-full`, `max-w-lg`);
* verificação de acessibilidade por código fonte;
* testes estruturais sem chamar API real;
* build Vite de produção.

## Limitações da validação visual

Limitações:

* não há Storybook, Playwright, Cypress, Vitest/jsdom ou harness de componente com mocks para abrir todos os estados visualmente sem risco de dados reais;
* não foi iniciado servidor local nem feito teste com usuários reais;
* não foram disparadas ações administrativas reais de suspensão, validade, aprovação, revogação ou informações adicionais.

Lista objetiva para conferência manual futura em ambiente seguro:

* abrir um card pendente de Monitoramento e conferir modal "Definir validade";
* conferir modal "Solicitar mais informações" com textarea vazio e com envio;
* conferir modal "Suspender acesso" com e sem motivo;
* conferir modal "Reativar acesso" em conta suspensa;
* conferir modal "Renovar acesso" em conta expirada;
* conferir responsividade em largura mobile/tablet/desktop;
* conferir retorno de foco e Escape sem envio em andamento.

## Testes adicionais

Atualizado `tests/access-admin-controls.test.mjs` com cobertura estrutural para:

* ausência de `window.prompt`, `prompt`, `window.confirm`, `confirm`, `window.alert` e `alert` no fluxo administrativo ajustado;
* uso de `Modal` no card administrativo;
* ações `approveMonitoring`, `requestInformation`, `suspend`, `reactivate`, `validity` e `revoke`;
* limites 500 e 1200;
* data `type="date"`;
* opções "Sem prazo" e "Válido até uma data";
* prevenção de duplo envio por `actionSubmittingRef`;
* erro local para mensagem vazia e data inválida;
* semântica acessível no modal comum.

## Resultado final antes do commit

Validação desta etapa:

* `npm run lint`: aprovado, TypeScript sem erros.
* `node --test tests/access-permissions.test.mjs tests/access-auth-flow.test.mjs tests/monitoring-panel.test.mjs tests/access-admin-controls.test.mjs`: 36 pass, 0 fail.
* `npm run test:responsible-portal`: 20 pass, 0 fail.
* `npm run test:activity-gallery`: 35 pass, 0 fail.
* `npm run test:google-photos-albums`: 28 pass, 0 fail.
* `npm run build`: aprovado, 3231 módulos transformados.
* `git diff --check`: aprovado; apenas avisos LF/CRLF do Git no Windows.

Revisão de segurança:

* regras de backend não foram alteradas nesta etapa;
* nenhum parâmetro extra foi adicionado às APIs;
* mensagens continuam renderizadas como texto, sem `dangerouslySetInnerHTML`;
* busca simples por credenciais no diff desta etapa não encontrou chaves, tokens ou segredos;
* nenhum listener ou leitura Firebase foi adicionado;
* `sessionsRef.limit(2000).get()` permaneceu inalterado e documentado como migração futura;
* nenhum dado real foi criado, modificado ou excluído;
* nenhum commit, push, deploy, publicação de rules, WhatsApp ou PM2 foi executado.

## Validação visual local segura

Retomada em 2026-06-21 17:03:56 -03:00.

Objetivo desta etapa:

* criar uma prévia local temporária, exclusivamente de desenvolvimento, usando mocks e dados fictícios;
* permitir conferir visualmente os nove estados administrativos do Monitoramento e os modais concluídos;
* não consultar Firebase, Auth, Storage, Firestore ou APIs reais;
* não alterar arquitetura funcional aprovada;
* não executar commit, push, deploy, publicação de rules, WhatsApp ou PM2.

Estado encontrado:

* branch atual: `main`;
* commit HEAD: `6d458f60128bbe2d1eeff52c201b51136584cf57`;
* status Git:
  * `M ../.gitignore` preexistente;
  * alterações das etapas anteriores em `api`, `shared`, `src` e `tests`;
  * `?? docs/CHECKPOINT_CONTINUIDADE_MONITORAMENTO.md`;
  * `?? shared/monitoringPanel.js`;
  * `?? src/components/Monitoring/`;
  * `?? tests/access-admin-controls.test.mjs`;
  * `?? tests/monitoring-panel.test.mjs`;
  * `?? logs/audit/`, `?? relatorios/`, `?? ../q` preexistentes.
* diff atual antes desta etapa: 12 arquivos rastreados modificados, 1414 inserções e 56 remoções, além dos arquivos não rastreados já documentados.
* divergências encontradas: as seções antigas "Implementações parcialmente concluídas" e "Próximo passo exato" ainda contêm texto histórico sobre prompts; isso já foi superado pelas seções mais recentes e será preservado como histórico, com a nova etapa documentada abaixo.

Estratégia planejada:

* reutilizar `src/components/Auth/AccessRequestsAdminCard.tsx`;
* adicionar pontos de injeção opcionais para dados/callbacks mockados, sem alterar o comportamento normal;
* criar uma página temporária local em `src/components/Monitoring/MonitoringUiPreview.tsx`;
* expor a página somente quando `import.meta.env.DEV` e `VITE_MONITORING_UI_PREVIEW === 'true'`;
* incluir marcador exclusivo `MONITORING_UI_PREVIEW_LOCAL_ONLY` e verificar que ele não aparece no build de produção.

Estado dos créditos do Codex:

* informado pelo usuário: aproximadamente 23% no início desta etapa;
* prioridade: mudanças pequenas, documentação contínua e regressão essencial.

## Estratégia da prévia

Atualizado em 2026-06-21 17:08:26 -03:00.

Implementado:

* rota local: `/dev/monitoring-ui-preview`;
* arquivo temporário da prévia: `src/components/Monitoring/MonitoringUiPreview.tsx`;
* checklist manual: `docs/VALIDACAO_VISUAL_MONITORAMENTO.md`;
* reutilização do card real `AccessRequestsAdminCard`;
* injeção opcional de mocks via props no card:
  * `previewRequests`;
  * `previewActiveTab`;
  * `onPreviewAction`.

Decisão técnica:

* a interface normal continua usando `listAccessRequests`, `reviewAccessRequest`, `suspendAccessRequest`, `updateAccessValidity`, `revokeAccessRequest` etc.;
* a prévia passa `onPreviewAction`, que intercepta todas as ações e retorna dados fictícios após `setTimeout`;
* em modo de erro simulado, `onPreviewAction` lança erro local e mantém o modal aberto;
* em modo de sucesso simulado, retorna um `AccessRequestRecord` fictício atualizado e o modal fecha.

## Proteções contra produção

Proteções implementadas:

* `MONITORING_UI_PREVIEW_ENABLED = import.meta.env.DEV && import.meta.env.VITE_MONITORING_UI_PREVIEW === 'true'`;
* componente carregado via importação dinâmica somente quando a proteção acima é verdadeira;
* rota `/dev/monitoring-ui-preview` mostra bloqueio simples quando a variável não está ativa;
* marcador textual: `MONITORING_UI_PREVIEW_LOCAL_ONLY`;
* próxima validação obrigatória: build de produção sem variável e busca do marcador em `dist`.

## Estados disponíveis

A prévia local permite alternar:

1. Pendente.
2. Aguardando informações.
3. Resposta recebida e novamente pendente.
4. Ativo sem prazo.
5. Ativo com validade futura.
6. Suspenso.
7. Expirado.
8. Revogado.
9. Rejeitado.

## Modais disponíveis

Modais conferíveis pela prévia:

* Suspender acesso.
* Reativar acesso.
* Definir validade.
* Alterar validade.
* Renovar acesso.
* Solicitar mais informações.
* Revogar acesso.

## Dados fictícios utilizados

Dados fictícios usados:

* Marina Exemplo;
* Carlos Demonstracao;
* `usuario.teste@example.invalid`;
* `admin.teste@example.invalid`;
* telefone `27999990000`;
* IDs `mock-monitoring-*`;
* textos com tags HTML fictícias para confirmar renderização como texto.

Não foram usados nomes, telefones, e-mails, mídias ou links reais.

## Verificação de ausência de Firebase/API

Implementação:

* `MonitoringUiPreview.tsx` não importa Firebase, Auth, Firestore, Storage ou `accessApi`;
* ações simuladas usam apenas `onPreviewAction`, `setTimeout` e objetos locais;
* `AccessRequestsAdminCard.tsx` usa APIs reais somente quando `onPreviewAction` não é fornecido;
* testes estruturais verificam que a prévia usa dados fictícios e não contém imports/chamadas diretas de APIs reais.

Validação executada:

* `npm run lint`: aprovado.
* `node --test tests/access-permissions.test.mjs tests/access-auth-flow.test.mjs tests/monitoring-panel.test.mjs tests/access-admin-controls.test.mjs`: 38 pass, 0 fail.

## Verificação do build de produção

Atualizado em 2026-06-21 17:11:36 -03:00.

Build executado sem `VITE_MONITORING_UI_PREVIEW`:

* comando: `Remove-Item Env:VITE_MONITORING_UI_PREVIEW -ErrorAction SilentlyContinue; npm run build`;
* resultado: aprovado;
* módulos transformados: 3232.

Busca em `dist`:

* comando: `rg -n "MONITORING_UI_PREVIEW_LOCAL_ONLY" dist`;
* resultado: `MARKER_NOT_FOUND_IN_DIST`.
* comando: `rg -n "MonitoringUiPreview|monitoring-ui-preview|VITE_MONITORING_UI_PREVIEW" dist`;
* resultado: `PREVIEW_ROUTE_NOT_FOUND_IN_DIST`.

Correção aplicada durante esta verificação:

* a primeira estratégia deixava a string da rota bloqueada no bundle de produção;
* `src/App.tsx` foi ajustado para avaliar `/dev/monitoring-ui-preview` somente dentro do ramo `MONITORING_UI_PREVIEW_ENABLED && MonitoringUiPreview`;
* após novo build, marcador, rota, nome do componente e nome da variável não aparecem em `dist`.

## URL local da prévia

Servidor local iniciado:

* comando seguro usado: `VITE_MONITORING_UI_PREVIEW=true npm run dev:frontend`;
* processo: PowerShell PID `12100`;
* verificação HTTP: `http://localhost:3000/dev/monitoring-ui-preview` respondeu `200`;
* URL para conferência manual: `http://localhost:3000/dev/monitoring-ui-preview`.

No PowerShell, comando equivalente para reiniciar se necessário:

* `$env:VITE_MONITORING_UI_PREVIEW='true'; npm run dev:frontend`

Somente o frontend local foi iniciado. Não foram iniciados WhatsApp, PM2, backend extra, emuladores ou rotinas de dados.

## Checklist manual

Checklist criado em:

* `docs/VALIDACAO_VISUAL_MONITORAMENTO.md`.

Resumo dos itens:

* estado selecionado;
* modal aberto;
* desktop aprovado;
* tablet aprovado;
* celular aprovado;
* foco aprovado;
* Escape aprovado;
* carregamento aprovado;
* erro simulado aprovado;
* sucesso simulado aprovado;
* observações.

## Arquivos temporários

Criados nesta etapa:

* `src/components/Monitoring/MonitoringUiPreview.tsx`;
* `docs/VALIDACAO_VISUAL_MONITORAMENTO.md`.

Modificados nesta etapa:

* `src/App.tsx`;
* `src/components/Auth/AccessRequestsAdminCard.tsx`;
* `tests/access-admin-controls.test.mjs`;
* `docs/CHECKPOINT_CONTINUIDADE_MONITORAMENTO.md`.

## Procedimento para remoção da prévia

Não remover nesta etapa.

Quando o usuário concluir a validação manual:

1. remover `src/components/Monitoring/MonitoringUiPreview.tsx`;
2. remover a rota `/dev/monitoring-ui-preview` e a constante `MONITORING_UI_PREVIEW_ENABLED` de `src/App.tsx`;
3. avaliar se os props de preview em `AccessRequestsAdminCard.tsx` devem ser removidos ou preservados para testes;
4. remover `docs/VALIDACAO_VISUAL_MONITORAMENTO.md`;
5. executar regressão completa;
6. verificar novamente que nenhum marcador da prévia aparece no build.

## Resultado antes do commit

Validação completa desta etapa:

* `npm run lint`: aprovado.
* `node --test tests/access-permissions.test.mjs tests/access-auth-flow.test.mjs tests/monitoring-panel.test.mjs tests/access-admin-controls.test.mjs`: 38 pass, 0 fail.
* `npm run test:responsible-portal`: 20 pass, 0 fail.
* `npm run test:activity-gallery`: 35 pass, 0 fail.
* `npm run test:google-photos-albums`: 28 pass, 0 fail.
* `npm run build`: aprovado.
* `rg -n "MONITORING_UI_PREVIEW_LOCAL_ONLY" dist`: marcador ausente.
* `rg -n "MonitoringUiPreview|monitoring-ui-preview|VITE_MONITORING_UI_PREVIEW" dist`: rota/componente/variável ausentes.
* `git diff --check`: aprovado; apenas avisos LF/CRLF do Git no Windows.
* `rg` em `MonitoringUiPreview.tsx` para Firebase/API/Auth/Firestore/Storage/accessApi: nenhum uso proibido encontrado.
* busca simples por padrões de credenciais no diff da prévia: nenhum padrão encontrado.

## Estado dos créditos do Codex

* informado no pedido: aproximadamente 23% no início;
* estado final estimado: reduzido, mas etapa concluída e checkpoint atualizado;
* risco de interrupção mitigado por documentação de retomada, URL, PID local e comandos.

## Procedimento de retomada por limite de créditos

Se a próxima sessão precisar continuar:

1. conferir `git status --short`;
2. abrir `docs/CHECKPOINT_CONTINUIDADE_MONITORAMENTO.md`;
3. se o servidor local não estiver ativo, executar `$env:VITE_MONITORING_UI_PREVIEW='true'; npm run dev:frontend`;
4. abrir `http://localhost:3000/dev/monitoring-ui-preview`;
5. usar `docs/VALIDACAO_VISUAL_MONITORAMENTO.md` para marcar a conferência manual;
6. não executar commit/push/deploy;
7. depois da validação do usuário, remover a prévia temporária conforme a seção de remoção.

## 7. Arquivos criados

* caminho: `docs/CHECKPOINT_CONTINUIDADE_MONITORAMENTO.md`
  * finalidade: registrar continuidade, auditoria, decisões, testes e próximo passo.
  * estado atual: atualizado com auditoria, implementação parcial e testes focados.
* caminho: `shared/monitoringPanel.js`
  * finalidade: centralizar cálculos/filtros puros do Monitoramento, incluindo "Andamento do acompanhamento" e intervalo da semana atual.
  * estado atual: criado e coberto por testes.
* caminho: `src/components/Monitoring/MonitoringPanel.tsx`
  * finalidade: painel somente leitura do perfil Monitoramento com Dashboard, Agenda e Galeria de Atividades.
  * estado atual: criado e validado por TypeScript.
* caminho: `tests/monitoring-panel.test.mjs`
  * finalidade: cobrir cálculo do andamento, divisão por zero, filtros, semana atual e reutilização do escopo portal da galeria.
  * estado atual: criado e executado com sucesso.
* caminho: `tests/access-admin-controls.test.mjs`
  * finalidade: cobrir suspensão, validade, informações adicionais, cache e consulta limitada do Monitoramento.
  * estado atual: criado e executado com sucesso.

## 8. Arquivos modificados

* caminho: `src/types/access.ts`
  * alteração realizada: `AccessRequestRole` agora permite `monitoring`; adicionados tipos sanitizados de `MonitoringPanelData`; adicionados campos de suspensão, validade e informações adicionais.
  * motivo: permitir cadastro público do perfil Monitoramento e contrato de dados do painel.
  * estado atual: TypeScript aprovado.
* caminho: `src/components/Auth/AccessPortal.tsx`
  * alteração realizada: opção "Monitoramento" adicionada ao cadastro público; mensagem de perfil aprovado atualizada; solicitante pode responder informações adicionais.
  * motivo: cadastro público do novo perfil.
  * estado atual: TypeScript aprovado.
* caminho: `src/lib/accessApi.ts`
  * alteração realizada: adicionada função `getMonitoringPanelData`, cache curto/deduplicação, e clientes para suspensão, reativação, validade e informações adicionais.
  * motivo: cliente do endpoint sanitizado de Monitoramento.
  * estado atual: TypeScript aprovado.
* caminho: `api/access.js`
  * alteração realizada: `ACCESS_ROLES` inclui `monitoring`; novo modo `monitoringPanel`; bloqueio de nova solicitação para perfis `disabled`, `revoked` ou `information_requested`; ações administrativas de suspensão, reativação, validade e informações adicionais; serialização sanitizada de pacientes/sessões; consulta da agenda por intervalo da semana atual.
  * motivo: autorização, leitura segura e proteção contra reativação por novo login.
  * estado atual: testes focados aprovados.
* caminho: `api/_lib/accessPermissions.js`
  * alteração realizada: `activeContext === 'monitoring'` pode consultar pacientes do workspace autorizado; mantém bloqueios absolutos de escrita; valida `expiresAt` além de `temporaryAccess`.
  * motivo: permitir visualização de atendentes do workspace principal sem lista manual, preservando somente leitura.
  * estado atual: testes de permissões aprovados.
* caminho: `shared/googlePhotosAlbums.js`
  * alteração realizada: `scope: 'portal'` permite `monitoring` em `canView`.
  * motivo: reutilizar a mesma regra do Portal do Responsável para mídias autorizadas.
  * estado atual: testes focados aprovados.
* caminho: `api/_lib/googlePhotosAlbumsRepository.js`
  * alteração realizada: removido bloqueio que impedia Monitoramento de usar `scope: 'portal'`.
  * motivo: reutilização da autorização do responsável.
  * estado atual: testes focados aprovados.
* caminho: `src/App.tsx`
  * alteração realizada: rota/renderização separada para perfil Monitoramento; aba administrativa "Visão do Monitoramento"; pré-visualização admin sem troca de identidade.
  * motivo: acesso do perfil e visão administrativa controlada.
  * estado atual: TypeScript aprovado.
* caminho: `src/components/Dashboard.tsx`
  * alteração realizada: botão de acesso rápido à "Visão do Monitoramento" para administrador principal.
  * motivo: requisito de acesso rápido no Dashboard administrativo.
  * estado atual: TypeScript aprovado.
* caminho: `src/components/Auth/AccessRequestsAdminCard.tsx`
  * alteração realizada: rótulo "Monitoramento"; ações por estado para solicitar informações, suspender, reativar, definir/alterar/remover validade e revogar; exibição de histórico de pergunta/resposta.
  * motivo: clareza do fluxo administrativo.
  * estado atual: TypeScript aprovado.
* caminho: `tests/access-permissions.test.mjs`
  * alteração realizada: teste atualizado para a nova fase do Monitoramento.
  * motivo: substituir teste de bloqueio antigo por teste positivo do cadastro/painel.
  * estado atual: aprovado.

## 9. Implementações concluídas

* Cadastro público com opção "Monitoramento".
* Solicitação de Monitoramento permanece pendente até aprovação administrativa existente.
* Perfil revogado/desativado não volta a pendente apenas por novo login.
* Endpoint sanitizado `mode=monitoringPanel`.
* Painel Monitoramento somente leitura com abas Dashboard, Agenda e Galeria de Atividades.
* Dashboard com cards de atendente, filtros, detalhes e indicador "Andamento do acompanhamento".
* Tratamento de pacote sem total previsto/divisão por zero no helper testado.
* Agenda somente leitura usando consulta da semana atual por intervalo.
* Galeria reutilizando `ResponsibleGooglePhotosGallery` e `scope: 'portal'`.
* Visão administrativa "Visão do Monitoramento" no menu e botão rápido no Dashboard.
* Aviso fixo e botão "Retornar ao modo Administrador" na pré-visualização.
* Testes focados de permissões, autenticação e Monitoramento.
* Suspensão administrativa reversível.
* Validade opcional por `expiresAt`.
* Fluxo de solicitação e resposta de informações adicionais.
* Cache curto para evitar chamadas duplicadas do resumo de Monitoramento.

## 10. Implementações parcialmente concluídas

* Contagem de atividades: implementada por `count()` em `activityRecords`; validada por build, mas ainda depende da compatibilidade do ambiente Firebase em produção/local.
* A UI administrativa usa `window.prompt` para motivo, validade e informação solicitada. Funcional e validado, mas pode ser refinada futuramente para modais mais ricos.

## 11. Implementações ainda pendentes

* Migração futura para reduzir a consulta ampla de sessões.
* Possível refinamento visual da UI administrativa de prompts para modais dedicados.
* Registros de segurança adicionais além dos campos administrativos gravados.

## 12. Testes executados

* comando: `npm run lint`
  * resultado: aprovado.
  * quantidade de testes: não aplicável; verificação TypeScript `tsc --noEmit`.
  * falhas encontradas: nenhuma.
* comando: `node --test tests/access-permissions.test.mjs tests/access-auth-flow.test.mjs tests/monitoring-panel.test.mjs`
  * resultado: aprovado.
  * quantidade de testes: 23 pass, 0 fail.
  * falhas encontradas: nenhuma.
* comando: `npm run build`
  * resultado: aprovado.
  * quantidade de testes: não aplicável; build Vite concluído.
  * falhas encontradas: nenhuma.
* comando: `npm run test:responsible-portal`
  * resultado: aprovado.
  * quantidade de testes: 20 pass, 0 fail.
  * falhas encontradas: nenhuma.
* comando: `npm run test:activity-gallery`
  * resultado: aprovado.
  * quantidade de testes: 35 pass, 0 fail.
  * falhas encontradas: nenhuma.
* comando: `npm run test:google-photos-albums`
  * resultado: aprovado.
  * quantidade de testes: 28 pass, 0 fail.
  * falhas encontradas: nenhuma.
* comando: `git diff --check`
  * resultado: aprovado.
  * quantidade de testes: não aplicável.
  * falhas encontradas: nenhuma; apenas avisos de LF/CRLF do Git no Windows.
* comando: `node --test tests/access-permissions.test.mjs tests/access-auth-flow.test.mjs tests/monitoring-panel.test.mjs tests/access-admin-controls.test.mjs`
  * resultado: aprovado após ajustar o escopo de um teste.
  * quantidade de testes: 33 pass, 0 fail.
  * falhas encontradas: primeira execução teve 1 falha de teste por regex ampla; corrigida para escopo correto.

## 13. Testes pendentes

* Nenhum teste obrigatório desta continuação ficou pendente dentro do escopo local executável.
* Testes com Firebase real/emulador não foram executados para evitar escrita em dados reais.

## 14. Erros e investigações

Nenhum erro de teste/build encontrado. Investigações/observações:

* `git diff --check` emitiu apenas avisos de conversão LF/CRLF, sem erro de whitespace.
* Busca simples por credenciais em diffs sensíveis encontrou apenas identificadores normais como `decodedToken`, sem chaves privadas, tokens literais ou segredos.

## 15. Consultas Firebase criadas ou modificadas

Consultas criadas/modificadas:

* `accessProfiles/{uid}` via `getProfile` e `buildEffectiveAccessContext` para validar perfil aprovado/suspenso/revogado.
* `users/{primaryAdminUid}/settings/config` para cabeçalho sanitizado do Monitoramento.
* `users/{primaryAdminUid}/patients limit 250` para atendentes do workspace principal.
* `users/{primaryAdminUid}/sessions limit 2000` para resumo de acompanhamento. Risco: ainda é leitura ampla porque o modelo atual não possui campo de profissional por sessão/paciente; documentar migração futura para filtro por profissional/índice.
* `users/{primaryAdminUid}/sessions where date >= weekStart and date <= weekEnd orderBy date limit 250` para Agenda da semana atual.
* `users/{primaryAdminUid}/patients/{patientId}/activityRecords count()` por atendente para quantidade de atividades registradas.
* `googlePhotosAlbumPackages` permanece por `patientId + packageNumber`, agora permitindo `monitoring` em `scope: 'portal'`, mantendo `visibleToGuardian` e `status: active`.
* `getMonitoringPanelData` no cliente agora possui cache curto de 60 segundos e deduplicação por usuário/contexto.

## 16. Segurança e permissões

Proteções implementadas:

* `canAccessInternalSystem` continua limitado a Admin/Profissional; Monitoramento usa renderização separada e não ativa listeners globais.
* `accessPermissions` mantém bloqueios absolutos de escrita para `activeContext === 'monitoring'`.
* Endpoint `monitoringPanel` retorna dados sanitizados, sem anamnese, observações clínicas, laudos, financeiro, pagamentos, valores ou controles de edição.
* Galeria usa escopo de portal/responsável.
* Usuário revogado/desativado não recria acesso por novo cadastro.
* Usuário com solicitação em `information_requested` não consegue apagar a pergunta por reenvio comum de cadastro.
* Somente administrador executa suspensão, reativação, validade e solicitação de informações.
* Somente o UID/e-mail dono da solicitação responde informações adicionais.

## 17. Próximo passo exato

* se houver nova sessão, revisar visualmente em navegador local os prompts administrativos e considerar substituir por modais dedicados;
* planejar migração futura do campo `professionalOwnerId`/`responsibleProfessionalId` para reduzir leituras do resumo;
* não publicar regras nem fazer deploy sem etapa separada de revisão.

## 18. Comandos que NÃO foram executados

* commit;
* push;
* deploy;
* publicação de rules;
* início do WhatsApp;
* alterações no PM2.

## 19. Resumo para a próxima sessão

O trabalho de Monitoramento já possui base funcional implementada e validada: cadastro, painel somente leitura, Dashboard, Agenda semanal, Galeria autorizada e visão administrativa. A retomada atual deve concluir suspensão, validade opcional, solicitação/resposta de informações adicionais e revisar a consulta `sessions limit 2000`. Preservar as alterações preexistentes `../.gitignore`, `logs/audit/`, `relatorios/` e `../q`. Não executar commit, push, deploy, publicação de rules, WhatsApp ou PM2.

---

# Ajustes pós-validação visual — 21/06/2026

## Objetivo desta etapa

Refinar a tela real do Monitoramento após a conferência feita no login administrativo, preservando o modo somente leitura e sem alterar dados reais.

## Ajustes implementados

* Corrigido o filtro do Dashboard que convertia filtros numéricos vazios em zero e podia ocultar todos os atendentes.
* Dashboard reorganizado com o bloco **Progresso dos Atendentes**, barras horizontais e indicador `realizadas/previstas` do pacote atual.
* Adicionado o bloco **Próximas Sessões — Hoje** e a próxima data futura com sessões.
* Cabeçalho atualizado com a logomarca da clínica e o nome completo retornado em `viewer.displayName` para o usuário do Monitoramento.
* Agenda do Monitoramento mantida exclusivamente no modo semanal.
* Opções Mensal e Lista removidas da interface do Monitoramento.
* Agenda semanal reorganizada por data e exibindo somente sessões preenchidas, sem horários vazios.
* Galeria do Monitoramento reorganizada com cabeçalho, busca por nome e cards de seleção de atendentes, preservando o carregamento sob demanda e o escopo autorizado do Portal do Responsável.
* O atendente **Jacinto Melaço (Teste)** é ocultado somente na seleção da Galeria do Monitoramento; nenhum dado foi removido.
* Detalhes do atendente, botão de retorno ao modo Administrador e restrições de somente leitura foram preservados.

## Arquivos modificados nesta etapa

* `shared/monitoringPanel.js`
* `src/components/Monitoring/MonitoringPanel.tsx`
* `tests/monitoring-panel.test.mjs`
* `docs/CHECKPOINT_CONTINUIDADE_MONITORAMENTO.md`

## Testes executados no pacote isolado

* `npm run lint`: aprovado após usar um arquivo de configuração Firebase fictício exclusivamente no ambiente isolado de validação; esse arquivo não integra o pacote de aplicação.
* `node --test tests/access-permissions.test.mjs tests/access-auth-flow.test.mjs tests/monitoring-panel.test.mjs tests/access-admin-controls.test.mjs`: 43 pass, 0 fail.
* `npm run test:responsible-portal`: 20 pass, 0 fail.
* `npm run test:activity-gallery`: 35 pass, 0 fail.
* `npm run test:google-photos-albums`: 27 pass, 1 falha ambiental porque `firestore.rules` não foi incluído no ZIP de análise; a falha ocorreu antes de validar conteúdo de regra e não foi causada pelos arquivos modificados.
* `npm run build`: aprovado, 3232 módulos transformados.
* verificação de whitespace com `git diff --no-index --check`: aprovada nos arquivos modificados.

## Segurança e preservação

* Nenhum dado real foi criado, alterado ou excluído.
* Nenhuma regra Firebase foi publicada.
* Nenhum commit, push ou deploy foi executado.
* WhatsApp e PM2 não foram iniciados ou modificados.
* A consulta existente `sessionsRef.limit(2000).get()` não foi alterada e permanece registrada como migração futura.

## Próximo passo exato

Aplicar o pacote de correção com backup automático, manter `npm run dev` ativo, atualizar o navegador e validar visualmente Dashboard, Agenda e Galeria antes de qualquer commit.

---

# Correção de sincronização da Agenda — 21/06/2026

## Retomada

Retomada em 2026-06-21 20:22:31 -03:00.

Objetivo desta correção:

* corrigir definitivamente a paridade entre a Agenda principal do profissional e a Agenda do Monitoramento;
* garantir que terça-feira e sábado sejam incluídos por sincronização real, sem inserir sessões manualmente;
* aplicar a regra exclusiva de visibilidade de Jacinto Melaço (Teste) somente no Monitoramento;
* corrigir logo oficial, fotos dos atendentes, ampliação de foto, seleção da Galeria e tema verde;
* preservar o ambiente somente leitura e não modificar dados reais.

Problemas visuais relatados:

* logomarca oficial da clínica não apareceu corretamente no cabeçalho do Monitoramento;
* Agenda do Monitoramento exibiu somente quatro sessões e omitiu Alicia em 23/06 às 16:00;
* atendimentos elegíveis de sábado, 27/06, não apareceram;
* Jacinto Melaço (Teste) apareceu em áreas do Monitoramento onde deve ser ocultado;
* cards da Galeria exibiram apenas iniciais, apesar de fotos já cadastradas;
* foto do atendente não podia ser ampliada;
* seleção do atendente e atividades autorizadas precisam permanecer corretas;
* botões "Abrir atividade" ficaram azuis e devem usar o tema verde da área.

Estado encontrado:

* branch atual: `main`;
* commit HEAD: `6d458f60128bbe2d1eeff52c201b51136584cf57`;
* status Git inclui alterações anteriores da Tela de Monitoramento em `api`, `shared`, `src`, `tests` e `docs`;
* arquivos não rastreados incluem `docs/CHECKPOINT_CONTINUIDADE_MONITORAMENTO.md`, `docs/VALIDACAO_VISUAL_MONITORAMENTO.md`, `shared/monitoringPanel.js`, `src/components/Monitoring/`, `tests/access-admin-controls.test.mjs`, `tests/monitoring-panel.test.mjs`;
* alterações preexistentes preservadas: `../.gitignore`, `logs/audit/`, `relatorios/`, `../q`;
* diff rastreado antes desta correção: 12 arquivos modificados, 1472 inserções e 59 remoções;
* observação: o checkpoint possui seção histórica de ajustes pós-validação visual; o trabalho atual será aplicado preservando essas alterações locais.

Regra definitiva de Jacinto nesta etapa:

* Jacinto Melaço (Teste) continua cadastrado e visível nas áreas administrativas;
* nenhuma sessão, paciente, agenda, pagamento ou vínculo real de Jacinto será alterado;
* Jacinto será ocultado exclusivamente em:
  * Agenda do Monitoramento;
  * Próximas Sessões do Monitoramento;
  * Galeria do Monitoramento.

Arquivos a auditar antes de corrigir:

* `src/components/Agenda.tsx`;
* `src/components/Monitoring/MonitoringPanel.tsx`;
* `shared/monitoringPanel.js`;
* `api/access.js`;
* `src/lib/accessApi.ts`;
* `src/components/Common/BrandLogo.tsx`;
* `src/components/GooglePhotosAlbums/ResponsibleGooglePhotosGallery.tsx`;
* `src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx`;
* testes relacionados em `tests/monitoring-panel.test.mjs`, `tests/access-admin-controls.test.mjs`, `tests/access-permissions.test.mjs`.

## Resultado da correção — 2026-06-21 20:32:14 -03:00

### Causa raiz confirmada

* A Agenda principal usa `getSessionsForDate` e calcula atendimentos virtuais a partir de `fixedDay`, `fixedTime`, `doubleSession` e histórico de agenda fixa.
* O endpoint do Monitoramento lia apenas documentos persistidos em `sessions` e ainda tinha uma consulta semanal separada por `where('date')`, deixando de fora horários fixos ainda não materializados.
* Por isso Alicia na terça e atendimentos de sábado podiam aparecer na Agenda principal e sumir do Monitoramento.

### Correções aplicadas

* `shared/monitoringPanel.js`: adicionada fonte semanal única para Monitoramento com sessões persistidas + sessões fixas calculadas, incluindo sábado, sessão dupla, histórico de horário fixo, feriados e tombstones de remoção.
* `api/access.js`: o endpoint `monitoringPanel` agora deriva `sessions` e `weekSessions` da mesma fonte, mantendo `sessionsRef.limit(2000)` e sem listeners, N+1 de sessão ou escrita em dados reais.
* `api/access.js`: fotos dos atendentes do Monitoramento agora recebem URL assinada somente-leitura quando há `photoDriveFileId`, sem abrir permissão de escrita no Drive.
* `shared/monitoringPanel.js` + `MonitoringPanel.tsx`: a exclusão de Jacinto Melaço (Teste) foi centralizada para todas as áreas do Monitoramento (Dashboard, Agenda, Próximas Sessões e Galeria), com suporte a flag booleana antes do fallback textual.
* `src/lib/accessApi.ts`: chave de cache do Monitoramento passou a incluir `weekStart` e `weekEnd`.
* `src/components/Monitoring/MonitoringPanel.tsx`: logo alinhada ao padrão oficial via `settings.name` e `settings.title`; cards da galeria usam `PatientPhoto` com ampliação.
* `src/components/GooglePhotosAlbums/ResponsibleGooglePhotosGallery.tsx`: botão "Abrir Atividade" ajustado para verde.
* `tests/monitoring-panel.test.mjs`: adicionada fixture local da semana `2026-06-21..2026-06-27` com Alicia terça 16:00, Emanuelly/Nicolas quarta, Eliza/Isabelly/Wesley quinta, Celso sexta 14:00/15:00, Luiza sábado 08:00, Jacinto sábado 14:00 oculto e outro profissional preservado.

### Validação executada

* `node --test tests/monitoring-panel.test.mjs`
* `node --test tests/access-admin-controls.test.mjs`
* `node --test tests/access-permissions.test.mjs`
* `npm run lint`
* `npm run build`
* `npm run test:responsible-portal`
* `npm run test:activity-gallery`
* `npm run test:google-photos-albums`
* `npm run test:activity-records`

Observação: `npm test -- --runInBand` não existe neste projeto (`Missing script: "test"`), então foram usados os scripts reais do `package.json` e testes Node focados.

### Restrições mantidas

* Nenhum commit, push, deploy ou alteração de rules foi executado.
* Nenhum PM2, WhatsApp ou envio real foi acionado.
* Nenhuma gravação em pacientes, sessões, pagamentos ou dados reais foi feita; as mudanças ficaram em código, testes e checkpoint.


## Correção pontual da marca no cabeçalho — 2026-06-21

### Causa visual confirmada

* O componente `BrandLogo` usa as variáveis oficiais `--logo-text`, `--logo-subtitle` e `--logo-divider`, configuradas em branco para uso sobre `bg-clinic-header`.
* No Monitoramento, ele estava dentro de um contêiner `bg-white`; por isso apenas o cérebro aparecia e os textos oficiais ficavam invisíveis sobre o fundo branco.

### Ajuste preparado

* O bloco da marca do Monitoramento passou a usar `bg-clinic-header`, seguindo o mesmo contexto visual do cabeçalho/menu administrativo e profissional.
* O `BrandLogo` passou a usar `variant="sidebar"`, com cérebro, divisor, nome e subtítulo no mesmo padrão visual do menu principal.
* Permanecem sendo usados `settings.name`, `settings.title` e `settings.visualTheme`; nenhum texto de marca foi duplicado no JSX.
* Nenhuma lógica de Agenda, Galeria, fotos, Jacinto, autenticação ou Firebase foi alterada nesta correção pontual.

### Validação pendente no repositório real

* `node --test tests/monitoring-panel.test.mjs`
* `npm run lint`
* `npm run build`
* `git diff --check`

Nenhum commit, push, deploy, publicação de rules, PM2 ou WhatsApp foi executado durante a preparação do pacote.

## Unificação do tema verde do Monitoramento — 2026-06-21 21:02:47 -03:00

- Criado tema local monitoring-theme-green.
- O tema local reutiliza a paleta verde health-balance.
- Abas, botões, foco, bordas, ícones e estados selecionados do Monitoramento passam a herdar a paleta verde.
- A logomarca do Monitoramento utiliza o tema health-balance.
- Referências explícitas a azul foram removidas de:
  - MonitoringPanel.tsx;
  - ResponsibleGooglePhotosGallery.tsx.
- A alteração é restrita ao Monitoramento.
- As telas Administrador, Profissional e Portal do Responsável não foram alteradas globalmente.
- Backup: $backup.
- Nenhum dado real foi modificado.
- Nenhum commit, push, deploy, Firebase Rules, WhatsApp ou PM2 foi executado.

## Tema verde no portal público e opção Monitoramento — 2026-06-21

- A tela pública de login, recuperação e solicitação de acesso passou a aplicar explicitamente o tema `health-balance`, igual à identidade verde aprovada para Administrador, Profissional e Monitoramento.
- Removida a aplicação forçada do tema azul `calm-tech` no `AccessPortal`.
- Confirmada no formulário público a opção `Monitoramento` ao lado de `Profissional` e `Responsável`.
- Mantida a criação da solicitação de Monitoramento como pendente de aprovação administrativa.
- Adicionada regressão estrutural para impedir retorno ao tema azul e impedir remoção da opção Monitoramento.
- Nenhuma conta, solicitação, paciente, sessão, pagamento ou dado real foi alterado.
- Nenhum commit, push, deploy, Firebase Rules, WhatsApp ou PM2 foi executado.

---

# Separação entre identidade e perfil — 2026-06-21 22:01:11 -03:00

## Protocolo inicial

- Branch atual: `main`.
- HEAD atual: `bcd77f13719d0d682d37f3fec84d2479d26733d0`.
- Stage: vazio.
- Status encontrado antes desta correção:
  - `M ../.gitignore` preexistente;
  - `?? docs/VALIDACAO_VISUAL_MONITORAMENTO.md`;
  - `?? logs/audit/`;
  - `?? relatorios/`;
  - `?? src/components/Monitoring/MonitoringUiPreview.tsx`;
  - `?? ../q`.
- Diff local na área de acesso antes desta correção: nenhum.
- Restrições reiteradas: sem commit, push, deploy, Firebase Rules, PM2, WhatsApp ou exclusão de dados reais/Firebase Auth.

## Auditoria da arquitetura atual

- `accessProfiles/{uid}` usa um documento único com campos principais `role`, `status`, `expiresAt`, `suspension`, `linkedPatientIds`, `enabledContexts` e `permissionOverrides`.
- `accessApprovals` usa `emailDocumentId(email)` como chave única, sem distinguir Profissional, Monitoramento ou Responsável.
- `requestDocumentId(email, uid)` também não inclui o perfil, então a mesma conta/e-mail só tem um documento operacional por solicitação ativa.
- `reviewRequest` aprova uma solicitação gravando `role/status` no mesmo `accessProfiles/{uid}`. Uma aprovação posterior substitui o perfil anterior.
- `createPendingRequest` bloqueia qualquer novo pedido quando encontra `approval.status === approved` ou `currentProfile.status === approved`, mesmo que o pedido seja para outro perfil.
- `revokeRequest`, `suspendAccess`, `reactivateAccess` e `updateAccessValidity` propagam a ação para o documento de perfil inteiro, afetando a conta/perfil principal em vez de um papel específico.
- `getProfile` retorna apenas um `profile` e o `App.tsx` roteia diretamente por `profile.role`; não existe etapa de escolha “Como deseja entrar?” quando há mais de um perfil aprovado.
- `buildEffectiveAccessContext` aceita `requestedContext`, mas o modelo atual trata Monitoramento como contexto adicional de um Profissional ou como `role` único; não valida uma coleção/mapa de perfis independentes por tipo.
- O frontend não envia um perfil ativo explícito para as APIs gerais; o backend só usa o documento único de perfil.
- O cache de `getAccessProfile` é por UID/refresh, não por perfil ativo. O cache do Monitoramento já considera `adminPreview/weekStart/weekEnd`, mas não um perfil ativo geral.
- O cadastro público tenta criar conta Auth quando não há usuário autenticado; se o e-mail já existir no Firebase Auth, a criação falha e ainda não existe fluxo completo para “Solicitar outro tipo de acesso” autenticado.

## Respostas objetivas da auditoria solicitada

1. O perfil principal é armazenado em `accessProfiles/{uid}` nos campos únicos `role/status`.
2. Sim, `accessProfiles/{uid}` suporta apenas um perfil efetivo no modelo atual.
3. Sim, existe campo único `role`.
4. Sim, `accessApprovals` usa somente hash do e-mail.
5. Sim, uma nova aprovação substitui a aprovação/perfil anterior para a mesma conta/e-mail.
6. Sim, o login escolhe automaticamente o único `profile.role` retornado.
7. Existe fallback perigoso: normalizações usam `professional` como fallback quando `role` é inválido.
8. Existe lógica que considera Admin/Profissional como sistema interno e separa Responsável/Monitoramento, mas o documento único pode fazer um perfil tomar o lugar do outro.
9. O backend diferencia parcialmente `role` e `activeContext`, mas ambos derivam do documento único.
10. O frontend ainda não envia um perfil ativo geral para o backend.
11. O backend valida aprovação do documento único, não de um perfil específico dentro da conta.
12. Caches não estão isolados por perfil ativo geral.
13. Revogação/suspensão/validade atuam sobre o documento de perfil inteiro.
14. Revogação/exclusão lógica pode impedir novo cadastro porque Auth e docs por e-mail continuam existindo.
15. O cadastro público cria Auth quando não há usuário autenticado; se o e-mail já existe, precisa orientar login e permitir solicitação adicional autenticada.

## Estratégia escolhida

- Adotar modelo transitório compatível com o legado: `accessProfiles/{uid}.profiles.{role}` e `accessApprovals/{emailHash_role}` para novas gravações, mantendo leitura de documentos antigos.
- Preservar campos legados `role/status` para compatibilidade, usando-os apenas como fallback e resumo.
- Fazer o backend validar `activeRole`/perfil solicitado contra `profiles.{role}` aprovado, sem confiar em estado do navegador.
- Alterar duplicidade para ser por e-mail/uid + perfil.
- Implementar seletor de perfil no login para múltiplos perfis ativos e ação “Trocar perfil” em sessão.
- Adicionar exclusão administrativa somente do cadastro de acesso de um perfil, sem excluir Firebase Auth ou dados clínicos.

## Implementação da separação por perfil — 2026-06-21 22:20:11 -03:00

- `api/access.js` passou a gravar solicitações e aprovações com chave por papel (`requestDocumentId(email, uid, role)` e `approvalDocumentId(email, role)`).
- `accessProfiles/{uid}` agora recebe subdocumentos lógicos em `profiles.{professional|monitoring|responsible|admin}`, mantendo `role/status` de topo apenas como resumo/fallback legado.
- Aprovar, rejeitar, suspender, reativar, alterar validade, solicitar informação, responder informação e revogar agora atualizam o perfil específico do papel, não a conta inteira.
- `getProfile` passou a materializar aprovações por papel e a aceitar `activeRole` para retornar o perfil ativo da sessão.
- `buildEffectiveAccessContext` passou a selecionar `profiles.{requestedContext}` quando uma API pede Monitoramento/Responsável/Profissional, impedindo que um Profissional herde Monitoramento por `enabledContexts`.
- `accessContext` aceita documentos novos baseados em `profiles` mesmo quando o resumo legado ainda está ausente ou defasado.
- Frontend passou a enviar `activeRole` em `getAccessProfile`, isolar cache por papel ativo e limpar caches/dados de sessão ao trocar perfil.
- `App.tsx` ganhou a tela “Como deseja entrar?” quando há múltiplos perfis aprovados, além de ação “Trocar perfil” no Monitoramento, Portal do Responsável e cabeçalho interno.
- `AccessPortal` permite que usuário autenticado solicite outro tipo de acesso, inclusive quando já existe um perfil carregado.
- Mensagem `auth/email-already-in-use` orienta entrar na conta existente e solicitar outro tipo de acesso.
- Admin ganhou ação “Excluir cadastro” por solicitação/perfil com confirmação digitada (`EXCLUIR MONITORAMENTO`, `EXCLUIR RESPONSAVEL` ou `EXCLUIR PROFISSIONAL`), removendo somente `accessRequests`, a aprovação daquele papel e `profiles.{role}`. Firebase Auth, outros perfis, pacientes, agenda, pagamentos, mídias, registros clínicos e atividades são preservados.
- A exclusão administrativa registra auditoria mínima em `accessDeletionAudit`.
- Tipos TypeScript e testes focados foram atualizados para representar `profiles` e `activeProfiles`.

### Validações executadas

- `npm run lint` — aprovado.
- `node --test tests/access-permissions.test.mjs tests/access-admin-controls.test.mjs` — 27 testes aprovados.
- `npm run build` — aprovado, build local gerado em `dist/`.
- `git diff --check` — sem erros; apenas avisos esperados de conversão LF/CRLF no Windows.

### Restrições mantidas

- Nenhum commit, push, deploy ou publicação de Firebase Rules foi executado.
- Nenhum PM2, WhatsApp, envio real de mensagem ou automação externa foi acionado.
- Nenhum dado real de Firebase Auth, pacientes, agenda, pagamentos, mídias, registros clínicos ou atividades foi excluído.

## Sessoes Restantes no Dashboard do Monitoramento

- Objetivo: inserir no Dashboard do Monitoramento o bloco **Sessoes Restantes (Pacote atual)** abaixo de Proximas Sessoes.
- Sincronizacao: Relatorios e Monitoramento passaram a reutilizar shared/sessionPackageSummary.js, preservando o mesmo calculo do ciclo atual de 10 sessoes.
- Copia geral: botao **Copiar todos** copia o resumo de todos os atendentes ativos e visiveis no bloco.
- Copia individual: cada atendente possui botao acessivel para copiar somente o proprio resumo.
- Seguranca: o filtro de visibilidade do Monitoramento continua sendo aplicado; Jacinto Melaco (Teste) permanece oculto.
- Interface: card verde, responsivo e com rolagem interna para listas extensas.
- Arquivos alterados: src/components/Reports.tsx e src/components/Monitoring/MonitoringPanel.tsx.
- Arquivos criados: shared/sessionPackageSummary.js, src/lib/clipboard.ts e 	ests/session-package-summary.test.mjs.
- Testes previstos nesta aplicacao: testes do pacote atual, testes do Monitoramento, lint, build e git diff --check.
- Publicacao: commit, push e deploy permanecem bloqueados ate validacao visual local do usuario.

---

# Tela de Acesso Geral — preparação local em 26/06/2026

## Auditoria de retomada

- Pasta auditada: `D:\Projeto Gestão Clínica - Repositório\gestão-clínica-fábio-denarde`.
- Branch auditada: `main`.
- HEAD auditado: `5fd0b21df3aa540dfec6c0dd5798a10e80702fdf`.
- Coleta somente de leitura: 137 arquivos sanitizados.
- `git diff --check` da coleta: aprovado.
- Alterações preexistentes de WhatsApp, PM2, relatórios e arquivos não rastreados foram identificadas e permanecem fora deste escopo.
- Nenhum dado real, conta real, agenda, paciente, pagamento, Firebase Rules, PM2 ou WhatsApp foi modificado durante a preparação.

## Rotas específicas por perfil

- Preparadas as rotas públicas diretas `/responsavel`, `/profissional` e `/monitoramento`.
- A rota principal `/` continua com o seletor de perfil, login Google, recuperação por e-mail e solicitação pública existentes.
- As rotas específicas exibem somente o perfil correspondente, usuário/e-mail, senha e botão Entrar.
- A URL não concede autorização: o backend continua validando o perfil ativo, suspensão, revogação e validade.
- `vercel.json` foi preparado com rewrites exclusivamente para as três rotas diretas, sem interceptar `/api`.

## Modelagem do nome de usuário

- Nome normalizado em minúsculas, com 3 a 20 caracteres.
- Permitidos: letras, números, ponto, hífen e sublinhado, começando por letra e terminando por letra ou número.
- Nomes reservados e sequências inseguras são rejeitados.
- A unicidade é garantida no backend pela coleção administrativa `accessUsernames`, usando reserva transacional antes da criação no Firebase Authentication.
- A resolução do login é determinística e não exige consulta pública que permita enumerar usuários.

## Estratégia de autenticação por nome de usuário

- Contas antigas continuam autenticando diretamente por e-mail.
- Contas novas usam um e-mail técnico determinístico apenas dentro do Firebase Authentication.
- O e-mail técnico não é apresentado ao usuário, não é usado como contato e não é retornado nas telas administrativas.
- Senhas continuam armazenadas exclusivamente pelo Firebase Authentication.
- Mensagens de credencial inválida são genéricas para nome de usuário e e-mail.

## Criação administrativa de contas

- Preparado o bloco `Criar acesso direto` dentro da administração de solicitações.
- Perfis suportados: Responsável, Profissional e Monitoramento.
- Responsável exige vínculo explícito com pelo menos um atendente e no máximo três.
- A criação ocorre no backend com autorização exclusiva do administrador principal.
- Se a criação do perfil falhar após criar a conta Auth, a conta incompleta é removida e a reserva do nome é liberada.
- Link, usuário e senha temporária são mostrados somente na confirmação imediata.

## Senha temporária

- A senha pode ser informada pelo administrador ou gerada de forma criptograficamente segura no backend.
- A senha temporária não é gravada no Firestore, em logs, auditorias ou checkpoint.
- A tela limpa os campos sensíveis ao fechar a confirmação.
- O administrador pode gerar nova senha temporária para contas diretas por meio de modal de confirmação.
- Redefinir a senha não altera suspensão, revogação, validade, perfil ou vínculos.

## Troca obrigatória no primeiro acesso

- Contas diretas são criadas com `mustChangePassword` habilitado por padrão.
- Antes da troca, o backend nega operações protegidas com `access/password-change-required`.
- A conclusão compara a versão de credencial do Firebase Auth com a linha de base registrada na criação ou redefinição; apenas uma mudança real de senha libera o perfil.
- O frontend apresenta uma tela exclusiva para confirmar a senha temporária e criar uma senha particular.
- Dashboard, Agenda, Galeria e demais dados permanecem bloqueados até a conclusão.

## Troca voluntária de senha

- Preparado o acesso `Minha conta` para contas autenticadas por senha.
- A troca exige senha atual, nova senha e confirmação.
- A senha atual é reautenticada no Firebase Authentication antes de `updatePassword`.
- A troca não modifica usuário, perfil, vínculos, suspensão, validade, revogação ou permissões.
- Contas autenticadas somente por Google não recebem um formulário incompatível de senha.

## Segurança e autorização

- Criação e redefinição de contas exigem o administrador principal no backend.
- A coleção de nomes de usuário não é consultada diretamente pelo frontend.
- O e-mail técnico, UID e campos internos não são apresentados nas páginas de login.
- A redefinição de senha preserva os estados administrativos existentes.
- O fluxo possui compensação para falha parcial na criação e restauração de estado quando a redefinição de senha é recusada pelo Firebase Auth.
- Nenhuma alteração foi feita em Firestore Rules, dados clínicos, agenda, pagamentos, PM2 ou robô do WhatsApp.

## Testes da Tela de Acesso Geral

- `node --check api/access.js`: aprovado.
- `node --check shared/accessCredentials.js`: aprovado.
- Verificação sintática isolada dos oito arquivos TypeScript/TSX alterados: aprovada.
- Testes focados de credenciais, rotas, autenticação e permissões: 37/37 aprovados no ambiente de preparação.
- Testes completos, lint e build permanecem obrigatórios no repositório real depois da aplicação do pacote, porque a coleta sanitizada não contém todos os arquivos e dependências do projeto.

## Limitações encontradas

- O pacote sanitizado não continha todos os componentes compartilhados, dependências instaladas e arquivos auxiliares necessários para executar lint/build integralmente fora do computador do projeto.
- A confirmação definitiva depende da aplicação auditada no repositório real e da execução automática de testes, lint, build e `git diff --check`.
- Nenhum commit, push ou deploy está autorizado nesta etapa.

## Estado desta continuação

- Implementação preparada em pacote local com validação por SHA-256 dos arquivos auditados.
- Aplicação no repositório real: pendente.
- Teste visual local pelo usuário: pendente.
- Commit, push e deploy: bloqueados até validação local completa e autorização expressa.

## Continuação — gerenciamento de acesso, notificações e sessões progressivas (26/06/2026)

### Objetivo autorizado

- permitir que o administrador gerencie posteriormente o nome de usuário de contas de acesso direto;
- permitir redefinição segura de senha temporária, sem armazenar ou recuperar a senha atual;
- ocultar o identificador técnico `@login.gestaoclinica.invalid` de interfaces e notificações;
- manter no Monitoramento somente notificações de login, abertura da Agenda e abertura da Galeria de Atividades;
- tornar a lista de sessões do Portal do Responsável progressiva e incluir previsão de término do pacote de dez sessões.

### Modelagem de credenciais

- o nome de usuário continua associado a um e-mail técnico determinístico apenas no Firebase Authentication;
- a alteração do nome de usuário reserva o novo alias, atualiza o e-mail técnico no Auth e sincroniza solicitação, aprovação, perfil e alias em transação;
- em caso de falha, o e-mail do Auth e a reserva do alias são restaurados quando possível;
- a senha atual nunca é retornada ou persistida;
- a nova senha temporária pode ser informada pelo administrador ou gerada automaticamente;
- a nova senha é devolvida apenas na resposta da redefinição e exibida uma única vez;
- a redefinição mantém suspensão, revogação e validade existentes.

### Identidade pública

- `publicAccessIdentifier` prioriza nome de usuário, e-mail real de contato ou nome de exibição;
- `publicAccessEmail` elimina e-mails técnicos das respostas públicas;
- Portal do Responsável, tela de controle de acesso, painel de senha, Monitoramento e notificações não devem exibir `@login.gestaoclinica.invalid`.

### Notificações do Monitoramento

Eventos mantidos:

1. login autenticado no perfil Monitoramento;
2. primeira abertura da Agenda na sessão autenticada;
3. primeira abertura da Galeria de Atividades na sessão autenticada.

Eventos encerrados:

- entrada genérica no painel;
- acesso ao Dashboard;
- logout;
- demais eventos específicos do Monitoramento.

A deduplicação usa um identificador determinístico composto por usuário, sessão autenticada, tipo do evento e aba. Nenhuma exclusão automática de notificações históricas foi introduzida.

### Sessões progressivas no Portal do Responsável

- são exibidas as sessões já alcançadas e somente a próxima sessão futura;
- a sessão de maior número aparece acima das anteriores;
- posições futuras distantes ficam ocultas, mas continuam disponíveis para calcular a previsão;
- a previsão termina na data da sessão 10 quando essa posição está agendada;
- sessões duplas contam como duas posições, mas datas iguais são deduplicadas na informação de previsão;
- nenhuma numeração, pagamento, reagendamento ou registro real é alterado por essa apresentação.

### Arquivos previstos nesta continuação

Modificados:

- `api/access.js`
- `shared/accessCredentials.js`
- `src/App.tsx`
- `src/components/Auth/AccessPortal.tsx`
- `src/components/Auth/AccessRequestsAdminCard.tsx`
- `src/components/Auth/PasswordSecurityPanel.tsx`
- `src/components/Auth/ResponsiblePortal.tsx`
- `src/components/Monitoring/MonitoringPanel.tsx`
- `src/lib/accessApi.ts`
- `src/types/access.ts`
- `tests/access-admin-controls.test.mjs`
- `tests/access-credentials.test.mjs`
- `tests/monitoring-notifications.test.mjs`
- `tests/responsible-portal-packages.test.mjs`

Criado:

- `shared/responsiblePortalSessions.js`

### Validações executadas fora do projeto real

- sintaxe Node de `api/access.js`, `shared/accessCredentials.js` e `shared/responsiblePortalSessions.js`: aprovada;
- transpile de sintaxe TypeScript/TSX dos arquivos alterados: aprovado;
- cinco testes do módulo de credenciais: aprovados;
- cenários puros de sessões progressivas e sessão dupla: aprovados;
- testes completos, lint e build permanecem obrigatórios no computador do projeto após aplicação do pacote.

### Proteções desta etapa

- nenhum dado real foi gravado;
- nenhuma conta real foi alterada;
- nenhuma senha real foi lida;
- nenhum commit foi executado;
- nenhum push foi executado;
- nenhum deploy foi executado;
- nenhuma Firebase Rule foi publicada;
- PM2 e WhatsApp não foram modificados.

# CORREÇÕES REALIZADAS

| Arquivo | Comportamento anterior | Correção | Teste associado |
|---|---|---|---|
| `src/lib/whatsappAdminMonitor.js` | Audit formatado diretamente em texto | Separação entre objeto normalizado e formatação, mantendo compatibilidade | `whatsapp-admin-monitor` e teste operacional |
| `src/lib/whatsappOperationalReportRepository.js` | Não existia persistência segura | Repositório diário, sanitização, agregação e transação determinística | 9 testes operacionais |
| `server.js` | Enviava relatório sem disponibilizá-lo ao frontend | Envia a mensagem real e depois persiste cópia sanitizada; falha de persistência não reenvia | Teste de ordem e arquitetura |
| `src/lib/whatsappOperationalReport.ts` | Resumo local calculado separadamente | Tipos e normalização do documento persistido, status, fuso, máscara e helpers | TypeScript + testes |
| `src/lib/useDailyWhatsappOperationalReport.ts` | Não existia fonte real compartilhada | Um listener do documento diário somente para Admin, com troca à meia-noite | Teste estático + TypeScript |
| `src/App.tsx` | Dashboard e Relatórios construíam/recebiam fontes distintas | Um hook no shell administrativo e o mesmo estado para as duas áreas | Teste de listener único |
| `src/components/Dashboard.tsx` | Card usava resumo local | Passou a exibir o documento real compartilhado, com estados vazio/erro/status | Teste legado + build |
| `src/components/Reports.tsx` | Subaba usava resumo local | Passou a usar o mesmo estado do Dashboard; permanece exclusiva do Admin | Teste de perfil + build |
| `src/components/WhatsApp/WhatsappOperationalReportPanel.tsx` | Componentes duplicados/ausentes | Componente único para variantes Dashboard e Relatórios | TypeScript + build |
| `firestore.rules` | Sem regra da coleção diária | `get` somente Admin aprovado; listagem e escritas frontend bloqueadas | Teste de regras local |
| Preview seguro temporário | Teste visual exigia app real | Usado apenas na cópia temporária de validação, sem arquivos finais neste repositório | HTTP 200 e scan de imports na cópia temporária |
| `package.json` | Sem comando operacional específico | Adicionado `test:wpp:operational` | Execução aprovada |
| `tests/whatsapp-operational-report.test.mjs` | Sem cobertura da nova arquitetura | 9 testes de origem única, sanitização, documento diário, listener e regras | 9/9 |
| `tests/legacy-activity-ui-retirement.test.mjs` | Não reconhecia o novo painel compartilhado | Ajuste da validação estática, preservando navegação/perfis | 10/10 |

## Correções anteriores preservadas e revalidadas

- Galeria sem autosave.
- Botão `Salvar` abaixo do link.
- Data `DD/MM/AAAA` com calendário e data padrão da sessão.
- Fechamento do editor após salvamento confirmado.
- Confirmação de descarte.
- Um card com dois `sessionIds` para sessões duplas válidas.
- Clique na logo conforme o perfil.

## Não alterado

- Número/conta remetente do robô.
- Destinatário administrativo `27999072659`.
- Telefones de responsáveis.
- Regras de lembretes.
- Dados reais.
- Questionários Digitais.
- Configurações de produção.

---

## Ajustes adicionais de interface — 20/06/2026

| Área | Comportamento anterior | Correção realizada |
|---|---|---|
| Menu lateral | Podia permanecer recolhido por preferência antiga persistida no navegador e, expandido, ocupava 380 px. | Padrão expandido por nova sessão, persistência em `sessionStorage`, largura expandida de 264 px e botão discreto de alternância. |
| Galeria — Observação | Textarea sempre aberta, aumentando a altura do editor. | Seção recolhível, fechada por padrão, preservando conteúdo ao expandir/recolher. |
| Galeria — alterações não salvas | A simples abertura criava rascunho e acionava alerta ao fechar. | Assinatura normalizada compara o rascunho com a linha de base; alerta somente em mudança real. |
| Galeria — Data | Campo manual e campo nativo apareciam como duas entradas lado a lado. | Um único campo visível `DD/MM/AAAA`; o seletor nativo fica transparente sobre um ícone de calendário. |
| Galeria — densidade | Editor alto e com espaçamento amplo. | Espaçamentos, bordas e controles compactados; Título e Categoria usam grade em telas adequadas. |
| Pendências | Exibia “Formulários recebidos”. | Item removido do card Pendências. |
| Pacotes para renovar | Total podia ser maior do que os dois nomes exibidos. | Pacientes são deduplicados, o total é coerente e o detalhamento fica recolhido por padrão, abrindo por chevron em uma área organizada. |
| Próximas sessões | Exibia apenas as sessões de hoje, deixando espaço vazio. | Incluído segundo bloco com Amanhã ou o próximo dia com sessões disponível. |


---

## Reajuste do detalhamento de renovação — 20/06/2026

| Arquivo | Comportamento anterior | Correção realizada |
|---|---|---|
| `src/components/Dashboard.tsx` | Os nomes dos pacientes ficavam permanentemente expostos abaixo de “Pacotes para renovar”. | A linha principal virou um controle expansível. A lista inicia recolhida, abre por chevron, organiza nome e progresso em linhas próprias e pode ser recolhida novamente. |
| `tests/activity-gallery-status.test.mjs` | A cobertura conferia contagem e listagem, mas não o estado recolhível. | Incluídas verificações de estado inicial fechado, `aria-expanded`, `aria-controls`, alternância e rotação do chevron. |

A lógica de pacientes únicos, total e navegação ao cadastro foi preservada.

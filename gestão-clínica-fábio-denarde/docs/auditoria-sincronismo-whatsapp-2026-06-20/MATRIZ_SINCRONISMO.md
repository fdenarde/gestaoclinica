# MATRIZ DE SINCRONISMO

| Origem | Ação | Persistência/estado | Destino que reflete | Perfil | Atualização | Proteção/teste |
|---|---|---|---|---|---|---|
| Audit real do sender | Finalizar rotina | Objeto de `buildExecutionReportData` | Mensagem administrativa e documento sanitizado | Backend | Mesma execução | Teste comprova mesma origem normalizada |
| Sender | Enviar mensagem administrativa | WhatsApp pelo fluxo existente | Número administrativo configurado, preservando `27999072659` | Backend | Antes da persistência | Falha de persistência não reenvia mensagem |
| Sender | Persistir resultado final | `whatsappOperationalReports/{YYYY-MM-DD}` | Dashboard e Relatórios | Backend/Admin SDK | Uma transação por rotina relevante | Documento determinístico, um read + um write na transação |
| Documento diário | Atualizar rotina do mesmo dia | Campo `routines` por chave da rotina | Contadores agregados do dia | Administrador | Sobrescreve a mesma rotina | Não duplica documento nem rotina |
| App administrativo | Perfil aprovado é Admin | Um hook compartilhado | Dashboard e Relatórios | Administrador | Um único `onSnapshot` | Não abre listener para outros perfis |
| Dashboard | Abrir/recolher resumo | Estado React local | Card WhatsApp | Administrador | Imediata | Nenhuma consulta adicional |
| Relatórios | Abrir subaba WhatsApp | Mesmo estado recebido do App | Painel de relatório | Administrador | Imediata | Nenhum segundo listener |
| Virada de dia | Atingir 00:00 em São Paulo | Troca de `dateKey` | Dashboard e Relatórios ficam vazios para novo dia | Administrador | Automática, sem F5 | Timer único desmontável; sem write/delete |
| Regra Firestore | Ler documento diário | `get` direto | Frontend | Somente Admin aprovado | Sob demanda/listener | `list` e todas as escritas bloqueadas |
| Usuário Profissional | Navegar no sistema | Nenhum listener do relatório | Sem card/subaba operacional | Profissional | Imediata | Hook desabilitado |
| Usuário Responsável | Abrir Portal | Nenhum listener do relatório | Sem conteúdo administrativo | Responsável | Imediata | Hook desabilitado e rota separada |
| Usuário Monitoramento | Navegar | Nenhum listener do relatório | Sem conteúdo administrativo | Monitoramento | Imediata | Hook desabilitado |
| Preview seguro | Trocar cenário sent/partial/failed/empty | Fixture em memória | Card e subaba simulados | Local | Imediata | Não importa Firebase/App/API/robô |
| Preview seguro | Simular virada de dia | Fixture em memória | Estado vazio e painéis recolhidos | Local | Imediata | Sem serviço externo |
| Galeria real | Alterar campos | Rascunho local | Editor do card | Admin/Profissional | Imediata | Sem autosave; persistência só em Salvar |
| Galeria real | Salvar | Documento único do pacote via API existente | Card, Galeria e Portal permitido | Admin/Profissional | Após sucesso | Botão bloqueado; editor fecha após confirmação |
| Galeria real | Duas sessões válidas no mesmo dia | `sessionIds` com dois IDs | Um único card relacionado às duas sessões | Perfis autorizados | Após salvar | 27 testes cobrem deduplicação, canceladas e outro atendente |

## Sincronismos confirmados

- A mensagem real e o documento diário derivam do mesmo objeto normalizado.
- Dashboard e Relatórios consomem a mesma instância de estado.
- Um único listener é aberto para o documento do dia e somente para Administrador.
- O relatório de ontem não é consultado pelo frontend do dia atual.
- A troca de dia não apaga histórico.
- A persistência do resumo é posterior ao envio e isolada do reenvio.
- A Galeria permanece sem autosave e sessões duplas permanecem em um card com dois vínculos.

## Dependências para produção

A sincronização real somente passará a funcionar em produção depois de autorização específica para:

1. levar o código do backend para o computador/processo do robô;
2. publicar as regras locais do Firestore;
3. publicar o frontend;
4. reiniciar o sender em janela segura;
5. executar uma rotina real monitorada.

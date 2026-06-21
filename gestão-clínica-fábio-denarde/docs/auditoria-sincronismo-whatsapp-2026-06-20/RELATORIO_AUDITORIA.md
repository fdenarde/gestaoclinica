# RELATÓRIO DE AUDITORIA

## Escopo

Implementação local da cópia sanitizada do relatório diário real do WhatsApp, compartilhada entre Dashboard e Relatórios, com controle de acesso, economia de leituras e preview visual sem Firebase.

## Diagnóstico anterior

O sender já produzia um audit real e enviava um texto administrativo, mas o frontend não recebia esse resultado. O resumo exibido na interface era calculado localmente, separado do resultado pós-envio. Isso permitia divergência entre o que o robô enviou e o que o Dashboard mostrava.

O ambiente principal também não era apropriado para teste visual seguro porque importa configuração real do Firebase e abre listeners depois do login.

## Causa raiz

- Formatação e envio estavam acoplados ao fluxo do sender sem objeto normalizado reutilizável.
- Não existia repositório para persistência diária sanitizada.
- Não existia hook/provider compartilhado para Dashboard e Relatórios.
- Não existia regra Firestore específica de leitura administrativa.
- Não existia entrypoint local isolado.

## Correção implementada

### Backend

- `buildExecutionReportData(audit)` normaliza o audit real.
- `formatExecutionReportMessage(report)` formata a mensagem enviada.
- `buildExecutionReportMessage(audit)` foi preservada como API compatível e delega às novas funções.
- `saveDailyWhatsappOperationalReport(...)` sanitiza e grava o documento diário depois da tentativa real de envio.
- A persistência ocorre em transação e atualiza a chave da rotina dentro do mesmo documento.
- Falha de persistência gera incidente próprio e não chama novamente o sender.

### Documento diário

**Caminho:** `whatsappOperationalReports/{YYYY-MM-DD}`<br>
**Fuso:** `America/Sao_Paulo`<br>
**Escopo:** relatório administrativo global, coerente com o sender que agrega os usuários.

Campos principais:

- `schemaVersion`
- `reportDate`
- `timezone`
- `generatedAt`
- `completedAt`
- `status`
- `recipientMasked`
- `counts`
- `summary`
- `alerts`
- `source`
- `messageHash`
- `latestRoutine`
- `routines`
- `updatedAt`

Campos removidos da persistência:

- nomes de pacientes;
- nomes de responsáveis;
- telefones completos;
- mensagem completa;
- observações ou texto clínico;
- links de mídia;
- dados financeiros;
- stack trace técnico.

### Frontend

- `useDailyWhatsappOperationalReport` observa apenas o documento da data atual.
- O hook é habilitado somente para `status: approved` e `role: admin`.
- `App.tsx` cria uma única fonte e distribui o mesmo estado para Dashboard e Relatórios.
- `WhatsappOperationalReportPanel` centraliza os estados visualizados.
- A subaba WhatsApp continua exclusiva do Administrador.
- Não há função de envio ou escrita no frontend.

### Virada de dia

Um timer calcula o tempo até a próxima meia-noite em São Paulo. Na troca:

- o listener do documento anterior é desmontado;
- o estado anterior é descartado;
- o documento do novo dia passa a ser observado;
- o resumo aparece vazio até existir relatório;
- nenhum documento é apagado;
- nenhuma gravação é feita apenas para limpar a interface.

### Segurança

Regra local adicionada:

- `get`: somente perfil `approved` com `role == admin`;
- `list`: bloqueado;
- `create/update/delete`: bloqueados no cliente;
- escrita real: somente Admin SDK do backend.

As regras não foram publicadas.

### Preview seguro temporário

- O preview seguro foi usado apenas na cópia temporária de validação.
- Ele não integra o repositório final e não há `safe-preview.html` nem `src/safe-preview/main.tsx` no lote staged.
- A validação registrada de HTTP 200 e ausência de imports proibidos pertence a essa cópia temporária.
- A aplicação final deve ser conferida pelo sistema local normal, sem salvar dados reais.

## Riscos e limitações

1. A regra local e o backend ainda não estão ativos em produção.
2. O primeiro relatório somente aparecerá após uma rotina real executada com o novo backend.
3. A cópia segura não contém `.git`; o estado final de Git deve ser conferido no computador antes de qualquer commit.
4. O teste offline possui dependência preexistente do fuso local; no sandbox UTC falhou uma janela horária, e com `America/Sao_Paulo` passou completamente.
5. A avaliação de regra do Firestore consulta `accessProfiles/{uid}`; isso pode representar leitura dependente de regra conforme a cobrança do Firebase.
6. O destinatário completo não é armazenado no documento; somente `*******2659`.

## Gravidade das falhas encontradas

| Falha | Gravidade | Situação |
|---|---|---|
| UI não refletia o relatório real pós-envio | Alta funcional | Corrigida localmente |
| Dashboard e Relatórios poderiam ter fontes divergentes | Média | Corrigida |
| Possibilidade de listener duplicado | Média de custo | Evitada por hook único no App |
| Ausência de bloqueio real de escrita frontend | Alta de segurança | Regra local adicionada |
| Teste visual dependia de Firebase real | Alta de segurança | Preview isolado criado |
| Persistência poderia causar reenvio se mal acoplada | Alta operacional | Persistência isolada depois do envio |

## Conclusão

A arquitetura local atende ao escopo: o relatório visual passa a ser uma cópia sanitizada derivada do mesmo objeto que produz a mensagem administrativa real. A ativação em produção permanece deliberadamente pendente de autorização, conferência visual e implantação controlada.

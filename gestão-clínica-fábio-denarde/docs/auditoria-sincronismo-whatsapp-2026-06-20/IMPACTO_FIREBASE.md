# IMPACTO FIREBASE

## Estrutura criada localmente

```text
whatsappOperationalReports/{YYYY-MM-DD}
```

Não há consulta da coleção inteira e não há carregamento de histórico.

## Backend

Cada rotina administrativa real que alcançar a etapa de persistência executa uma transação com:

- 1 leitura do documento diário existente;
- 1 gravação substituindo o documento diário agregado.

Em um dia normal com três rotinas (`HOJE_MANHA`, `HOJE_TARDE`, `AMANHA`), a estimativa incremental é:

- até 3 leituras transacionais;
- até 3 gravações;
- sempre no mesmo documento da data.

Uma repetição autorizada da mesma rotina atualiza a mesma chave; não cria outro documento. Esse custo é adicional apenas ao relatório e não altera as leituras já realizadas pelo planejamento de lembretes.

## Frontend

- Somente Administrador aprovado abre o listener.
- Existe um único listener compartilhado por sessão administrativa.
- A consulta é um `doc` direto da data atual, não uma `collection` nem uma query histórica.
- Dashboard e Relatórios não abrem listeners independentes.
- Profissional, Responsável e Monitoramento: zero leitura dessa coleção.
- Ao receber uma atualização do documento enquanto conectado, o listener recebe o novo snapshot correspondente.
- Na virada do dia, o listener antigo é desmontado e um novo documento direto é observado.

A autorização usa leitura dependente de regra em `accessProfiles/{uid}`. O Firebase pode contabilizar acessos de documentos usados por regras conforme suas regras de cobrança; esse ponto deve ser acompanhado após implantação.

## Operações evitadas

- Nenhuma leitura de coleção inteira.
- Nenhum histórico carregado.
- Nenhum listener por componente.
- Nenhum polling por segundo ou minuto.
- Nenhuma gravação para limpar o relatório à meia-noite.
- Nenhuma exclusão automática do documento anterior.
- Nenhum documento por tentativa.
- Nenhuma persistência de mensagem completa ou dados clínicos.

## Comportamento em falha

- Se o envio administrativo falhar, o documento pode registrar `failed` de forma sanitizada.
- Se a persistência falhar, o sender registra incidente local e não reenvia a mensagem.
- A falha no Firestore não altera destinatários nem interrompe a lógica já concluída dos lembretes.

## Impacto qualitativo

| Item | Efeito |
|---|---|
| Documento diário determinístico | Reduz documentos e evita histórico desnecessário |
| Um listener no App | Evita leituras duplicadas entre Dashboard e Relatórios |
| Acesso somente Admin | Evita leituras por perfis sem necessidade |
| Timer até meia-noite | Efeito praticamente neutro; sem polling |
| Transação read + write | Pequeno custo previsível por rotina |
| Sanitização | Reduz tamanho do documento e exposição de dados |

## Estado desta execução

- Nenhuma leitura real foi realizada.
- Nenhuma gravação real foi realizada.
- Nenhuma regra foi publicada.

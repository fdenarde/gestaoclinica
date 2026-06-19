# Galeria de Atividades — estrutura legada preservada

## Situação atual

A interface profissional utiliza exclusivamente a nova **Galeria de Atividades**, baseada em links de álbuns do Google Fotos e em um documento resumido por atendente e pacote.

A estrutura anterior de upload e reprodução de mídias foi retirada da navegação ativa, mas não foi apagada.

## Elementos preservados para auditoria e estudo

- componentes em `src/components/ActivityRecords/`;
- cliente histórico em `src/lib/activityRecordsApi.ts`;
- tipos em `src/types/activityGallery.ts` e `src/types/activityRecords.ts`;
- endpoints e regras históricas relacionados a registros de atividades;
- documentos já existentes no Firebase;
- arquivos já existentes no Google Drive;
- metadados e notificações históricas.

## Comportamento aprovado

- nenhum botão da interface ativa abre o modal antigo;
- nenhuma aba ativa monta `ProfessionalActivityGallery`, `ActivityRecordsTab` ou `ActivityRecordModal`;
- atalhos de Atendentes, Agenda e notificações abrem a nova Galeria de Atividades do atendente específico;
- ao entrar pelo menu, nenhum atendente é selecionado automaticamente;
- notificações antigas não carregam nem reproduzem mídias legadas automaticamente;
- o Dashboard não consulta nem mostra o indicador antigo de upload atrasado;
- a exclusão de um atendente continua bloqueada quando existem registros históricos preservados.

## Regra de segurança

Não executar exclusão, migração ou limpeza física dos dados antigos sem uma etapa separada contendo:

1. inventário em modo de simulação;
2. backup verificável;
3. contagem de documentos e arquivos;
4. validação de vínculos clínicos;
5. lotes pequenos e auditáveis;
6. autorização explícita do administrador.

Este arquivo documenta a preservação intencional da estrutura anterior para futuras análises e insights técnicos.

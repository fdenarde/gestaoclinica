# TESTES MANUAIS PENDENTES

## Conferência visual local — obrigatória antes de commit

O preview seguro foi temporário e não integra o repositório final. A conferência visual deve ser feita no sistema local normal, com dados reais apenas em leitura e sem salvar alterações.

## Roteiro visual

| Área | Ação | Resultado esperado |
|---|---|---|
| Card Dashboard | Selecionar `empty` | Contadores zerados e “Nenhum relatório disponível hoje” |
| Card Dashboard | Selecionar `sent` e `Ver resumo` | Resumo sanitizado abre e recolhe |
| Card Dashboard | Selecionar `partial` | Estado parcial e alerta visível |
| Card Dashboard | Selecionar `failed` | Estado de falha sem dados sensíveis |
| Relatórios | Expandir/recolher | Mesmo conteúdo e contadores do Dashboard |
| Relatórios | Conferir destinatário | Somente `*******2659` |
| Virada do dia | Clicar em `Simular virada do dia` | Novo dia, estado vazio e painéis recolhidos |
| Galeria fictícia | Editar título, observação, data e link | Mensagem informa alterações pendentes; nada salva sozinho |
| Galeria fictícia | Digitar `20062026` | Campo pode ser validado como `20/06/2026` ao salvar |
| Galeria fictícia | Usar calendário | Data visual em `DD/MM/AAAA` |
| Galeria fictícia | Fechar com alterações | Confirmação de descarte aparece |
| Galeria fictícia | Simular erro e salvar | Dados permanecem e editor continua aberto |
| Galeria fictícia | Desmarcar erro e salvar | Editor fecha apenas depois do sucesso; botão permite reabrir |

## Não testar agora

- Não abrir a aplicação principal para realizar gravações.
- Não executar o robô.
- Não enviar mensagem de teste.
- Não publicar regras.
- Não usar pacientes reais para testar Galeria.

## Depois da aplicação local e antes do deploy

Quando houver autorização para ambiente real, ainda será necessário validar:

1. Admin abre um único listener do documento do dia.
2. Profissional, Responsável e Monitoramento não realizam leitura.
3. A subaba WhatsApp aparece somente para Admin.
4. Uma rotina real cria/atualiza `whatsappOperationalReports/{data}`.
5. Dashboard e Relatórios mostram exatamente os mesmos contadores.
6. Falha de persistência não duplica o relatório enviado.
7. À meia-noite, a interface troca para o novo documento sem apagar o anterior.
8. Regras publicadas bloqueiam listagem e escrita pelo cliente.

Esses testes exigem planejamento de implantação e não devem ser executados sem nova autorização.

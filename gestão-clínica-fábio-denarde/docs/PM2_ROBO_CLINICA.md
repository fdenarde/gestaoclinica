# PM2 do robô WhatsApp

Este documento prepara a migração do processo `RoboClinica`. Ele não autoriza
nem executa a inicialização do WhatsApp.

## Caminhos

Configuração antiga registrada no dump local do PM2:

`D:\Backup Projeto Clinica completo\gestão-clínica-fábio-denarde\server.js`

Diretório antigo:

`D:\Backup Projeto Clinica completo\gestão-clínica-fábio-denarde`

Repositório correto:

`D:\Projeto Gestão Clínica - Repositório\gestão-clínica-fábio-denarde`

O arquivo `ecosystem.config.cjs` usa `__dirname`. Assim, `script` e `cwd` são
resolvidos a partir da localização real do repositório e não dependem de um
caminho absoluto gravado manualmente.

## Arquivo local de supressões

O arquivo real abaixo contém dados operacionais e deve permanecer somente no
computador da clínica:

`config\whatsapp-reminder-suppressions.json`

Ele é ignorado pelo Git. O repositório contém apenas este modelo fictício:

`config\whatsapp-reminder-suppressions.example.json`

Para preparar uma instalação nova, copie o modelo para o nome local e substitua
os dados fictícios somente no computador autorizado. Nunca envie o arquivo real
ao GitHub, Vercel ou serviços externos.

## Configuração preparada

- processo: `RoboClinica`;
- script: `server.js` deste repositório;
- modo: `fork`, uma instância;
- `watch`: desabilitado;
- QR Code: explicitamente não autorizado;
- timezone: `America/Sao_Paulo`;
- logs: `logs/pm2/RoboClinica-out.log` e
  `logs/pm2/RoboClinica-error.log`;
- nenhuma credencial ou variável sensível no arquivo;
- limite de memória e proteção contra reinícios instáveis.

## Pré-condições obrigatórias

Antes de qualquer ativação futura:

1. obter autorização explícita para iniciar o WhatsApp;
2. escolher horário afastado de 06:30, 09:00 e 12:30;
3. confirmar `npm run test:wpp:offline`;
4. confirmar `npm run lint` e `npm run build`;
5. confirmar a supressão local de mensagens já enviadas manualmente;
6. confirmar que o lembrete do próprio dia permanece elegível quando aplicável;
7. confirmar que uma sessão dupla gera somente uma mensagem por janela;
8. decidir previamente como tratar qualquer QR Code ou falha de autenticação.

## Comandos futuros

Os comandos abaixo são apenas documentação. Não foram executados nesta
preparação.

```powershell
Set-Location -LiteralPath 'D:\Projeto Gestão Clínica - Repositório\gestão-clínica-fábio-denarde'
pm2 delete RoboClinica
pm2 start .\ecosystem.config.cjs --only RoboClinica
pm2 describe RoboClinica
pm2 save
```

Após `pm2 describe RoboClinica`, validar antes de considerar a migração
concluída:

- `script path` termina em `\server.js` neste repositório;
- `exec cwd` é o repositório atual;
- existe PID real;
- os logs são gravados em `logs\pm2`;
- não houve QR Code inesperado;
- o cliente atingiu estado pronto;
- nenhuma rotina foi disparada fora da janela planejada.

## Riscos restantes

- `pm2 start` inicializará o WhatsApp e pode disparar cron jobs nos horários
  programados;
- iniciar próximo de 06:30, 09:00 ou 12:30 aumenta o risco operacional;
- o dump atual do PM2 ainda continuará antigo até a futura execução de
  `pm2 save`;
- o processo `ClinicaFrontend` também aparece no dump antigo, mas está fora do
  escopo desta correção;
- os logs precisam de política de rotação para não crescerem indefinidamente;
- a ativação deve confirmar autenticação sem liberar QR Code automaticamente.

## Estado desta preparação

- PM2 não iniciado;
- PM2 não reiniciado;
- `server.js` não executado;
- WhatsApp não inicializado;
- nenhuma mensagem enviada;
- Firebase não alterado;
- nenhum deploy, commit ou push.

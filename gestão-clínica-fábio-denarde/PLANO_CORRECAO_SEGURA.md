# PLANO DE CORRECAO SEGURA

Data: 2026-06-04

Objetivo: reduzir riscos criticos sem afetar dados reais, agenda, pacientes, financeiro, relatorios ou o robo automatico de producao.

## Regras desta etapa

- Nao executar scripts que enviam WhatsApp.
- Nao executar scripts que escrevem/deletam no Firestore.
- Nao alterar `server.js` nesta primeira rodada.
- Nao reiniciar PM2.
- Nao remover arquivos fisicos de sessao WhatsApp enquanto `RoboClinica` estiver em producao.
- Manter todas as mudancas reversiveis via Git.

## Mudancas autorizadas nesta primeira rodada

### 1. Bloquear deploy inseguro

Arquivos afetados:
- `package.json`
- `safe-deploy.cjs`

Motivo:
- O script `npm run deploy` faz `git add .` e commit/push automaticamente.
- O `safe-deploy.cjs` verifica apenas arquivos staged, mas existem arquivos proibidos ja rastreados pelo Git.

Impacto esperado:
- Evitar publicacao acidental de arquivos sensiveis.
- Obrigar uso de `safe-deploy`.
- Fazer `safe-deploy` falhar se houver arquivos proibidos rastreados ou staged.

Riscos:
- Baixo. Afeta apenas fluxo de deploy manual.

Rollback:
- Reverter `package.json` e `safe-deploy.cjs`.

Validacao:
- `npm run lint`
- `npm run build`
- `node safe-deploy.cjs` nao sera executado agora porque pode iniciar fluxo de deploy/publicacao.

### 2. Exigir confirmacao explicita para scripts manuais de WhatsApp

Arquivos afetados:
- `force-send-reminders.js`
- `send-test-whatsapp.js`

Motivo:
- Ambos podem enviar mensagens reais fora do cron.

Impacto esperado:
- Execucao manual acidental passa a falhar antes de inicializar WhatsApp.
- `server.js` de producao permanece intocado.

Riscos:
- Baixo para producao.
- Medio para suporte manual, pois agora exige variavel de ambiente explicita.

Rollback:
- Reverter os dois arquivos.

Validacao:
- Rodar os scripts sem a variavel de confirmacao e confirmar que encerram sem conectar ao WhatsApp.
- Nao rodar com confirmacao nesta fase.

### 3. Exigir confirmacao explicita para scripts destrutivos/admin

Arquivos afetados:
- `delete-celso.js`
- `scratch/fix_celso.js`
- `scratch/create_june_sessions.js`

Motivo:
- Esses scripts alteram ou deletam dados reais.

Impacto esperado:
- Execucao acidental passa a falhar antes de abrir credencial Admin SDK.

Riscos:
- Baixo para producao.

Rollback:
- Reverter os arquivos.

Validacao:
- Rodar sem confirmacao e confirmar saida segura, sem acessar banco.

### 4. Remover do indice Git arquivos sensiveis ja rastreados

Arquivos afetados:
- Indice Git somente, sem apagar arquivos fisicos.

Motivo:
- `.wwebjs_auth_temp` e `.wwebjs_cache` aparecem em `git ls-files`.

Impacto esperado:
- Proximo commit removera esses arquivos do repositorio.
- Arquivos continuam no disco local, preservando operacao local.

Riscos:
- Baixo no ambiente local.
- Alto no historico remoto se ja tiverem sido publicados: exige plano posterior de limpeza de historico e rotacao de sessao.

Rollback:
- `git restore --staged <arquivos>` antes do commit.

Validacao:
- `git ls-files | rg ".wwebjs_auth|.wwebjs_cache"` deve retornar vazio apos commit/limpeza.

## Itens que permanecem bloqueados

- Rotacionar chave Firebase Admin SDK: exige janela operacional e confirmacao.
- Rotacionar sessao WhatsApp: pode derrubar o robo e exigir novo QR Code.
- Alterar persistencia em `App.tsx`: exige testes de regressao amplos.
- Alterar logica de mensagens em `server.js` ou `src/lib/utils.ts`: exige dry-run e comparacao de destinatarios.
- Executar migracoes no Firestore: exige backup verificado.

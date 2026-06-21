# TESTES EXECUTADOS

| Comando | Finalidade | Resultado |
|---|---|---|
| `npm run test:wpp:operational` | Objeto normalizado, sanitização, documento diário, persistência, listener, preview e regras | **9/9 aprovados** |
| `npm run test:google-photos-albums` | Galeria, data, ausência de autosave, sessões duplas, cache, Portal e permissões | **27/27 aprovados** |
| `node --test tests/legacy-activity-ui-retirement.test.mjs` | Navegação, logo, painel compartilhado e perfis | **10/10 aprovados** |
| `npm run check:wpp:architecture` | Separação entre sender, scheduler e watchdog | **Aprovado** |
| `npm run test:activity-gallery` | Galeria e Registros de Atividades | **34/34 aprovados** |
| `TZ=America/Sao_Paulo npm run test:wpp:offline` | Operação offline do WhatsApp, sem robô e sem envio | **47/47 + 9/9 aprovados** |
| `npm run lint` | TypeScript sem emissão | **Aprovado** |
| `node --check server.js` | Sintaxe do sender | **Aprovado** |
| `npm run build` | Build Vite | **Aprovado — 3.228 módulos** |
| Preview seguro temporário na cópia de validação | Servir preview isolado | **HTTP 200** |
| Scan do entrypoint temporário transformado | Conferir imports proibidos | **0 imports de Firebase; banner presente** |

## Observação sobre fuso do teste offline

Uma primeira execução de `npm run test:wpp:offline` no sandbox UTC apresentou 1 falha em teste preexistente de janela horária. O helper cria a janela no fuso local da máquina, enquanto o caso de teste usa `-03:00`. A bateria foi repetida com `TZ=America/Sao_Paulo` e passou integralmente. O código sensível do agendamento não foi modificado nesta etapa.

## Testes que não foram executados

- `npm run test-wpp`.
- `npm run test-msg`.
- Aplicação principal autenticada.
- Qualquer teste conectado ao Firebase real.
- Qualquer rotina real do robô.
- Deploy de regras ou frontend.

## Build e arquivo temporário

Como o pacote seguro omitia `firebase-applet-config.json`, foi usado um arquivo fictício exclusivamente para TypeScript/build. Ele não continha credenciais, não acessou rede e foi removido da entrega.

## Garantias

- Nenhuma mensagem real foi enviada.
- O robô não foi iniciado.
- O Firebase real não foi lido nem gravado.
- Nenhum commit, push ou deploy foi executado.

---

## Bateria após ajustes adicionais de interface

- `npm run test:wpp:operational` — 8 testes aprovados.
- `npm run test:google-photos-albums` — 28 testes aprovados.
- `node --test tests/legacy-activity-ui-retirement.test.mjs` — 10 testes aprovados.
- `npm run check:wpp:architecture` — aprovado.
- `npm run test:activity-gallery` — 35 testes aprovados.
- `npm run test:activity-records` — 95 testes aprovados.
- `npm run test:responsible-portal` — 20 testes aprovados.
- `TZ=America/Sao_Paulo npm run test:wpp:offline` — 47 + 9 testes aprovados.
- `node --check server.js` — aprovado.
- `npm run lint` — TypeScript aprovado.
- `npm run build` — aprovado, 3.228 módulos transformados.

**Total automatizado:** 252 testes aprovados, sem falhas, cancelamentos ou itens ignorados.


---

## Bateria após o reajuste expansível de “Pacotes para renovar”

- `npm run test:wpp:operational` — 8/8.
- `npm run test:google-photos-albums` — 28/28.
- `node --test tests/legacy-activity-ui-retirement.test.mjs` — 10/10.
- `npm run check:wpp:architecture` — aprovado.
- `npm run test:activity-gallery` — 35/35, incluindo estado recolhido, alternância e acessibilidade do detalhamento.
- `npm run test:activity-records` — 95/95.
- `npm run test:responsible-portal` — 20/20.
- `TZ=America/Sao_Paulo npm run test:wpp:offline` — 47/47 + 9/9.
- `node --check server.js` — aprovado.
- `npm run lint` — TypeScript aprovado.
- `npm run build` — aprovado, 3.228 módulos transformados.

**Total automatizado:** 252 testes aprovados, sem falhas, cancelamentos ou itens ignorados.

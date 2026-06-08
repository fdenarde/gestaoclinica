# Skills Profissionais — Gestão Clínica Neuropsicopedagógica

Este pacote contém Skills em formato Markdown para orientar o Codex, OpenCode, Cursor ou outro agente de IA durante alterações no projeto.

## Objetivo

Ajudar a evoluir o sistema com segurança, preservando:

- lógica de agenda;
- pacientes;
- sessões;
- pacotes;
- pagamentos;
- status;
- relatórios;
- robô WhatsApp;
- dados reais;
- sincronismo entre abas.

## Importante

Estes arquivos são apenas documentação e instruções.

Eles não executam código.
Eles não alteram Firebase.
Eles não enviam WhatsApp.
Eles não mudam componentes.
Eles não fazem deploy.
Eles não modificam banco de dados.

## Estrutura

```text
skills/
├── universais/
│   ├── auditor-risco.md
│   ├── backup-rollback.md
│   ├── backend-seguro.md
│   ├── deploy-seguro.md
│   ├── frontend-premium.md
│   ├── qa-regressao.md
│   ├── ui-ux-conservadora.md
│   └── versionamento.md
│
└── clinica/
    ├── agenda-clinica.md
    ├── guardiao-logica-clinica.md
    ├── pacientes-prontuario.md
    ├── pagamentos-clinica.md
    ├── sincronismo-agenda-sessoes-pagamentos.md
    └── whatsapp-seguro.md
```

## Como usar no Codex

Antes de pedir qualquer alteração, diga ao Codex quais Skills ele deve considerar.

Exemplo:

```text
Antes de alterar qualquer arquivo, leia e siga estas Skills:
- skills/universais/auditor-risco.md
- skills/universais/ui-ux-conservadora.md
- skills/clinica/guardiao-logica-clinica.md
- skills/clinica/sincronismo-agenda-sessoes-pagamentos.md

Objetivo:
Melhorar apenas a interface da Aba Pagamentos, sem alterar regra de negócio, contagem de sessões, pacotes, status, agenda, dados reais ou robô WhatsApp.
```

## Recomendação

Para o projeto da clínica, nunca peça:
"melhore tudo".

Prefira pedidos por módulo:

- "melhore apenas a Aba Pagamentos";
- "melhore apenas o modal da Agenda";
- "analise o robô WhatsApp sem enviar mensagens";
- "melhore apenas a responsividade";
- "audite o sincronismo entre Agenda, Sessões e Pagamentos".

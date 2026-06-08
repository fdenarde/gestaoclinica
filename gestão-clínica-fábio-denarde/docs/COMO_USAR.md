# Como usar este pacote no projeto

## 1. Baixar o ZIP

Baixe o arquivo ZIP gerado pelo ChatGPT.

## 2. Descompactar

Clique com o botão direito no arquivo `.zip` e escolha:

```text
Extrair tudo...
```

ou use o 7-Zip/WinRAR.

## 3. Copiar para dentro da pasta do projeto

Depois de descompactar, você verá uma pasta parecida com:

```text
skills_gestao_clinica_fabio/
```

Dentro dela haverá:

```text
skills/
prompts/
checklists/
docs/
README.md
```

Copie essas pastas para dentro da raiz do seu projeto.

Exemplo:

```text
gestao-clinica-fabio-denarde/
├── src/
├── public/
├── package.json
├── PROJECT_CONTEXT.md
├── skills/
├── prompts/
├── checklists/
└── docs/
```

## 4. O que pode copiar sem medo

Estas pastas são apenas documentação:

```text
skills/
prompts/
checklists/
docs/
README.md
```

Elas não substituem arquivos do sistema.

## 5. O que não deve substituir automaticamente

Nunca substitua sem análise:

```text
src/
public/
server.js
firebase.json
package.json
package-lock.json
whatsapp/
functions/
```

## 6. Como chamar o Codex com segurança

Use um prompt como este:

```text
Antes de alterar qualquer arquivo, leia:
- PROJECT_CONTEXT.md
- skills/universais/auditor-risco.md
- skills/universais/qa-regressao.md
- skills/clinica/guardiao-logica-clinica.md
- skills/clinica/sincronismo-agenda-sessoes-pagamentos.md

Tarefa:
[descreva aqui a tarefa]

Regras:
- Não fazer deploy.
- Não enviar WhatsApp.
- Não alterar Firebase sem autorização.
- Não alterar dados reais.
- Antes de editar, listar os arquivos que pretende alterar.
- Se houver risco de quebrar sincronismo, parar e explicar.
```

## 7. Fluxo recomendado para qualquer melhoria

1. Pedir análise sem alterar.
2. Conferir os riscos.
3. Autorizar alteração pequena.
4. Testar os fluxos principais.
5. Só depois pensar em deploy.

## 8. Regra de segurança

Para o seu sistema da clínica, qualquer alteração em Agenda, Sessões, Pagamentos ou Robô WhatsApp deve ser tratada como crítica.

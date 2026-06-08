# Prompt para pedir ao Codex instalar as Skills no projeto

Use este prompt se você quiser que o Codex apenas crie/copiem as pastas de documentação, sem alterar o sistema.

```text
Crie ou copie para a raiz do projeto apenas as pastas de documentação abaixo, se ainda não existirem:

- skills/
- prompts/
- checklists/
- docs/

Importante:
- Não alterar nenhum arquivo dentro de src/.
- Não alterar public/.
- Não alterar package.json.
- Não alterar package-lock.json.
- Não alterar firebase.json.
- Não alterar server.js.
- Não alterar banco de dados.
- Não alterar Firebase.
- Não fazer deploy.
- Não enviar WhatsApp.
- Não inicializar WhatsApp.
- Não gerar QR Code.

Objetivo:
Apenas adicionar documentação de Skills para orientar futuras alterações do projeto.

Depois de criar/copiar, informe:
1. Pastas criadas.
2. Arquivos adicionados.
3. Confirmação de que nenhum código do sistema foi alterado.
4. Confirmação de que nenhum deploy foi feito.
5. Confirmação de que nenhum WhatsApp foi enviado.
```

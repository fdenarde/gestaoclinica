# Integração privada com Google Drive

Esta integração armazena as fotos dos atendentes no Google Drive e mantém no Firestore apenas os identificadores necessários.

## Arquitetura

- O frontend nunca recebe o segredo OAuth nem o refresh token.
- A rota privada `api/drive.js` valida o token do Firebase Authentication.
- Os arquivos permanecem privados no Google Drive.
- A exibição usa endereços temporários assinados, válidos por aproximadamente 10 minutos.
- Fotos aceitas: JPG, PNG e WEBP, com limite de 2,5 MB.
- O robô do WhatsApp continua isolado no `server.js` e não foi alterado.

## Variáveis necessárias

Copie `.env.example` para `.env` e preencha inicialmente:

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`

Depois execute `npm run setup:drive`. O script abrirá o navegador para autorização e preencherá automaticamente no `.env`:

- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`
- `DRIVE_FILE_SIGNING_SECRET`

Na Vercel, também configure as credenciais do Firebase Admin por `FIREBASE_SERVICE_ACCOUNT_JSON` ou pelos três campos separados indicados no `.env.example`.

## Testes disponíveis

- `npm run test:drive`: confirma acesso à pasta do Drive sem enviar ou alterar arquivos.
- `npm run lint`: valida o TypeScript.
- `npm run build`: gera a versão de produção.
- `npm run dev`: inicia simultaneamente a API local do Drive e o Vite.

## Segurança

Nunca versione ou envie:

- `.env`
- `firebase-key.json`
- client secret real
- refresh token
- chave privada do Firebase Admin

O arquivo `.env.example` contém somente nomes e valores vazios.

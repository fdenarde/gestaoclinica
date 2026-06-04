import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import { getFirestore } from 'firebase-admin/firestore';
import qrcode from 'qrcode-terminal';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

if (process.env.ALLOW_REAL_WHATSAPP_SEND !== 'SIM') {
    console.error('BLOQUEADO: este script envia WhatsApp real.');
    console.error('Para executar conscientemente, defina ALLOW_REAL_WHATSAPP_SEND=SIM e informe o numero de destino.');
    process.exit(1);
}

if (!process.argv[2]) {
    console.error('BLOQUEADO: informe explicitamente o numero de destino. O fallback para settings.whatsapp foi desativado por seguranca.');
    process.exit(1);
}

// Inicializar Firebase Admin
const serviceAccountPath = path.resolve('./firebase-key.json');

if (!fs.existsSync(serviceAccountPath)) {
    console.error("ERRO: Arquivo firebase-key.json não encontrado.");
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Usando o Database ID correto
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

// Inicializar WhatsApp
console.log("Iniciando o WhatsApp para o teste (isso pode levar alguns segundos)...");
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('\n--- SCANNEIE O QR CODE ABAIXO ---');
    qrcode.generate(qr, { small: true });
});

let testExecuted = false;

async function executeTest() {
    if (testExecuted) return;
    testExecuted = true;
    
    console.log('\n✅ WhatsApp Conectado com sucesso!');
    console.log('Buscando seu número de telefone configurado no sistema...');
    
    try {
        // Usar collectionGroup porque o documento do usuário pode não ter campos, apenas subcoleções
        const settingsConfigSnapshot = await db.collectionGroup('settings').get();
        if (settingsConfigSnapshot.empty) {
            console.log("❌ Nenhuma configuração encontrada no banco de dados.");
            process.exit(1);
        }
        
        // Pega o primeiro usuário encontrado (o dono da clínica)
        const configDoc = settingsConfigSnapshot.docs[0];
        const settings = configDoc.data();
        
        let targetNumber = process.argv[2]; // Pega o número passado no comando, se houver
        
        if (!targetNumber) {
            if (!settings.whatsapp) {
                console.log("❌ Número de WhatsApp não informado e não encontrado nos Ajustes!");
                console.log("Uso: npm run test-wpp -- 27999999999");
                process.exit(1);
            }
            targetNumber = settings.whatsapp;
            console.log(`Nenhum número especificado. Usando o número dos Ajustes: ${targetNumber}`);
        }

        let cleanStr = targetNumber.replace(/\D/g, '');
        if (!cleanStr.startsWith('55')) cleanStr = '55' + cleanStr;
        const phone = `${cleanStr}@c.us`;

        console.log(`\nEnviando mensagem de teste para o número: ${targetNumber}...`);
        
        const saudacao = new Date().getHours() < 12 ? 'Bom dia' : 'Boa tarde';
        const mensagem = `🤖 *Simulação de Lembrete (Robô)*\n\n${saudacao}! Aguardo vocês hoje às 14:00!\nAté logo! 🙏`;
        
        await client.sendMessage(phone, mensagem);
        
        console.log("\n🚀 MENSAGEM ENVIADA COM SUCESSO!");
        console.log("Verifique o seu WhatsApp no celular. Fechando o script de teste...");
        
        // Espera 3 segundos para garantir o envio antes de desligar
        setTimeout(() => process.exit(0), 3000);
        
    } catch (error) {
        console.error("Erro durante o envio:", error);
        process.exit(1);
    }
}

client.on('ready', () => {
    executeTest();
});

// Bypass para o bug do WhatsApp: se ele autenticar mas nunca disparar o "ready", nós forçamos o disparo após 15 segundos
client.on('authenticated', () => {
    console.log('\n✅ Sessão Autenticada! Aguardando o WhatsApp carregar as conversas (bypass de 15s)...');
    setTimeout(executeTest, 15000);
});

client.on('auth_failure', () => {
    console.error('❌ Falha na autenticação do WhatsApp. Você pode precisar escanear o QR Code novamente.');
    process.exit(1);
});

client.initialize();

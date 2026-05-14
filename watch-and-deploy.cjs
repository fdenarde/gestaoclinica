const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configurações
const PROJECT_DIR = path.resolve(__dirname, 'gestão-clínica-fábio-denarde');
const WAIT_TIME = 10000; // 10 segundos de espera após a última alteração

let timeoutId = null;

console.log('Monitor de Auto-Deploy iniciado...');
console.log(`Monitorando alterações em: ${PROJECT_DIR}`);

// Função para executar o deploy
function runDeploy() {
    console.log(`[${new Date().toLocaleTimeString()}] Alteração detectada! Iniciando deploy automático...`);
    
    // Comando que faz build e push
    // Usamos um comando que não falha se não houver nada para commitar
    const command = 'git add . && (git commit -m "Auto-deploy: manual change detected" || echo "Sem alterações para commitar") && git push origin main';
    
    exec(command, { cwd: path.resolve(__dirname), windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Erro no deploy: ${error.message}`);
            return;
        }
        if (stderr) {
            console.log(`⚠️ Log Git: ${stderr}`);
        }
        console.log(`✅ Deploy concluído com sucesso!\n${stdout}`);
        console.log('Aguardando próximas alterações...');
    });
}

// Monitorando a pasta do projeto inteira
fs.watch(PROJECT_DIR, { recursive: true }, (eventType, filename) => {
    // Ignorar pastas de sistema e cache
    if (filename && !filename.includes('node_modules') && !filename.includes('.git') && !filename.includes('.wwebjs_')) {
        console.log(`[LOG] Alteração detectada no arquivo: ${filename}`);
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(runDeploy, WAIT_TIME);
    }
});

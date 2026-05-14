const { spawn } = require('child_process');
const path = require('path');

console.log('Iniciando o servidor frontend...');

const child = spawn('npm.cmd', ['run', 'dev'], { 
    stdio: 'inherit', 
    shell: true,
    windowsHide: true,
    cwd: path.resolve(__dirname)
});

child.on('error', (err) => {
    console.error('Erro ao iniciar o processo:', err);
});

child.on('exit', (code) => {
    console.log(`O servidor frontend encerrou com o código ${code}`);
    process.exit(code);
});

/**
 * safe-deploy.cjs — Publicação segura do sistema
 * 
 * Uso: node safe-deploy.cjs
 * Ou clique em PublicarSistema.bat
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const GIT_ROOT = (() => {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  } catch { return ROOT; }
})();
const PRIMARY_URL = 'https://gestaoclinica-solucoes.vercel.app/';
const BACKUP_URL = 'https://fdenarde.github.io/gestaoclinica/';

const HORIZONTAL_RULE = '═'.repeat(60);

// ── Arquivos/pastas PROIBIDOS de serem commitados ──────────────────
const FORBIDDEN = [
  '.wwebjs_auth',
  '.wwebjs_cache',
  '.wwebjs_auth_temp',
  'node_modules',
  'firebase-key.json',
  'firebase-key - Copia e seguranca do robo whatsapp.json',
  '.env',
  'dist',
];

// ── Extensões de arquivos que DEVEM ser commitados ────────────────
const ALLOWED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs',
  '.json', '.css', '.html', '.svg', '.png', '.ico',
  '.bat', '.sh', '.md', '.txt', '.wav', '.mp3',
  '.rules', '.gitignore', '.nojekyll',
]);

// ── Cores para o terminal (ANSI) ───────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(tag, msg, color = C.reset) {
  const time = new Date().toLocaleTimeString('pt-BR');
  console.log(`${C.dim}[${time}]${C.reset} ${color}${C.bold}[${tag}]${C.reset} ${msg}`);
}

function ok(msg)   { log('OK', msg, C.green); }
function warn(msg) { log('AVISO', msg, C.yellow); }
function err(msg)  { log('ERRO', msg, C.red); }
function info(msg) { log('INFO', msg, C.blue); }
function step(msg) { console.log(`\n${C.magenta}${C.bold}▶ ${msg}${C.reset}\n`); }

function esperarTecla(code) {
  if (process.stdin.isTTY) {
    console.log('Pressione qualquer tecla para sair...');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', () => process.exit(code));
  } else {
    process.exit(code);
  }
}

function fail(msg) {
  console.log(`\n${C.red}${HORIZONTAL_RULE}${C.reset}`);
  console.log(`${C.red}${C.bold}  FALHA NA PUBLICACAO${C.reset}`);
  console.log(`${C.red}  ${msg}${C.reset}`);
  console.log(`${C.red}${HORIZONTAL_RULE}${C.reset}\n`);
  console.log('O sistema NAO foi publicado. Corrija o problema e tente novamente.');
  esperarTecla(1);
}

function run(cmd, cwd = ROOT) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();
  } catch (e) {
    return null;
  }
}

function runRequired(cmd, label, cwdOverride = null) {
  const cwd = cwdOverride || ROOT;
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();
    return out;
  } catch (e) {
    fail(`${label} falhou:\n${e.stderr || e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// ETAPA 1: Verificar arquivos sensíveis
// ─────────────────────────────────────────────────────────────────────
function etapaVerificarSensiveis() {
  step('ETAPA 1/6: Verificando arquivos sensiveis...');

  const gitRoot = GIT_ROOT;
  if (!gitRoot) {
    warn('Nao foi possivel detectar a raiz do Git. Pulando verificacao avancada.');
    return;
  }

  const staged = run('git diff --cached --name-only', GIT_ROOT);
  if (!staged) {
    info('Nenhum arquivo staged.');
    return;
  }

  const stagedFiles = staged.split('\n').filter(Boolean);
  const foundForbidden = [];

  for (const file of stagedFiles) {
    const normalized = file.replace(/\\/g, '/');
    for (const forbid of FORBIDDEN) {
      if (normalized.includes(forbid)) {
        foundForbidden.push(file);
      }
    }
  }

  if (foundForbidden.length > 0) {
    console.log(`  ${C.red}ARQUIVOS PROIBIDOS ENCONTRADOS NO STAGE:${C.reset}`);
    foundForbidden.forEach(f => console.log(`    ${C.red}✗${C.reset} ${f}`));
    fail('Arquivos sensiveis estao staged. Remova-os com "git reset" antes de publicar.');
  }

  ok('Nenhum arquivo sensivel detectado.');
}

// ─────────────────────────────────────────────────────────────────────
// ETAPA 2: Rodar lint (TypeScript check)
// ─────────────────────────────────────────────────────────────────────
function etapaLint() {
  step('ETAPA 2/6: Rodando validacao de codigo (TypeScript)...');
  info('Executando: npm run lint');

  const result = run('npm run lint');
  if (result === null) {
    fail('A validacao TypeScript falhou. Verifique os erros acima e corrija antes de publicar.');
  }

  ok('Validacao TypeScript passou sem erros.');
}

// ─────────────────────────────────────────────────────────────────────
// ETAPA 3: Build do frontend
// ─────────────────────────────────────────────────────────────────────
function etapaBuild() {
  step('ETAPA 3/6: Gerando build do frontend...');
  info('Executando: npm run build');

  const buildOut = run('npm run build');
  if (buildOut === null) {
    fail('O build falhou. Verifique os erros acima e corrija antes de publicar.');
  }

  // Verify build output exists
  const indexPath = path.join(DIST, 'index.html');
  if (!fs.existsSync(indexPath)) {
    fail('Build concluido mas dist/index.html nao foi encontrado.');
  }

  // Count built files
  const countFiles = (dir) => {
    let count = 0;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) {
        count += countFiles(full);
      } else {
        count++;
      }
    }
    return count;
  };

  const totalFiles = countFiles(DIST);
  ok(`Build gerado com sucesso (${totalFiles} arquivos em dist/).`);
}

// ─────────────────────────────────────────────────────────────────────
// ETAPA 4: Resumo do que sera publicado
// ─────────────────────────────────────────────────────────────────────
function etapaResumo() {
  step('ETAPA 4/6: Resumo do que sera publicado...');

  // Show git status
  const status = run('git status --short', GIT_ROOT);
  if (status && status.trim()) {
    console.log(`  ${C.yellow}Arquivos alterados (serao commitados):${C.reset}`);
    status.split('\n').filter(Boolean).forEach(line => {
      const color = line.startsWith(' M') || line.startsWith('M ') ? C.yellow :
                    line.startsWith('??') ? C.green :
                    line.startsWith(' D') || line.startsWith('D ') ? C.red : C.reset;
      console.log(`    ${color}${line}${C.reset}`);
    });
  } else {
    console.log('  Nenhum arquivo alterado para commit.');
  }

  console.log('');
  console.log(`  ${C.bold}Links apos publicacao:${C.reset}`);
  console.log(`  ${C.blue}${C.bold}Principal → ${PRIMARY_URL}${C.reset}`);
  console.log(`  ${C.dim}Reserva  → ${BACKUP_URL}${C.reset}`);
  console.log('');
  info(`Vercel fara deploy automatico ao receber o push no GitHub.`);
  info(`GitHub Pages atualizado como reserva via gh-pages.`);
}

// ─────────────────────────────────────────────────────────────────────
// ETAPA 5: Verificar se ha arquivos proibidos NO DIRETORIO INTEIRO
// ─────────────────────────────────────────────────────────────────────
function etapaVerificarDiretorio() {
  step('ETAPA 5/6: Verificacao final de seguranca...');

  // Check gitignore is protecting sensitive files
  const gitignorePath = path.join(GIT_ROOT, '.gitignore');
  const gitignore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  
  const checks = [
    { pattern: 'firebase-key', label: 'firebase-key.json no .gitignore' },
    { pattern: '.wwebjs', label: '.wwebjs_auth no .gitignore' },
    { pattern: 'node_modules', label: 'node_modules no .gitignore' },
    { pattern: 'dist/', label: 'dist/ no .gitignore' },
    { pattern: '.env', label: '.env no .gitignore' },
  ];

  let allProtected = true;
  for (const check of checks) {
    if (gitignore.includes(check.pattern)) {
      console.log(`  ${C.green}✓${C.reset} ${check.label}`);
    } else {
      console.log(`  ${C.red}✗${C.reset} ${check.label} — ATENCAO: pode nao estar protegido`);
      allProtected = false;
    }
  }

  if (!allProtected) {
    warn('Alguns arquivos podem nao estar no .gitignore. A publicacao continuara, mas revise.');
  } else {
    ok('Todos os arquivos sensiveis estao protegidos pelo .gitignore.');
  }
}

// ─────────────────────────────────────────────────────────────────────
// ETAPA 6: Publicar
// ─────────────────────────────────────────────────────────────────────
function etapaPublicar() {
  step('ETAPA 6/6: Publicando sistema...');

  // 6a: Deploy to gh-pages (backup)
  info('Atualizando GitHub Pages (reserva)...');
  const ghPagesOut = run('npx gh-pages -d dist');
  if (ghPagesOut === null) {
    warn('GitHub Pages (reserva) nao foi atualizado. O link principal (Vercel) funcionara normalmente.');
  } else {
    ok('GitHub Pages (reserva) atualizado.');
  }

  // 6b: Commit and push source changes (only if there are changes)
  const hasChanges = run('git status --porcelain', GIT_ROOT);
  if (hasChanges && hasChanges.trim()) {
    info('Commitando alteracoes do codigo fonte...');
    
    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR');
    const timeStr = now.toLocaleTimeString('pt-BR');
    const commitMsg = `Deploy seguro — ${dateStr} ${timeStr}`;
    
    runRequired('git add -A', 'git add', GIT_ROOT);
    
    // Double-check forbidden files after add
    const stagedAfter = run('git diff --cached --name-only', GIT_ROOT);
    if (stagedAfter) {
      const forbidden = stagedAfter.split('\n').filter(Boolean).filter(f => {
        const n = f.replace(/\\/g, '/');
        return FORBIDDEN.some(forbid => n.includes(forbid));
      });
      if (forbidden.length > 0) {
        // Unstage forbidden files
        for (const f of forbidden) {
          run(`git reset HEAD -- "${f}"`, GIT_ROOT);
          warn(`Arquivo removido do stage por seguranca: ${f}`);
        }
      }
    }
    
    runRequired(`git commit -m "${commitMsg}"`, 'git commit', GIT_ROOT);
    ok(`Commit criado: "${commitMsg}"`);

    info('Enviando para o GitHub (git push)...');
    runRequired('git push origin main', 'git push', GIT_ROOT);
    ok('Codigo fonte enviado para o GitHub.');
  } else {
    info('Nenhum arquivo alterado para commitar. Apenas o GitHub Pages foi atualizado.');
  }
}

// ─────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────
function main() {
  console.clear();
  console.log(`\n${C.blue}${C.bold}${HORIZONTAL_RULE}${C.reset}`);
  console.log(`${C.blue}${C.bold}  PUBLICACAO SEGURA DO SISTEMA${C.reset}`);
  console.log(`${C.blue}${C.bold}  Gestao Clinica — Fabio Denarde${C.reset}`);
  console.log(`${C.blue}${C.bold}${HORIZONTAL_RULE}${C.reset}\n`);
  console.log(`  Link principal (Vercel): ${C.blue}${PRIMARY_URL}${C.reset}`);
  console.log(`  Link reserva  (GitHub): ${C.dim}${BACKUP_URL}${C.reset}`);
  console.log(`  Metodo: Vercel (deploy automatico ao fazer push) + GitHub Pages (reserva)\n`);
  console.log(`${C.dim}  Nao feche esta janela ate o processo terminar.${C.reset}\n`);

  try {
    etapaVerificarSensiveis();
    etapaLint();
    etapaBuild();
    etapaResumo();
    etapaVerificarDiretorio();
    etapaPublicar();

    // Success!
    console.log(`\n${C.green}${C.bold}${HORIZONTAL_RULE}${C.reset}`);
    console.log(`${C.green}${C.bold}  PUBLICACAO CONCLUIDA COM SUCESSO!${C.reset}`);
    console.log(`${C.green}${HORIZONTAL_RULE}${C.reset}\n`);
    console.log(`  ${C.bold}Acesse o sistema em:${C.reset}`);
    console.log(`  ${C.blue}${C.bold}  → ${PRIMARY_URL}${C.reset}\n`);
    console.log(`  ${C.dim}O Vercel detecta o push e publica automaticamente.${C.reset}`);
    console.log(`  ${C.dim}(Pode levar ate 1 minuto para aparecer no ar)${C.reset}\n`);
    console.log(`  ${C.dim}Link reserva (GitHub Pages): ${BACKUP_URL}${C.reset}\n`);
    esperarTecla(0);
  } catch (e) {
    fail(`Erro inesperado: ${e.message}`);
  }
}

main();

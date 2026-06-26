const ACCESS_USERNAME_MIN_LENGTH = 3;
const ACCESS_USERNAME_MAX_LENGTH = 20;
const MANAGED_AUTH_DOMAIN = 'login.gestaoclinica.invalid';

const RESERVED_ACCESS_USERNAMES = new Set([
  'admin',
  'administrador',
  'api',
  'app',
  'firebase',
  'gestao',
  'gestaoclinica',
  'login',
  'monitoramento',
  'profissional',
  'responsavel',
  'root',
  'suporte',
  'sistema',
]);

export function normalizeAccessUsername(value) {
  return String(value || '').trim().toLowerCase();
}

export function accessUsernameValidationError(value) {
  const username = normalizeAccessUsername(value);
  if (!username) return 'Informe um nome de usuário.';
  if (username.length < ACCESS_USERNAME_MIN_LENGTH || username.length > ACCESS_USERNAME_MAX_LENGTH) {
    return `O nome de usuário deve ter entre ${ACCESS_USERNAME_MIN_LENGTH} e ${ACCESS_USERNAME_MAX_LENGTH} caracteres.`;
  }
  if (!/^[a-z][a-z0-9._-]*[a-z0-9]$/.test(username)) {
    return 'Use letras minúsculas, números, ponto, hífen ou sublinhado. Comece com uma letra e termine com letra ou número.';
  }
  if (username.includes('..') || username.includes('--') || username.includes('__')) {
    return 'Não use dois pontos, hífens ou sublinhados consecutivos.';
  }
  if (RESERVED_ACCESS_USERNAMES.has(username)) {
    return 'Este nome de usuário é reservado. Escolha outro.';
  }
  return '';
}

export function assertAccessUsername(value) {
  const username = normalizeAccessUsername(value);
  const validationError = accessUsernameValidationError(username);
  if (validationError) {
    const error = new Error(validationError);
    error.code = 'access/invalid-username';
    throw error;
  }
  return username;
}

function encodeUsernameForEmail(username) {
  return [...username].map(character => {
    if (/^[a-z0-9]$/.test(character)) return character;
    if (character === '.') return '_d';
    if (character === '_') return '_u';
    return '_h';
  }).join('');
}

export function usernameToManagedAuthEmail(value) {
  const username = assertAccessUsername(value);
  return `u_${encodeUsernameForEmail(username)}@${MANAGED_AUTH_DOMAIN}`;
}

export function isManagedAuthEmail(value) {
  return String(value || '').trim().toLowerCase().endsWith(`@${MANAGED_AUTH_DOMAIN}`);
}

export function directAccessPathForRole(role) {
  if (role === 'responsible') return '/responsavel';
  if (role === 'monitoring') return '/monitoramento';
  return '/profissional';
}

export const ACCESS_USERNAME_RULES = Object.freeze({
  minLength: ACCESS_USERNAME_MIN_LENGTH,
  maxLength: ACCESS_USERNAME_MAX_LENGTH,
});

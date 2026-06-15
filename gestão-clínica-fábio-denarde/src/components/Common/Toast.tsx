export type ToastType = 'success' | 'error' | 'info' | 'warning';

const TOAST_STYLES: Record<ToastType, string> = {
  success: 'bg-status-green-text text-white',
  error: 'bg-status-red-text text-white',
  info: 'bg-clinic-primary text-white',
  warning: 'bg-amber-400 text-slate-950',
};

const TOAST_ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '×',
  info: 'i',
  warning: '!',
};

const TOAST_DURATION_MS: Record<ToastType, number> = {
  success: 8000,
  info: 10000,
  warning: 12000,
  error: 12000,
};

export function showToast(message: string, type: ToastType = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `
    pointer-events-auto min-w-[250px] max-w-[min(24rem,calc(100vw-2rem))] rounded-lg px-4 py-3 shadow-xl
    transform translate-y-10 opacity-0 transition-all duration-300 flex items-start gap-3
    ${TOAST_STYLES[type]}
  `;
  toast.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' || type === 'warning' ? 'assertive' : 'polite');
  toast.setAttribute('aria-atomic', 'true');

  const icon = document.createElement('span');
  icon.className = 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current/60 text-sm font-black';
  icon.textContent = TOAST_ICONS[type];
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'min-w-0 flex-1 break-words text-sm font-bold leading-relaxed';
  text.textContent = message;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current/40 text-base font-black leading-none';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', 'Fechar notificação');
  closeButton.title = 'Fechar notificação';

  toast.append(icon, text, closeButton);
  container.appendChild(toast);

  let dismissTimer = 0;
  let removed = false;

  const dismiss = () => {
    if (removed) return;
    removed = true;
    window.clearTimeout(dismissTimer);
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-10', 'opacity-0');
    window.setTimeout(() => toast.remove(), 300);
  };

  const startTimer = () => {
    window.clearTimeout(dismissTimer);
    dismissTimer = window.setTimeout(dismiss, TOAST_DURATION_MS[type]);
  };

  const pauseTimer = () => window.clearTimeout(dismissTimer);

  closeButton.addEventListener('click', dismiss);
  toast.addEventListener('mouseenter', pauseTimer);
  toast.addEventListener('mouseleave', startTimer);
  toast.addEventListener('focusin', pauseTimer);
  toast.addEventListener('focusout', startTimer);

  window.setTimeout(() => {
    toast.classList.remove('translate-y-10', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
    startTimer();
  }, 10);
}

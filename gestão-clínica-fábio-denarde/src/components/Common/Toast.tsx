export function showToast(message: string, type: 'success' | 'error' = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `
    min-w-[250px] px-4 py-3 rounded-lg shadow-xl text-white transform translate-y-10 opacity-0 transition-all duration-300 flex items-center gap-3
    ${type === 'success' ? 'bg-status-green-text' : 'bg-status-red-text'}
  `;

  const text = document.createElement('span');
  text.className = 'font-medium text-sm';
  text.textContent = message;
  toast.appendChild(text);

  container.appendChild(toast);

  // Trigger animation
  setTimeout(() => {
    toast.classList.remove('translate-y-10', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
  }, 10);

  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-10', 'opacity-0');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

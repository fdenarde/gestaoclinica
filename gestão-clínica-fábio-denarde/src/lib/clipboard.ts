export async function copyTextToClipboard(text: string): Promise<void> {
  if (!String(text || '').trim()) {
    throw new Error('Não há conteúdo disponível para copiar.');
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) throw new Error('O navegador recusou a cópia.');
  } finally {
    textarea.remove();
  }
}

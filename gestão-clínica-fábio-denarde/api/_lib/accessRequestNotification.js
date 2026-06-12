const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function roleLabel(role) {
  return role === 'responsible' ? 'Responsável' : 'Profissional';
}

export async function notifyAccessRequest(input) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ACCESS_REQUEST_FROM_EMAIL?.trim();
  const to = process.env.ACCESS_REQUEST_ADMIN_EMAIL?.trim() || 'fdenarde@gmail.com';

  if (!apiKey || !from) {
    return { status: 'skipped' };
  }

  const details = [
    `<strong>Nome:</strong> ${escapeHtml(input.displayName)}`,
    `<strong>E-mail:</strong> ${escapeHtml(input.email)}`,
    `<strong>Telefone:</strong> ${escapeHtml(input.phone)}`,
    `<strong>Tipo:</strong> ${roleLabel(input.role)}`,
    input.linkedPatientName
      ? `<strong>Paciente/atendente informado:</strong> ${escapeHtml(input.linkedPatientName)}`
      : '',
    input.notes ? `<strong>Observações:</strong> ${escapeHtml(input.notes)}` : '',
  ].filter(Boolean);

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `access-request-${input.uid}-${Date.now()}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Nova solicitação de acesso: ${input.displayName}`,
      html: `
        <h2>Nova solicitação de acesso à Gestão Clínica</h2>
        <p>Um novo cadastro aguarda análise administrativa.</p>
        <p>${details.join('<br>')}</p>
        <p><small>UID Firebase: ${escapeHtml(input.uid)}</small></p>
      `,
      text: [
        'Nova solicitação de acesso à Gestão Clínica',
        `Nome: ${input.displayName}`,
        `E-mail: ${input.email}`,
        `Telefone: ${input.phone}`,
        `Tipo: ${roleLabel(input.role)}`,
        input.linkedPatientName ? `Paciente/atendente informado: ${input.linkedPatientName}` : '',
        input.notes ? `Observações: ${input.notes}` : '',
        `Identificador da solicitação: ${input.uid}`,
      ].filter(Boolean).join('\n'),
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`O provedor de e-mail recusou a notificação (${response.status}): ${responseText.slice(0, 300)}`);
  }

  const payload = await response.json();
  return { status: 'sent', id: payload?.id || null };
}

export async function notifyAccessApproval(input) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ACCESS_REQUEST_FROM_EMAIL?.trim();
  const appUrl = input.platformUrl?.trim()
    || process.env.ACCESS_PLATFORM_URL?.trim()
    || process.env.APP_URL?.trim()
    || 'https://gestaoclinica-solucoes.vercel.app';

  if (!apiKey || !from) {
    return { status: 'skipped' };
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `access-approval-${input.requestId}`,
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: 'Acesso autorizado - Denarde Soluções',
      html: `
        <p>Olá, ${escapeHtml(input.displayName)}.</p>
        <p>Seu acesso à plataforma Denarde Soluções foi autorizado.</p>
        <p>Você já pode entrar usando o e-mail informado no cadastro: <strong>${escapeHtml(input.email)}</strong>.</p>
        <p>Acesse a plataforma pelo link: <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a>.</p>
        <p>Atenciosamente,<br>Denarde Soluções</p>
      `,
      text: [
        `Olá, ${input.displayName}.`,
        '',
        'Seu acesso à plataforma Denarde Soluções foi autorizado.',
        '',
        `Você já pode entrar usando o e-mail informado no cadastro: ${input.email}`,
        '',
        `Acesse a plataforma pelo link: ${appUrl}`,
        '',
        'Atenciosamente,',
        'Denarde Soluções',
      ].join('\n'),
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`O provedor de e-mail recusou a confirmação (${response.status}): ${responseText.slice(0, 300)}`);
  }

  const payload = await response.json();
  return { status: 'sent', id: payload?.id || null };
}

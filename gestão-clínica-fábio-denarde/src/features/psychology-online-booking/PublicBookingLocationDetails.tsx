import React, { useState } from 'react';
import { Copy, MapPin } from 'lucide-react';

type LocationDetails = {
  displayName?: string;
  name?: string;
  fullAddress?: string;
  googleMapsUrl?: string;
};

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard indisponível');
}

export default function PublicBookingLocationDetails({ location, showCopy = true }: { location: LocationDetails; showCopy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const displayName = location.displayName || location.name || 'Local presencial';
  const fullAddress = location.fullAddress?.trim() || '';
  const googleMapsUrl = location.googleMapsUrl?.trim() || '';

  const handleCopy = async () => {
    if (!fullAddress) return;
    try {
      await copyText(fullAddress);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return <section className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/70 p-4 text-left" data-testid="public-booking-location-details"><div className="flex items-start gap-3"><MapPin size={20} className="mt-0.5 shrink-0 text-violet-700" /><div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Local do atendimento</p><p className="mt-1 text-base font-black text-violet-950">{displayName}</p>{fullAddress && <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-relaxed text-slate-700">{fullAddress}</p>}</div></div>{(googleMapsUrl || (showCopy && fullAddress)) && <div className="mt-4 flex flex-col gap-2 sm:flex-row"><>{googleMapsUrl && <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-black text-white transition hover:bg-violet-800" data-testid="public-booking-open-maps">Abrir no Google Maps</a>}{showCopy && fullAddress && <button type="button" onClick={() => void handleCopy()} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm font-black text-violet-800 transition hover:bg-violet-50" data-testid="public-booking-copy-address"><Copy size={16} /> {copied ? 'Endereço copiado.' : 'Copiar endereço'}</button>}</></div>}{copied && <p className="mt-2 text-xs font-bold text-emerald-700" role="status" aria-live="polite">Endereço copiado.</p>}</section>;
}

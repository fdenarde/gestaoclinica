import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, ShieldAlert } from 'lucide-react';
import { createPublicBookingApiClient } from './publicApiClient';
import type { MapsNavigationResult } from './types';

const unavailableMessage = 'Este atendimento não possui localização presencial disponível.';

function setPrivateDocumentMetadata(): void {
  document.title = 'Navegação do local · Gestão Clínica';
  let robots = document.querySelector('meta[name="robots"]');
  if (!robots) { robots = document.createElement('meta'); robots.setAttribute('name', 'robots'); document.head.appendChild(robots); }
  robots.setAttribute('content', 'noindex, nofollow');
  let referrer = document.querySelector('meta[name="referrer"]');
  if (!referrer) { referrer = document.createElement('meta'); referrer.setAttribute('name', 'referrer'); document.head.appendChild(referrer); }
  referrer.setAttribute('content', 'no-referrer');
}

export default function MapsNavigationPage({ navigationRef }: { navigationRef: string }) {
  const repository = useMemo(() => createPublicBookingApiClient(), []);
  const [result, setResult] = useState<MapsNavigationResult | null>(null);

  useEffect(() => {
    setPrivateDocumentMetadata();
    let active = true;
    void repository.getMapsNavigationDestination(navigationRef).then(next => { if (active) setResult(next); });
    return () => { active = false; };
  }, [navigationRef, repository]);

  useEffect(() => {
    if (result?.ok) window.location.replace(result.destinationUrl);
  }, [result]);

  const locationName = result && !result.ok ? result.locationName : undefined;
  const locationAddress = result && !result.ok ? result.locationAddress : undefined;
  return <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-10 text-slate-900" data-testid="maps-navigation-page">
    <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm sm:p-9" aria-live="polite">
      {result?.ok ? <><MapPin className="mx-auto h-10 w-10 text-violet-700" aria-hidden="true" /><h1 className="mt-4 text-xl font-black">Abrindo o Google Maps…</h1><p className="mt-2 text-sm text-slate-600">Você será encaminhado para o endereço atual do atendimento.</p></> : <><ShieldAlert className="mx-auto h-10 w-10 text-slate-500" aria-hidden="true" /><h1 className="mt-4 text-xl font-black">{result?.ok === false ? result.message : 'Validando o local…'}</h1>{locationName && <p className="mt-3 text-sm font-black text-slate-800">{locationName}</p>}{locationAddress && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{locationAddress}</p>}{result?.ok === false && result.message !== unavailableMessage && <p className="mt-3 text-xs font-semibold text-slate-500">Confira os dados do local com a profissional.</p>}</>}
    </section>
  </main>;
}

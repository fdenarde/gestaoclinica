const HOURGLASS_LOADING_CSS = `
  @keyframes psychology-hourglass-turn {
    0%, 78% { transform: rotate(0deg); }
    92%, 100% { transform: rotate(180deg); }
  }

  @keyframes psychology-hourglass-flow {
    0%, 12% { opacity: 0; transform: translateY(-1px); }
    24%, 68% { opacity: 1; transform: translateY(8px); }
    78%, 100% { opacity: 0; transform: translateY(10px); }
  }

  @keyframes psychology-hourglass-pile {
    0%, 22% { transform: scaleY(.28); transform-origin: 24px 35px; }
    70%, 82% { transform: scaleY(1); transform-origin: 24px 35px; }
    100% { transform: scaleY(.28); transform-origin: 24px 35px; }
  }

  [data-psychology-hourglass-figure] {
    transform-box: fill-box;
    transform-origin: center;
    animation: psychology-hourglass-turn 2s cubic-bezier(.45, .05, .55, .95) infinite;
  }

  [data-psychology-hourglass-flow] {
    animation: psychology-hourglass-flow 2s ease-in-out infinite;
  }

  [data-psychology-hourglass-pile] {
    animation: psychology-hourglass-pile 2s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    [data-psychology-hourglass-figure],
    [data-psychology-hourglass-flow],
    [data-psychology-hourglass-pile] {
      animation: none;
    }
  }
`;

export default function PsychologyLoading() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-slate-50 text-slate-700"
      data-testid="psychology-real-loading"
      role="status"
      aria-live="polite"
    >
      <style>{HOURGLASS_LOADING_CSS}</style>
      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        role="img"
        aria-label="Carregando"
        data-testid="psychology-hourglass-loading"
      >
        <g data-psychology-hourglass-figure>
          <path d="M13 8h22M13 40h22" stroke="#334155" strokeWidth="3" strokeLinecap="round" />
          <path d="M16 10c0 7 4 10 8 14-4 4-8 7-8 14M32 10c0 7-4 10-8 14 4 4 8 7 8 14" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M18 13h12l-6 8-6-8Z" fill="#7C3AED" opacity=".75" />
          <path d="M18 35h12l-6-8-6 8Z" fill="#7C3AED" data-psychology-hourglass-pile />
          <path d="M24 21v8" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" data-psychology-hourglass-flow />
        </g>
      </svg>
      <p className="mt-2 text-xs font-semibold tracking-wide text-slate-500">Carregando...</p>
    </div>
  );
}

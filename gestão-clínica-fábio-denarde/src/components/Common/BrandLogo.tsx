import React from 'react';
import { DEFAULT_APP_THEME, isAppTheme, type AppTheme } from '../../lib/theme';

interface BrandLogoProps {
  variant?: 'horizontal' | 'compact';
  className?: string;
  showSubtitle?: boolean;
  theme?: AppTheme;
}

const BRAIN_ASSET_BY_THEME: Record<AppTheme, string> = {
  current: 'brain-current.webp',
  'calm-tech': 'brain-calm-tech.webp',
  'health-balance': 'brain-health-balance.webp',
  'soft-welcome': 'brain-soft-welcome.webp',
};

function getActiveTheme(theme?: AppTheme): AppTheme {
  if (theme) return theme;
  if (typeof document !== 'undefined' && isAppTheme(document.documentElement.dataset.theme)) {
    return document.documentElement.dataset.theme;
  }
  return DEFAULT_APP_THEME;
}

export default function BrandLogo({
  variant = 'horizontal',
  className = '',
  showSubtitle = true,
  theme,
}: BrandLogoProps) {
  const isCompact = variant === 'compact';
  const activeTheme = getActiveTheme(theme);
  const brainSrc = `${import.meta.env.BASE_URL}brand/${BRAIN_ASSET_BY_THEME[activeTheme]}`;

  return (
    <div
      className={`inline-flex max-w-full items-center text-left ${className}`}
      role="img"
      aria-label="Denarde Soluções – Gestão Clínica e Acompanhamento"
    >
      <img
        src={brainSrc}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={201}
        height={201}
        className={
          isCompact
            ? 'mr-1 h-[28px] w-[28px] shrink-0 object-contain object-center select-none'
            : 'mr-1 h-[30px] w-[30px] shrink-0 object-contain object-center select-none md:mr-1 md:h-[34px] md:w-[34px] lg:mr-1.5 lg:h-[36px] lg:w-[36px] xl:h-[40px] xl:w-[40px] 2xl:h-[42px] 2xl:w-[42px]'
        }
      />

      {!isCompact && (
        <span
          className="mr-2 h-[38px] w-px shrink-0 rounded-full md:mr-2.5 md:h-[42px] lg:mr-3 lg:h-[46px] xl:mr-3 xl:h-[50px] 2xl:mr-3.5 2xl:h-[52px]"
          style={{ backgroundColor: 'var(--logo-divider)' }}
          aria-hidden="true"
        />
      )}

      <div className="min-w-0" aria-hidden="true">
        {isCompact ? (
          <div className="flex items-baseline whitespace-nowrap leading-none">
            <span
              className="text-[14px] font-bold tracking-[-0.035em]"
              style={{ color: 'var(--logo-text)' }}
            >
              Denarde
            </span>
            <span
              className="ml-1 text-[13px] font-medium tracking-[-0.025em]"
              style={{ color: 'var(--logo-accent)' }}
            >
              Soluções
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-baseline whitespace-nowrap leading-[0.95]">
              <span
                className="text-[17px] font-bold tracking-[-0.045em] md:text-[19px] lg:text-[22px] xl:text-[24px] 2xl:text-[26px]"
                style={{ color: 'var(--logo-text)' }}
              >
                Denarde
              </span>
              <span
                className="ml-1.5 text-[15px] font-medium tracking-[-0.035em] md:text-[17px] lg:ml-1.5 lg:text-[20px] xl:text-[22px] 2xl:text-[24px]"
                style={{ color: 'var(--logo-accent)' }}
              >
                Soluções
              </span>
            </div>

            {showSubtitle && (
              <span
                className="mt-1 block whitespace-nowrap text-[6px] font-medium uppercase leading-none tracking-[0.11em] md:text-[7px] lg:mt-1.5 lg:text-[8px] lg:tracking-[0.12em] xl:text-[8px] 2xl:text-[9px]"
                style={{ color: 'var(--logo-subtitle)' }}
              >
                Gestão Clínica e Acompanhamento
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

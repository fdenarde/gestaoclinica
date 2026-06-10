import React from 'react';
import { DEFAULT_APP_THEME, isAppTheme, type AppTheme } from '../../lib/theme';

interface BrandLogoProps {
  variant?: 'horizontal' | 'compact';
  className?: string;
  showSubtitle?: boolean;
  theme?: AppTheme;
  name?: string;
  subtitle?: string;
}

const DEFAULT_BRAND_NAME = 'Denarde Soluções';
const DEFAULT_BRAND_SUBTITLE = 'Gestão Clínica e Acompanhamento';

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

function withFallback(value: string | undefined, fallback: string): string {
  const normalizedValue = value?.trim();
  return normalizedValue || fallback;
}

export default function BrandLogo({
  variant = 'horizontal',
  className = '',
  showSubtitle = true,
  theme,
  name,
  subtitle,
}: BrandLogoProps) {
  const isCompact = variant === 'compact';
  const activeTheme = getActiveTheme(theme);
  const brainSrc = `${import.meta.env.BASE_URL}brand/${BRAIN_ASSET_BY_THEME[activeTheme]}`;
  const brandName = withFallback(name, DEFAULT_BRAND_NAME);
  const brandSubtitle = withFallback(subtitle, DEFAULT_BRAND_SUBTITLE);
  const accessibleLabel = showSubtitle ? `${brandName} – ${brandSubtitle}` : brandName;

  return (
    <div
      className={`inline-flex max-w-full min-w-0 items-center text-left ${className}`}
      role="img"
      aria-label={accessibleLabel}
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

      <div className="min-w-0 max-w-full" aria-hidden="true">
        <span
          className={
            isCompact
              ? 'block max-w-full break-words text-[14px] font-bold leading-[1.05] tracking-[-0.035em]'
              : 'block max-w-full break-words text-[17px] font-bold leading-[0.95] tracking-[-0.045em] md:text-[19px] lg:text-[22px] xl:text-[24px] 2xl:text-[26px]'
          }
          style={{ color: 'var(--logo-text)' }}
        >
          {brandName}
        </span>

        {showSubtitle && (
          <span
            className={
              isCompact
                ? 'mt-0.5 block max-w-full break-words text-[5px] font-medium uppercase leading-tight tracking-[0.08em]'
                : 'mt-1 block max-w-full break-words text-[6px] font-medium uppercase leading-tight tracking-[0.11em] md:text-[7px] lg:mt-1.5 lg:text-[8px] lg:tracking-[0.12em] xl:text-[8px] 2xl:text-[9px]'
            }
            style={{ color: 'var(--logo-subtitle)' }}
          >
            {brandSubtitle}
          </span>
        )}
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { formatPsychologyMoneyInput, parsePsychologyMoney } from './psychologyMoney';

function rawFromNumeric(value: number): string {
  const fixed = value.toFixed(2).replace(/\.00$/u, '').replace(/(\.\d)0$/u, '$1');
  return fixed.replace('.', ',');
}

export function psychologyMoneyRawFromValue(value: string): string {
  const parsed = parsePsychologyMoney(value);
  return parsed === null ? '' : rawFromNumeric(parsed);
}

function formatRawValue(raw: string): { formatted: string; numeric: number | null } {
  if (!raw) return { formatted: '', numeric: null };
  const parsed = parsePsychologyMoney(raw.endsWith(',') ? raw.slice(0, -1) : raw);
  return parsed === null
    ? { formatted: '', numeric: null }
    : { formatted: formatPsychologyMoneyInput(parsed), numeric: parsed };
}

export function applyPsychologyMoneyTyping(rawValue: string, key: string, replaceAll = false): string {
  const raw = replaceAll ? '' : rawValue;
  if (/^\d$/u.test(key)) {
    const [integer = '', decimals] = raw.split(',');
    if (decimals !== undefined) return decimals.length >= 2 ? raw : `${integer || '0'},${decimals}${key}`;
    return integer === '0' ? key : `${integer}${key}`;
  }
  if (key === ',' || key === '.') return raw.includes(',') ? raw : `${raw || '0'},`;
  if (key === 'Backspace' || key === 'Delete') return raw.slice(0, -1);
  return raw;
}

function insertedText(previous: string, next: string): string {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return next.slice(start, nextEnd);
}

export function PsychologyMoneyInput({
  value,
  onChange,
  className,
  placeholder = 'R$ 0,00',
  autoFocus = false,
  ariaLabel,
  describedBy = 'psychology-money-help',
  testId,
}: {
  value: string;
  onChange: (formatted: string, numeric: number | null) => void;
  className: string;
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
  describedBy?: string;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rawRef = useRef(psychologyMoneyRawFromValue(value));

  const emit = (raw: string) => {
    rawRef.current = raw;
    const next = formatRawValue(raw);
    onChange(next.formatted, next.numeric);
  };

  useEffect(() => {
    if (typeof document === 'undefined' || document.activeElement !== inputRef.current) rawRef.current = psychologyMoneyRawFromValue(value);
  }, [value]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && typeof document !== 'undefined' && document.activeElement === input) input.setSelectionRange(input.value.length, input.value.length);
  }, [value]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!/^\d$/u.test(event.key) && ![',', '.', 'Backspace', 'Delete'].includes(event.key)) return;
    event.preventDefault();
    const replaceAll = event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === event.currentTarget.value.length;
    emit(applyPsychologyMoneyTyping(rawRef.current, event.key, replaceAll));
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const parsed = parsePsychologyMoney(event.clipboardData.getData('text'));
    emit(parsed === null ? rawRef.current : rawFromNumeric(parsed));
  };

  return <input
    ref={inputRef}
    autoFocus={autoFocus}
    value={value}
    onFocus={event => {
      rawRef.current = psychologyMoneyRawFromValue(value);
      event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length);
    }}
    onKeyDown={onKeyDown}
    onPaste={onPaste}
    onChange={event => {
      const input = event.currentTarget || event.target;
      if (/^\d+(?:[,.]\d{0,2})?$/u.test(input.value) && input.value !== value) {
        const parsed = parsePsychologyMoney(input.value);
        emit(parsed === null ? rawRef.current : rawFromNumeric(parsed));
        return;
      }
      const inserted = insertedText(value, input.value);
      if (inserted && /^[\d,.]+$/u.test(inserted)) {
        emit([...inserted].reduce((raw, key) => applyPsychologyMoneyTyping(raw, key), rawRef.current));
        return;
      }
      if (input.value.length < value.length) {
        emit(applyPsychologyMoneyTyping(rawRef.current, 'Backspace'));
        return;
      }
      const parsed = parsePsychologyMoney(input.value);
      emit(parsed === null ? rawRef.current : rawFromNumeric(parsed));
    }}
    onBlur={() => emit(rawRef.current)}
    inputMode="decimal"
    placeholder={placeholder}
    className={className}
    aria-label={ariaLabel}
    aria-describedby={describedBy}
    data-testid={testId}
  />;
}

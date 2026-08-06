import React, { useEffect, useId, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
  closeDisabled?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  descriptionId?: string;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  width = 'max-w-2xl',
  closeDisabled = false,
  initialFocusRef,
  descriptionId,
}: ModalProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled]);

  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      (initialFocusRef?.current || closeButtonRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabledRef.current) onCloseRef.current();
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [initialFocusRef, isOpen]);

  const requestClose = () => {
    if (!closeDisabledRef.current) onCloseRef.current();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div key="modal-overlay" className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={requestClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className={`relative bg-clinic-surface w-full ${width} rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[94dvh] sm:max-h-[90vh] overflow-hidden`}
          >
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-clinic-border flex justify-between items-center gap-3 bg-clinic-header text-white">
              <h3 id={titleId} className="text-lg sm:text-xl font-semibold uppercase tracking-wide leading-tight">{title}</h3>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={requestClose}
                disabled={closeDisabled}
                aria-label="Fechar modal"
                className="p-2 -mr-2 hover:bg-white/20 rounded-full transition-colors touch-manipulation disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X size={24} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 scroll-smooth">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

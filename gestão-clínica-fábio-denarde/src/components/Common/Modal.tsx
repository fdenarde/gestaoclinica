import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}

export default function Modal({ isOpen, onClose, title, children, width = 'max-w-2xl' }: ModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div key="modal-overlay" className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={`relative bg-clinic-surface w-full ${width} rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[94dvh] sm:max-h-[90vh] overflow-hidden`}
          >
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-clinic-border flex justify-between items-center gap-3 bg-clinic-header text-white">
              <h3 className="font-serif text-lg sm:text-xl font-semibold uppercase tracking-wide leading-tight">{title}</h3>
              <button
                onClick={onClose}
                className="p-2 -mr-2 hover:bg-white/20 rounded-full transition-colors touch-manipulation"
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

import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const ICONS = {
  success: <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />,
  error: <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />,
  info: <Info className="w-4 h-4 text-sky-400 shrink-0" />,
};

const COLORS = {
  success: "border-emerald-500/30 bg-emerald-950/80",
  error: "border-red-500/30 bg-red-950/80",
  info: "border-sky-500/30 bg-sky-950/80",
};

export default function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.93 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-2xl max-w-sm text-sm font-medium text-white ${COLORS[t.type]}`}
          >
            {ICONS[t.type]}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="shrink-0 text-white/40 hover:text-white/80 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

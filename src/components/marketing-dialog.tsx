"use client";
import { useEffect, useRef } from "react";
export function MarketingDialog({
  children,
  busy,
  onClose,
}: {
  children: React.ReactNode;
  busy: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal-card marketing-modal"
      aria-labelledby="marketing-form-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

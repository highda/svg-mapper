import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ComponentProps, type ReactNode, type RefObject } from "react";

// One modal adapter for every editor dialog (#174). Radix Dialog (editor-only,
// never in the renderer bundle) supplies the focus trap, Escape handling, a
// hidden/inert background; this adapter returns focus to the element that
// opened the dialog.
// `aria-modal` stays on the panel so the shortcut guard (#162) keeps
// background editing shortcuts off while any dialog is open.

export interface ModalDialogProps {
  open: boolean;
  /**
   * Called for Escape (and outside clicks when `closeOnOutsideClick`).
   * Omit it for dialogs that need an explicit choice: Escape then does nothing.
   */
  onDismiss?: () => void;
  title: ReactNode;
  /** Visible description; it is also the dialog's accessible description. */
  description?: ReactNode;
  children?: ReactNode;
  closeOnOutsideClick?: boolean;
  /** Element focused when the dialog opens (defaults to the first focusable control). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Focus target on close when the element that opened the dialog no longer exists. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Lets global handlers recognise a specific dialog (e.g. "?" closing help). */
  dialogId?: string;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  overlayClassName?: string;
  testId?: string;
}

export function ModalDialog({
  open,
  onDismiss,
  title,
  description,
  children,
  closeOnOutsideClick = false,
  initialFocusRef,
  returnFocusRef,
  dialogId,
  className = "max-w-md rounded-lg border border-neutral-600 bg-neutral-900 p-5 shadow-xl",
  titleClassName = "text-base font-semibold text-white",
  descriptionClassName = "mt-2 text-sm text-neutral-300",
  overlayClassName = "bg-black/70",
  testId,
}: ModalDialogProps) {
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onDismiss?.(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 z-50 ${overlayClassName}`} />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content
            aria-modal="true"
            data-dialog={dialogId}
            data-testid={testId}
            {...(description ? {} : { "aria-describedby": undefined })}
            className={`pointer-events-auto max-h-[calc(100%-2rem)] w-full overflow-y-auto overscroll-contain outline-none ${className}`}
            onOpenAutoFocus={(event) => {
              // Runs before focus moves inside, so this is the opener.
              const active = document.activeElement;
              openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
              const target = initialFocusRef?.current;
              if (target) {
                event.preventDefault();
                target.focus();
              }
            }}
            onCloseAutoFocus={(event) => {
              // Radix only restores focus to a Dialog.Trigger; these dialogs open
              // from many places, so return to the recorded opener, or the
              // fallback when the opener is gone (a dialog opened from a dialog).
              event.preventDefault();
              const opener = openerRef.current;
              openerRef.current = null;
              const target = opener?.isConnected ? opener : returnFocusRef?.current;
              if (target?.isConnected) target.focus();
            }}
            onEscapeKeyDown={(event) => { if (!onDismiss) event.preventDefault(); }}
            onPointerDownOutside={(event) => { if (!closeOnOutsideClick || !onDismiss) event.preventDefault(); }}
            onInteractOutside={(event) => { if (!closeOnOutsideClick || !onDismiss) event.preventDefault(); }}
          >
            <Dialog.Title className={titleClassName}>{title}</Dialog.Title>
            {description && <Dialog.Description className={descriptionClassName}>{description}</Dialog.Description>}
            {children}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A button that closes the surrounding dialog; restores focus like Escape. */
export function DialogClose(props: ComponentProps<typeof Dialog.Close>) {
  return <Dialog.Close type="button" {...props} />;
}

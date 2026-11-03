import { Forward, X } from 'lucide-react';

/** Header replacement while messages are being selected for forwarding. */
export default function MessageSelectionBar({ count, cancelRef, onCancel, onForward }) {
  return (
    <div className="message-selection-bar chat-header" role="toolbar" aria-label="Выбранные сообщения">
      <button ref={cancelRef} type="button" aria-label="Отменить выбор" onClick={onCancel}><X size={22}/></button>
      <span className="message-selection-count" role="status" aria-live="polite">Выбрано: {count}</span>
      <button className="message-selection-forward" aria-label="Переслать" type="button" disabled={!count} onClick={onForward}><Forward size={22}/><span>Переслать</span></button>
    </div>
  );
}

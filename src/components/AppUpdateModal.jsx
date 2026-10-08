import { useEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';
import IconButton from './ui/IconButton';
import Button from './ui/Button';
import { normalizeExternalHttpsUrl } from '../utils/urlSecurity';
import './AppUpdateModal.css';

export default function AppUpdateModal({ show, releaseInfo, currentVersion, onClose }) {
  const isOpen = show && Boolean(releaseInfo);
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return undefined;
    const returnFocus = document.activeElement;
    dialogRef.current?.querySelector('button')?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const controls = [...dialogRef.current.querySelectorAll('button, a[href]')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, [isOpen]);
  if (!isOpen) return null;
  return <div className="app-update-overlay">
    <section ref={dialogRef} className="app-update-dialog" role="dialog" aria-modal="true" aria-labelledby="app-update-title">
      <header className="app-update-header">
        <h3 id="app-update-title">Доступно обновление</h3>
        <IconButton label="Закрыть обновление" onClick={onClose}><X size={20} /></IconButton>
      </header>
      <div className="app-update-body">
        <h4>Версия {releaseInfo.tagName}</h4>
        <p>Текущая версия: {currentVersion}</p>
        {releaseInfo.body && <div className="app-update-changelog"><strong>Что нового</strong><p>{releaseInfo.body}</p></div>}
      </div>
      <footer className="app-update-actions">
        <a href={normalizeExternalHttpsUrl(releaseInfo.downloadUrl) || undefined} target="_blank" rel="noreferrer"><Download size={20} />Скачать обновление</a>
        <Button variant="quiet" onClick={onClose}>Позже</Button>
      </footer>
    </section>
  </div>;
}

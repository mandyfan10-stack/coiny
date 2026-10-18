import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Send } from 'lucide-react';
import { useChat } from '../../context/ChatContext';
import { isSavedMessagesChat } from '../../utils/savedMessages';
import './MessageOperations.css';

export default function ForwardMessageDialog({ sourceChat, messages, currentUser, onClose }) {
  const { chats, forwardMessages, openSavedMessages } = useChat();
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(new Set());
  const dialogRef = useRef(null);
  const progress = useRef(new Set());
  const owner = useRef(currentUser?.id);
  const ownerLive = useRef(currentUser?.id);
  ownerLive.current = currentUser?.id;
  const busyRef = useRef(false);
  const [viewport, setViewport] = useState(null);
  useEffect(() => {
    const visual = window.visualViewport;
    if (!visual) return undefined;
    const update = () => setViewport({ top: visual.offsetTop, height: visual.height });
    update();
    visual.addEventListener('resize', update);
    visual.addEventListener('scroll', update);
    return () => { visual.removeEventListener('resize', update); visual.removeEventListener('scroll', update); };
  }, []);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector('input')?.focus();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busyRef.current) onClose(); }
      if (event.key !== 'Tab') return;
      const elements = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')];
      const next = elements[(elements.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1) + elements.length) % elements.length];
      event.preventDefault(); next?.focus();
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [onClose]);
  const eligible = chats.filter(chat => {
    const admin = chat.createdBy === currentUser.id || chat.members?.some(member => member.id === currentUser.id && member.role === 'admin');
    return !chat.requiresUpdate && (chat.type !== 'channel' || admin) && (!chat.settings?.only_admins_can_post || admin)
      && (chat.type === 'personal' || !messages.some(message => message.media) || chat.settings?.allow_media !== false || admin)
      && chat.name?.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  });
  const submit = async () => {
    if (!targetId || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      await forwardMessages(sourceChat.id, targetId, messages.filter(message => !progress.current.has(message.id)),
        progress.current.has(null) ? '' : comment, id => { progress.current.add(id); setSent(new Set(progress.current)); });
      if (ownerLive.current === owner.current) onClose();
    } catch (failure) { setError(failure.message || 'Не удалось переслать сообщения.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return createPortal(<div className="message-operation-backdrop" style={viewport ? { top: viewport.top, height: viewport.height, bottom: 'auto', '--forward-viewport-height': `${viewport.height}px` } : undefined} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="forward-dialog" role="dialog" aria-modal="true" aria-label="Переслать сообщения" aria-busy={busy}>
      <header><h2>Переслать {messages.length > 1 ? `сообщения · ${messages.length}` : 'сообщение'}</h2>
        <button type="button" aria-label="Закрыть пересылку" disabled={busy} onClick={onClose}><X size={22}/></button></header>
      <label className="forward-search"><Search size={18}/><input aria-label="Найти чат для пересылки" placeholder="Поиск" value={query} disabled={busy || sent.size > 0} onChange={event => setQuery(event.target.value)}/></label>
      <div className="forward-chat-list" role="listbox" aria-label="Получатель">
        {eligible.map(chat => <button type="button" role="option" aria-selected={chat.id === targetId} key={chat.id}
          disabled={busy || sent.size > 0 && chat.id !== targetId} onClick={() => setTargetId(chat.id)}>
          <span className="forward-chat-avatar" aria-hidden="true">{isSavedMessagesChat(chat, currentUser.id) ? '★' : chat.name?.slice(0, 1)}</span>
          <span>{isSavedMessagesChat(chat, currentUser.id) ? 'Избранное' : chat.name}</span>
        </button>)}
        {!eligible.length && <p className="message-operation-hint">Подходящие чаты не найдены</p>}
      </div>
      {!chats.some(chat => isSavedMessagesChat(chat, currentUser.id)) && openSavedMessages && <button type="button" className="forward-saved" disabled={busy || sent.size > 0} onClick={async () => {
        try { const chat = await openSavedMessages({ activate: false }); if (!chat) throw new Error('Saved messages unavailable'); setTargetId(chat.id); }
        catch { setError('Не удалось открыть Избранное.'); }
      }}>Добавить «Избранное»</button>}
      <footer><textarea aria-label="Комментарий к пересылке" placeholder="Добавить комментарий…" value={comment} disabled={busy || sent.has(null)} onChange={event => setComment(event.target.value)} rows={2}/>
        {error && <p role="alert" className="message-operation-error">{error}</p>}
        {sent.size > 0 && <p role="status">Уже отправлено: {messages.filter(message => sent.has(message.id)).length} из {messages.length}</p>}
        <button type="button" className="forward-send" disabled={!targetId || busy} onClick={submit}><Send size={18}/>{busy ? 'Пересылаем…' : error ? 'Продолжить пересылку' : 'Отправить'}</button>
      </footer>
    </section>
  </div>, document.body);
}

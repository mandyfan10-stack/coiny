import React from 'react';
import './InviteLinkStatus.css';

export default function InviteLinkStatus({ status, error, retry, dismiss }) {
  if (status !== 'loading' && status !== 'error') return null;
  return <div className="invite-link-status" role={status === 'error' ? 'alert' : 'status'}>
    <span>{status === 'loading' ? 'Открываем чат по ссылке…' : error}</span>
    {status === 'error' && <div className="invite-link-actions">
      <button type="button" onClick={retry}>Повторить</button>
      <button type="button" onClick={dismiss}>Закрыть</button>
    </div>}
  </div>;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadChatDrafts, saveChatDraft } from '../../utils/indexedDbHelper';

export function useChatDrafts(userId) {
  const [state, setState] = useState({ owner: userId, values: {}, loaded: false });
  const sessionRef = useRef({ userId });
  if (sessionRef.current.userId !== userId) sessionRef.current = { userId };
  const session = sessionRef.current;
  const writes = useRef(new Map());
  const dirty = useRef(new Set());
  const [draftError, setDraftError] = useState(null);
  useEffect(() => {
    let active = true;
    dirty.current = new Set();
    setDraftError(null);
    setState({ owner: userId, values: {}, loaded: false });
    loadChatDrafts(userId).then(values => {
      if (!active) return;
      setState(current => ({ owner: userId, loaded: true, values: {
        ...values, ...Object.fromEntries(Object.entries(current.values).filter(([id]) => dirty.current.has(id)))
      } }));
    }).catch(() => {
      if (active) { setDraftError('Не удалось прочитать черновики на этом устройстве.'); setState(current => ({ ...current, loaded: true })); }
    });
    return () => { active = false; };
  }, [userId]);
  const updateDraft = useCallback((chatId, draft) => {
    if (!userId || !chatId || sessionRef.current !== session) return;
    dirty.current.add(chatId);
    const value = { text: draft.text || '', replyTo: draft.replyTo || null };
    setState(current => ({ ...current, owner: userId, values: { ...(current.owner === userId ? current.values : {}), [chatId]: value } }));
    const id = JSON.stringify([userId, chatId]);
    const next = (writes.current.get(id) || Promise.resolve()).catch(() => {}).then(() => {
      if (sessionRef.current === session) return saveChatDraft(userId, chatId, value);
    });
    writes.current.set(id, next);
    next.then(() => { if (sessionRef.current === session) setDraftError(null); }).catch(() => { if (sessionRef.current === session) setDraftError('Черновик остался в памяти: не удалось сохранить его на устройстве.'); });
  }, [userId, session]);
  return { drafts: state.owner === userId ? state.values : {}, draftsLoaded: state.owner === userId && state.loaded, updateDraft, draftError };
}

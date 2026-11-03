import coinyLogo from '../../assets/logo.png';

/** Placeholder shown when no chat is selected. */
export default function ChatEmptyState() {
  return (
    <main className="chat-area empty">
      <div className="empty-state">
        <div className="empty-state-logo">
          <img src={coinyLogo} alt="Coiny" className="empty-state-logo-img" width="76" height="76" />
        </div>
        <h3>Выберите чат, чтобы начать общение</h3>
        <p>Или откройте историю в списке чатов</p>
      </div>
    </main>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state-error">
      <p>{message}</p>
      <button className="btn" onClick={onRetry}>
        Réessayer
      </button>
    </div>
  );
}

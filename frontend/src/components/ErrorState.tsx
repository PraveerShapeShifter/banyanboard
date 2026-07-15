interface ErrorStateProps {
  message?: string;
  /** When provided, renders a Retry button that re-fires the failed fetch in place. */
  onRetry?: () => void;
}

/**
 * Shared recoverable-error state, reused by both pages. The message region is
 * `role="alert"` so it is announced without moving focus (AC-ERROR-1/2).
 */
export default function ErrorState({
  message = 'Something went wrong.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

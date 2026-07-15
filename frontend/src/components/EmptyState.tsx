/** Shared explicit empty state ("No boards yet." / "No cards"), parameterized by copy. */
export default function EmptyState({ message }: { message: string }) {
  return <p className="empty-state">{message}</p>;
}

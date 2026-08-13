import { Search } from "lucide-react";

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="state-empty">
      <Search />
      <p>{message}</p>
    </div>
  );
}

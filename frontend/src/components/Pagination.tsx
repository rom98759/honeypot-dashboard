import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="pagination">
      <span>
        Page {page} / {totalPages}
      </span>
      <button className="btn btn-square" disabled={page <= 1} onClick={onPrev} aria-label="Précédent" title="Précédent">
        <ChevronLeft />
      </button>
      <button
        className="btn btn-square"
        disabled={page >= totalPages}
        onClick={onNext}
        aria-label="Suivant"
        title="Suivant"
      >
        <ChevronRight />
      </button>
    </div>
  );
}

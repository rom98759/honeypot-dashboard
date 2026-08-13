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
      <button className="btn" disabled={page <= 1} onClick={onPrev}>
        Précédent
      </button>
      <span>
        Page {page} / {totalPages}
      </span>
      <button className="btn" disabled={page >= totalPages} onClick={onNext}>
        Suivant
      </button>
    </div>
  );
}

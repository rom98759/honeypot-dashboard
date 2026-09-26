import { X } from "lucide-react";

export interface FilterChip {
  label: string;
  onClear: () => void;
}

export function FilterChips({ chips }: { chips: FilterChip[] }) {
  if (!chips.length) return null;
  return (
    <div className="filter-chips">
      {chips.map((chip) => (
        <span className="filter-chip" key={chip.label}>
          {chip.label}
          <button className="btn-icon" onClick={chip.onClear} aria-label={`Effacer : ${chip.label}`}>
            <X size={14} />
          </button>
        </span>
      ))}
    </div>
  );
}

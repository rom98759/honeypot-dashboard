import { ChevronUp, ChevronDown } from "lucide-react";

export interface Column {
  key: string;
  label: string;
}

export function SortableTableHeader({
  columns,
  sort,
  order,
  onSort,
}: {
  columns: Column[];
  sort: string;
  order: "asc" | "desc";
  onSort: (key: string) => void;
}) {
  return (
    <>
      {columns.map((col) => (
        <th key={col.key}>
          <button className="sort-header" onClick={() => onSort(col.key)}>
            {col.label}
            {sort === col.key ? order === "asc" ? <ChevronUp /> : <ChevronDown /> : null}
          </button>
        </th>
      ))}
    </>
  );
}

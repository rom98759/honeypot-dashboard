import { Link, useSearchParams } from "react-router-dom";
import { FileDown } from "lucide-react";
import { FILES_PAGE_SIZE, useFiles } from "../../api/files";
import type { CapturedFile, FileSort } from "../../api/types";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { ErrorState } from "../../components/ErrorState";
import { EmptyState } from "../../components/EmptyState";
import { Pagination } from "../../components/Pagination";
import { PageHeader } from "../../components/PageHeader";
import { MetricCard } from "../../components/MetricCard";
import { formatNumber } from "../../utils/format";
import { formatTimestamp } from "../../utils/formatDate";
import { SessionDetailPanel } from "../SessionsPage/SessionDetailPanel";
import { FileDetailPanel } from "./FileDetailPanel";
import { KindBadge, formatBytes } from "./fileLabels";

const SORT_TABS: { sort: FileSort; label: string }[] = [
  { sort: "sessions", label: "Par sessions" },
  { sort: "ips", label: "Par IP" },
  { sort: "first_seen", label: "Nouveaux" },
  { sort: "last_seen", label: "Vus récemment" },
];

function FileRow({ file, href }: { file: CapturedFile; href: string }) {
  return (
    <tr>
      <td className="file-cell">
        <Link to={href} className="mono" title={file.name || file.shasum}>
          {file.name || "(sans nom)"}
        </Link>
        <span className="file-cell-sub">
          {file.kinds.map((k) => (
            <KindBadge key={k} kind={k} />
          ))}
          <span className="mono cell-muted">{file.shasum.slice(0, 12)}</span>
        </span>
      </td>
      <td className="cell-num cell-muted hide-narrow">{formatBytes(file.size)}</td>
      <td className="mono cell-muted hide-narrow">{formatTimestamp(file.last_seen)}</td>
      <td className="cell-num cell-muted hide-narrow">{formatNumber(file.ips)}</td>
      <td className="cell-num">{formatNumber(file.sessions)}</td>
    </tr>
  );
}

export function FilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sortParam = searchParams.get("sort");
  const sort: FileSort = SORT_TABS.some((t) => t.sort === sortParam) ? (sortParam as FileSort) : "sessions";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const openFile = searchParams.get("file");
  const openSession = searchParams.get("session");
  const files = useFiles({ sort, page });

  function urlWith(changes: Record<string, string | null>): string {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value == null) params.delete(key);
      else params.set(key, value);
    }
    return `?${params.toString()}`;
  }

  function update(changes: Record<string, string | null>) {
    setSearchParams(new URLSearchParams(urlWith(changes).slice(1)));
  }

  const panels = (
    <>
      {openFile && <FileDetailPanel shasum={openFile} onClose={() => update({ file: null })} />}
      {openSession && <SessionDetailPanel sessionId={openSession} onClose={() => update({ session: null })} />}
    </>
  );

  if (files.isPending) return <SkeletonBlock rows={8} />;
  if (files.isError) return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => files.refetch()} />;

  const { totals, items, total } = files.data;
  const totalPages = Math.max(1, Math.ceil(total / FILES_PAGE_SIZE));

  return (
    <>
      <PageHeader
        title={
          <>
            <FileDown />
            Fichiers
          </>
        }
      />
      <div className="metrics-bar">
        <MetricCard label="Fichiers" value={formatNumber(totals.files)} note="contenus distincts (SHA-256)" />
        <MetricCard label="Transferts" value={formatNumber(totals.events)} note="téléchargements, écritures, dépôts" />
        <MetricCard label="Nouveaux" value={formatNumber(totals.new_7d)} note="vus pour la 1re fois sur 7 j" />
        <MetricCard label="Échecs" value={formatNumber(totals.failed)} note="téléchargements ratés" />
      </div>
      <section className="panel table-panel">
        <div className="tabs" role="tablist">
          {SORT_TABS.map((t) => (
            <button
              key={t.sort}
              role="tab"
              aria-selected={t.sort === sort}
              className={`tab${t.sort === sort ? " active" : ""}`}
              onClick={() => update({ sort: t.sort, page: null })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <table className="plain-table files-table">
          <thead>
            <tr>
              <th>Fichier</th>
              <th className="cell-num hide-narrow">Taille</th>
              <th className="hide-narrow">Dernier vu</th>
              <th className="cell-num hide-narrow">IP</th>
              <th className="cell-num">Sessions</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((f) => <FileRow key={f.shasum} file={f} href={urlWith({ file: f.shasum })} />)
            ) : (
              <tr>
                <td colSpan={5}>
                  <EmptyState message="Aucun fichier capturé" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-footer">
          <span className="result-count">{formatNumber(total)} fichiers</span>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPrev={() => update({ page: String(page - 1) })}
            onNext={() => update({ page: String(page + 1) })}
          />
        </div>
      </section>
      {panels}
    </>
  );
}

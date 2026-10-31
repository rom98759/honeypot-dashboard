import { Globe } from "lucide-react";
import { usePeriod } from "../theme/PeriodContext";
import { useFilters } from "../theme/useFilters";
import { useOverview } from "../api/overview";
import { WorldMap } from "../components/WorldMap";
import { ListTable } from "../components/ListTable";
import { PeriodSelect } from "../components/PeriodSelect";
import { FilterButton, ActiveFilters } from "../components/FilterBar";
import { PageHeader } from "../components/PageHeader";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { formatNumber } from "../utils/format";
import { countryRows } from "./OverviewPage";

export function MapPage() {
  const [period] = usePeriod();
  const { filters, setFilter, removeFilter, changePeriod } = useFilters();
  const { data, isPending, isError, refetch } = useOverview(period, filters);

  return (
    <>
      <PageHeader
        title={
          <>
            <Globe />
            Carte
          </>
        }
      >
        {data && <span className="result-count">{formatNumber(data.countries.length)} pays</span>}
      </PageHeader>
      <div className="controls">
        <div className="controls-group">
          <FilterButton
            suggestions={{
              country: data?.countries.map((c) => c.country) ?? [],
              protocol: data?.protocol_split.map((p) => p.protocol) ?? [],
            }}
            onAdd={setFilter}
          />
          <ActiveFilters filters={filters} onRemove={removeFilter} />
        </div>
        <PeriodSelect value={period} onChange={changePeriod} />
      </div>
      {isPending ? (
        <SkeletonBlock rows={8} />
      ) : isError ? (
        <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />
      ) : (
        <div className="panel-row two-one">
          <section className="panel panel-flush">
            <WorldMap countries={data.countries} onCountryClick={(c) => setFilter("country", c.country)} />
          </section>
          <section className="panel">
            <h2>Pays</h2>
            <ListTable title="Pays" metric="Sessions" rows={countryRows(data, setFilter, 25)} />
          </section>
        </div>
      )}
    </>
  );
}

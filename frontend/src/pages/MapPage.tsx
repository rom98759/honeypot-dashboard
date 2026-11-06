import { Globe } from "lucide-react";
import { usePeriod } from "../theme/PeriodContext";
import { useChangePeriod } from "../theme/useFilters";
import { useSearchFilter } from "../theme/useSearchFilter";
import { filterErrorOf } from "../api/client";
import { useOverview } from "../api/overview";
import { WorldMap } from "../components/WorldMap";
import { ListTable } from "../components/ListTable";
import { PeriodSelect } from "../components/PeriodSelect";
import { QueryBar } from "../components/QueryBar";
import { PageHeader } from "../components/PageHeader";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { formatNumber } from "../utils/format";
import { countryRows } from "./OverviewPage";

export function MapPage() {
  const [period] = usePeriod();
  const changePeriod = useChangePeriod();
  const search = useSearchFilter();
  const { data, isPending, isError, error, refetch } = useOverview(period, search.filter);
  const filterError = filterErrorOf(error);

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
        <QueryBar
          search={search}
          serverError={filterError}
          suggestions={{
            country: data?.countries.map((c) => c.country_code ?? c.country) ?? [],
            proto: data?.protocol_split.map((p) => p.protocol) ?? [],
          }}
        />
        <PeriodSelect value={period} onChange={changePeriod} />
      </div>
      {isPending ? (
        <SkeletonBlock rows={8} />
      ) : filterError ? null : isError ? (
        <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />
      ) : (
        <div className="panel-row two-one">
          <section className="panel panel-flush">
            <WorldMap
              countries={data.countries}
              onCountryClick={(c) => search.addTerm("country", c.country_code ?? c.country)}
            />
          </section>
          <section className="panel">
            <h2>Pays</h2>
            <ListTable title="Pays" metric="Sessions" rows={countryRows(data, (code) => search.addTerm("country", code), 25)} />
          </section>
        </div>
      )}
    </>
  );
}

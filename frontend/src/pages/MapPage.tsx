import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { X } from "lucide-react";
import { useMap } from "../api/map";
import { usePeriod } from "../theme/PeriodContext";
import { AttackMap, pointKey } from "../components/AttackMap";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import type { MapPeriod, MapPoint } from "../api/types";

const PERIODS: { value: MapPeriod; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7j" },
  { value: "30d", label: "30j" },
  { value: "all", label: "Tout" },
];

const ARRIVAL_ANIMATION_MS = 2000;

export function MapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = usePeriod();
  const live = searchParams.get("live") === "true";

  const [arrivingKeys, setArrivingKeys] = useState<Set<string>>(new Set());
  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  const previousCountsRef = useRef<Map<string, number> | null>(null);
  const arrivalTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { data, isPending, isError, refetch } = useMap({ period, live });

  useEffect(() => {
    previousCountsRef.current = null;
  }, [period]);

  useEffect(() => {
    if (!data || !live) return;
    const previous = previousCountsRef.current;
    const nextCounts = new Map(data.points.map((p) => [pointKey(p), p.session_count]));

    if (previous !== null) {
      const newlyArrived = new Set<string>();
      for (const point of data.points) {
        const key = pointKey(point);
        const previousCount = previous.get(key) ?? 0;
        if (point.session_count > previousCount) {
          newlyArrived.add(key);
        }
      }
      if (newlyArrived.size > 0) {
        setArrivingKeys(newlyArrived);
        clearTimeout(arrivalTimeoutRef.current);
        arrivalTimeoutRef.current = setTimeout(() => setArrivingKeys(new Set()), ARRIVAL_ANIMATION_MS);
      }
    }

    previousCountsRef.current = nextCounts;
  }, [data, live]);

  useEffect(() => () => clearTimeout(arrivalTimeoutRef.current), []);

  function handlePeriodChange(value: MapPeriod) {
    setPeriod(value);
    setSearchParams({ period: value, live: String(live) });
  }

  function handleLiveToggle() {
    setSearchParams({ period, live: String(!live) });
  }

  if (isPending) return <SkeletonBlock rows={8} />;
  if (isError) {
    return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />;
  }

  return (
    <>
      <div className="topbar">
        <h1>Carte</h1>
        <div className="map-controls">
          <div className="period-selector">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                className={`btn${period === p.value ? " active" : ""}`}
                onClick={() => handlePeriodChange(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button className={`btn${live ? " active" : ""}`} onClick={handleLiveToggle}>
            {live ? "Live: ON" : "Live: OFF"}
          </button>
        </div>
      </div>
      {data.points.length ? (
        <div className="map-container">
          <AttackMap
            points={data.points}
            destination={data.destination}
            arrivingKeys={arrivingKeys}
            onPointClick={setSelectedPoint}
          />
          {selectedPoint ? (
            <div className="map-tooltip">
              <button className="btn-icon map-tooltip-close" onClick={() => setSelectedPoint(null)}>
                <X />
              </button>
              <h3>{selectedPoint.city ?? "Ville inconnue"}</h3>
              <p>{selectedPoint.country}</p>
              <p>
                {selectedPoint.session_count} session{selectedPoint.session_count > 1 ? "s" : ""}
              </p>
              <ul className="map-tooltip-ips">
                {selectedPoint.ips.map((ip) => (
                  <li key={ip}>
                    <Link to={`/sessions?ip=${encodeURIComponent(ip)}`}>Voir les sessions ({ip})</Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState message="Aucune attaque géolocalisée pour cette période" />
      )}
    </>
  );
}

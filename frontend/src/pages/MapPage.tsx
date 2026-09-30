import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMap } from "../api/map";
import { usePeriod } from "../theme/PeriodContext";
import { AttackMap } from "../components/AttackMap";
import { Scrubber } from "../components/Scrubber";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { aggregateMapEvents, pointKey } from "../utils/mapAggregation";
import type { MapPeriod } from "../api/types";
import type { HeatPoint } from "../utils/mapAggregation";

const PERIODS: { value: MapPeriod; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7j" },
  { value: "30d", label: "30j" },
  { value: "all", label: "Tout" },
];

const PLAYBACK_DURATION_MS = 25_000;
const PLAYBACK_TICK_MS = 250;

export function MapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = usePeriod();
  const live = searchParams.get("live") === "true";

  const [scrubCutoff, setScrubCutoff] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const previousCountsRef = useRef<Map<string, number> | null>(null);
  const [arrivingPoints, setArrivingPoints] = useState<HeatPoint[]>([]);
  const arrivalTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playbackIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const { data, isPending, isError, refetch } = useMap({ period, live });

  useEffect(() => {
    previousCountsRef.current = null;
  }, [period]);

  const heatPoints = data ? aggregateMapEvents(data.events, scrubCutoff) : [];

  useEffect(() => {
    if (!data || !live) return;
    const previous = previousCountsRef.current;
    const nextCounts = new Map(heatPoints.map((p) => [pointKey(p), p.count]));

    if (previous !== null) {
      const newlyArrived = heatPoints.filter((p) => p.count > (previous.get(pointKey(p)) ?? 0));
      if (newlyArrived.length > 0) {
        setArrivingPoints(newlyArrived);
        clearTimeout(arrivalTimeoutRef.current);
        arrivalTimeoutRef.current = setTimeout(() => setArrivingPoints([]), 2000);
      }
    }

    previousCountsRef.current = nextCounts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, live]);

  useEffect(() => () => {
    clearTimeout(arrivalTimeoutRef.current);
    clearInterval(playbackIntervalRef.current);
  }, []);

  function handlePeriodChange(value: MapPeriod) {
    setPeriod(value);
    setSearchParams({ period: value, live: String(live) });
    setScrubCutoff(null);
    setPlaying(false);
    clearInterval(playbackIntervalRef.current);
  }

  function handleLiveToggle() {
    const nextLive = !live;
    setSearchParams({ period, live: String(nextLive) });
    if (nextLive) {
      setScrubCutoff(null);
      setPlaying(false);
      clearInterval(playbackIntervalRef.current);
    }
  }

  function handleScrubChange(cutoff: string | null) {
    setScrubCutoff(cutoff);
    if (live) setSearchParams({ period, live: "false" });
  }

  function handleTogglePlay() {
    if (playing) {
      clearInterval(playbackIntervalRef.current);
      setPlaying(false);
      return;
    }
    if (!data || data.events.length === 0) return;
    if (live) setSearchParams({ period, live: "false" });

    const startMs = new Date(data.events[0].connect_time).getTime();
    const endMs = new Date(data.events[data.events.length - 1].connect_time).getTime();
    const startPoint = scrubCutoff === null ? startMs : new Date(scrubCutoff).getTime();
    let elapsed = startPoint - startMs;
    setPlaying(true);
    playbackIntervalRef.current = setInterval(() => {
      elapsed += ((endMs - startMs) * PLAYBACK_TICK_MS) / PLAYBACK_DURATION_MS;
      const currentMs = startMs + elapsed;
      if (currentMs >= endMs) {
        setScrubCutoff(null);
        setPlaying(false);
        clearInterval(playbackIntervalRef.current);
        return;
      }
      setScrubCutoff(new Date(currentMs).toISOString());
    }, PLAYBACK_TICK_MS);
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
      {data.events.length ? (
        <div className="map-container">
          <AttackMap heatPoints={heatPoints} destination={data.destination} arrivingPoints={arrivingPoints} />
        </div>
      ) : (
        <EmptyState message="Aucune attaque géolocalisée pour cette période" />
      )}
      {data.events.length ? (
        <Scrubber
          startTime={data.events[0].connect_time}
          endTime={data.events[data.events.length - 1].connect_time}
          value={scrubCutoff}
          onChange={handleScrubChange}
          playing={playing}
          onTogglePlay={handleTogglePlay}
        />
      ) : null}
    </>
  );
}

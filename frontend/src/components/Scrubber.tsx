import { Play, Pause } from "lucide-react";

const SLIDER_STEPS = 1000;

function toMillis(iso: string): number {
  return new Date(iso).getTime();
}

function sliderPositionToCutoff(position: number, startTime: string, endTime: string): string | null {
  const startMs = toMillis(startTime);
  const endMs = toMillis(endTime);
  if (position >= SLIDER_STEPS || endMs <= startMs) return null;
  const cutoffMs = startMs + (position / SLIDER_STEPS) * (endMs - startMs);
  return new Date(cutoffMs).toISOString();
}

function cutoffToSliderPosition(value: string | null, startTime: string, endTime: string): number {
  const startMs = toMillis(startTime);
  const endMs = toMillis(endTime);
  if (value === null || endMs <= startMs) return SLIDER_STEPS;
  const ratio = (toMillis(value) - startMs) / (endMs - startMs);
  return Math.round(ratio * SLIDER_STEPS);
}

export function Scrubber({
  startTime,
  endTime,
  value,
  onChange,
  playing,
  onTogglePlay,
}: {
  startTime: string;
  endTime: string;
  value: string | null;
  onChange: (cutoff: string | null) => void;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  const position = cutoffToSliderPosition(value, startTime, endTime);
  const label = value === null ? "maintenant" : new Date(value).toLocaleString();

  return (
    <div className="scrubber">
      <button className="btn-icon" onClick={onTogglePlay} aria-label={playing ? "Pause" : "Lecture"}>
        {playing ? <Pause /> : <Play />}
      </button>
      <input
        type="range"
        className="scrubber-track"
        aria-label="Curseur temporel"
        min={0}
        max={SLIDER_STEPS}
        value={position}
        onChange={(e) => onChange(sliderPositionToCutoff(Number(e.target.value), startTime, endTime))}
      />
      <span className="scrubber-label">{label}</span>
    </div>
  );
}

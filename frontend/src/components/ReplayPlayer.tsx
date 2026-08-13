import { useEffect, useRef } from "react";

declare global {
  interface Window {
    AsciinemaPlayer: {
      create(url: string, element: HTMLElement): { dispose(): void };
    };
  }
}

export function ReplayPlayer({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const replayUrl = `/api/sessions/${encodeURIComponent(sessionId)}/replay`;
    let player: { dispose(): void } | undefined;
    let cancelled = false;

    fetch(replayUrl)
      .then((response) => {
        if (cancelled) return;
        if (response.ok) {
          player = window.AsciinemaPlayer.create(replayUrl, container);
        } else {
          container.textContent = "Replay indisponible pour cette session.";
        }
      })
      .catch(() => {
        if (!cancelled) container.textContent = "Replay indisponible pour cette session.";
      });

    return () => {
      cancelled = true;
      player?.dispose();
    };
  }, [sessionId]);

  return <div ref={containerRef} />;
}

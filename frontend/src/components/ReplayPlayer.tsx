import { useEffect, useRef } from "react";

declare global {
  interface Window {
    AsciinemaPlayer: {
      create(source: string | { data: string }, element: HTMLElement): { dispose(): void };
    };
  }
}

const UNAVAILABLE = "Replay indisponible pour cette session.";

export function ReplayPlayer({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let player: { dispose(): void } | undefined;
    let cancelled = false;

    // One request: the status tells us whether a replay exists, and the body is handed to the
    // player as data instead of letting it download the same recording a second time.
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/replay`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.text();
        if (!cancelled) player = window.AsciinemaPlayer.create({ data }, container);
      })
      .catch(() => {
        if (!cancelled) container.textContent = UNAVAILABLE;
      });

    return () => {
      cancelled = true;
      player?.dispose();
    };
  }, [sessionId]);

  return <div ref={containerRef} />;
}

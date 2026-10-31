import { describe, expect, it } from "vitest";
import { buildSeries } from "./timeSeries";

const NOW = new Date("2026-10-31T14:20:00Z");

describe("buildSeries", () => {
  it("fills 24 hourly buckets ending at the current hour", () => {
    const series = buildSeries([{ bucket: "2026-10-31T12", n: 5, logins: 2 }], "24h", NOW);
    expect(series).toHaveLength(24);
    expect(series[0].key).toBe("2026-10-30T15");
    expect(series[23].key).toBe("2026-10-31T14");
    const hit = series.find((p) => p.key === "2026-10-31T12")!;
    expect(hit).toMatchObject({ n: 5, logins: 2, from: "2026-10-31T12", to: "2026-10-31T13" });
    expect(series.filter((p) => p.n > 0)).toHaveLength(1);
  });

  it("regroups the hourly 7d timeline by day", () => {
    const series = buildSeries(
      [
        { bucket: "2026-10-30T01", n: 2, logins: 1 },
        { bucket: "2026-10-30T22", n: 3, logins: 0 },
      ],
      "7d",
      NOW
    );
    expect(series).toHaveLength(7);
    expect(series.find((p) => p.key === "2026-10-30")).toMatchObject({ n: 5, logins: 1, to: "2026-10-31" });
  });

  it("covers 30 daily buckets for 30d", () => {
    expect(buildSeries([], "30d", NOW)).toHaveLength(30);
  });

  it("spans from the first bucket to today for 'all', monthly beyond 120 days", () => {
    expect(buildSeries([], "all", NOW)).toEqual([]);
    expect(buildSeries([{ bucket: "2026-10-01", n: 1 }], "all", NOW)).toHaveLength(31);
    const monthly = buildSeries([{ bucket: "2026-01-15", n: 4 }], "all", NOW);
    expect(monthly.map((p) => p.key)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
      "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(monthly[0]).toMatchObject({ n: 4, from: "2026-01", to: "2026-02" });
    expect(monthly[9].to).toBe("2026-11");
  });
});

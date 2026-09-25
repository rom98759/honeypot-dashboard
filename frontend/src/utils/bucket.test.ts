import { describe, expect, it } from "vitest";
import { nextBucketBoundary, bucketRangeToDates } from "./bucket";

describe("nextBucketBoundary", () => {
  it("adds one hour to an hour-level bucket", () => {
    expect(nextBucketBoundary("2026-08-12T10")).toBe("2026-08-12T11");
  });

  it("adds one day to a day-level bucket", () => {
    expect(nextBucketBoundary("2026-08-12")).toBe("2026-08-13");
  });

  it("rolls over to the next day when the hour bucket is 23", () => {
    expect(nextBucketBoundary("2026-08-12T23")).toBe("2026-08-13T00");
  });

  it("rolls over to the next month when the day bucket is the month's last day", () => {
    expect(nextBucketBoundary("2026-08-31")).toBe("2026-09-01");
  });
});

describe("bucketRangeToDates", () => {
  it("uses the start bucket as-is and the next bucket after the end as the exclusive upper bound", () => {
    expect(bucketRangeToDates("2026-08-12T10", "2026-08-12T12")).toEqual({
      date_from: "2026-08-12T10",
      date_to: "2026-08-12T13",
    });
  });

  it("handles a single-bucket range (start === end)", () => {
    expect(bucketRangeToDates("2026-08-12", "2026-08-12")).toEqual({
      date_from: "2026-08-12",
      date_to: "2026-08-13",
    });
  });
});

// Bucket labels come from app/periods.py::bucket_expr: "YYYY-MM-DDTHH" (13 chars) for hour-level
// periods (24h/7d), "YYYY-MM-DD" (10 chars) for day-level periods (30d/all). Both are string
// prefixes of a session's connect_time, and SQLite/Python string comparison already orders a
// shorter prefix before any longer string sharing it, so callers can use these labels directly as
// >= bounds — only the exclusive upper bound needs computing.
export function nextBucketBoundary(bucket: string): string {
  const isHourBucket = bucket.length === 13;
  const date = new Date(isHourBucket ? `${bucket}:00:00Z` : `${bucket}T00:00:00Z`);
  date.setUTCHours(date.getUTCHours() + (isHourBucket ? 1 : 24));
  const iso = date.toISOString();
  return isHourBucket ? iso.slice(0, 13) : iso.slice(0, 10);
}

export function bucketRangeToDates(
  startBucket: string,
  endBucket: string
): { date_from: string; date_to: string } {
  return { date_from: startBucket, date_to: nextBucketBoundary(endBucket) };
}

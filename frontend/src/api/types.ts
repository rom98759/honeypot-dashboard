export interface Session {
  session_id: string;
  src_ip: string;
  src_port: number | null;
  protocol: string | null;
  connect_time: string;
  close_time: string | null;
  duration_ms: number | null;
  login_username: string | null;
  login_password: string | null;
  login_success: number | null;
}

export interface Command {
  timestamp: string;
  input_text: string;
}

export interface SessionIpContext {
  ip: string;
  country: string | null;
  country_code: string | null;
  asn: number | null;
  asn_org: string | null;
  sessions: number;
  banned: boolean;
  protected: boolean;
}

export interface SessionCampaign {
  id: string;
  sessions: number;
  sample_command: string | null;
}

export type FileKind = "download" | "redirect" | "upload" | "failed";

export interface SessionFile {
  timestamp: string;
  kind: FileKind;
  shasum: string;
  url: string;
  filename: string;
  size: number | null;
}

export type FileSort = "sessions" | "ips" | "first_seen" | "last_seen";

export interface CapturedFile {
  shasum: string;
  name: string;
  kinds: FileKind[];
  events: number;
  sessions: number;
  ips: number;
  first_seen: string;
  last_seen: string;
  size: number | null;
}

export interface FileList {
  items: CapturedFile[];
  total: number;
  totals: { files: number; events: number; new_7d: number; failed: number };
}

export interface FileDetail {
  shasum: string;
  size: number | null;
  events: number;
  sessions: number;
  ips: number;
  first_seen: string;
  last_seen: string;
  kinds: FileKind[];
  sources: { kind: FileKind; url: string; filename: string; events: number }[];
  recent_events: {
    session_id: string;
    src_ip: string | null;
    timestamp: string;
    kind: FileKind;
    url: string;
    filename: string;
  }[];
  top_ips: { ip: string; sessions: number }[];
}

export interface SessionDetail {
  session: Session;
  commands: Command[];
  ttylogs: string[];
  /** Absent from older API responses. */
  files?: SessionFile[];
  ip: SessionIpContext;
  campaign: SessionCampaign | null;
}

export interface PaginatedSessions {
  items: Session[];
  total: number;
}

export interface OverviewTotals {
  total_connections: number;
  unique_ips: number;
  login_attempts: number;
  avg_duration_ms: number | null;
}

export interface CountryCount {
  country: string;
  country_code: string | null;
  n: number;
}

export interface OverviewData extends OverviewTotals {
  previous: OverviewTotals | null;
  active_sessions: number;
  currently_banned: number;
  last_ban_at: string | null;
  top_offenders: {
    src_ip: string;
    n: number;
    country: string | null;
    country_code?: string | null;
    last_seen: string;
  }[];
  top_countries: CountryCount[];
  countries: CountryCount[];
  timeline: { bucket: string; n: number; logins: number }[];
  protocol_split: { protocol: string; n: number }[];
  top_credentials: { login_username: string; login_password: string | null; n: number }[];
  top_usernames: { value: string; n: number }[];
  top_passwords: { value: string; n: number }[];
  top_commands: { input_text: string; n: number }[];
  total_commands: number;
  bans_timeline: { bucket: string; n: number }[];
  duration_distribution: { bucket: string; n: number }[];
}

export type FilterKey = "country" | "protocol" | "ip" | "username";
export type Filters = Partial<Record<FilterKey, string>>;

export type OverviewPeriod = "24h" | "7d" | "30d" | "all";

export interface HeatmapCell {
  day_of_week: number;
  hour: number;
  n: number;
}

export interface HeatmapData {
  cells: HeatmapCell[];
}

export interface CorrelationRow {
  ip: string;
  honeypot_sessions: number;
  fail2ban_banned: boolean;
  real_ssh_attempts: number;
}

export interface MapEvent {
  ip: string;
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  connect_time: string;
}

export interface MapDestination {
  latitude: number;
  longitude: number;
}

export interface MapData {
  events: MapEvent[];
  destination: MapDestination | null;
}

export type MapPeriod = "24h" | "7d" | "30d" | "all";

export interface IpSummary {
  ip: string;
  country: string | null;
  country_code?: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  first_seen: string | null;
  last_seen: string | null;
  total_sessions: number;
  total_commands: number;
  currently_banned: boolean;
  active_bans: ActiveBan[];
  protected: boolean;
  ban_enabled: boolean;
  asn: number | null;
  asn_org: string | null;
  reverse_dns: string | null;
  abuseipdb_score: number | null;
  abuseipdb_total_reports: number | null;
  abuseipdb_last_reported_at: string | null;
  abuseipdb_configured: boolean;
  enrichment_status: "pending" | "done";
}

export interface ActiveBan {
  jail: string;
  banned_at: string;
  expires_at: string;
  /** services = real SSH, sites and other ports but not the honeypot; all = everything. */
  scope: "services" | "all";
}

export interface Fail2banEvent {
  action: string;
  jail: string;
  timestamp: string;
}

export interface SshdAuthEvent {
  result: string;
  timestamp: string;
}

export interface PaginatedFail2ban {
  items: Fail2banEvent[];
  total: number;
}

export interface PaginatedSshdAuth {
  items: SshdAuthEvent[];
  total: number;
}

export interface CommandRow {
  input_text: string;
  n: number;
  last_seen: string;
}

export interface PaginatedCommands {
  items: CommandRow[];
  total: number;
}

export interface HealthSource {
  source: string;
  path: string;
  file_present: boolean;
  file_size: number | null;
  ingested_offset: number | null;
  lag_bytes: number | null;
  last_event: string | null;
  stalled: boolean;
}

export interface HealthData {
  sources: HealthSource[];
}

export type CampaignSort = "sessions" | "ips" | "first_seen" | "last_seen";

export interface Campaign {
  id: string;
  sessions: number;
  ips: number;
  share: number;
  first_seen: string;
  last_seen: string;
  sample_session_id: string;
  sample_command: string | null;
  variants: number;
  activity: number[];
}

export interface CampaignList {
  items: Campaign[];
  total: number;
  totals: {
    campaigns: number;
    sessions: number;
    new_7d: number;
    unique_sessions: number;
    top_share: number;
    login_only: { sessions: number; ips: number };
  };
}

export interface CampaignDetail {
  id: string;
  sessions: number;
  ips: number;
  first_seen: string;
  last_seen: string;
  sample_session_id: string;
  top_asn: { asn: number; asn_org: string | null; share: number } | null;
  top_prefix: { prefix: string; share: number } | null;
  top_ips: { ip: string; sessions: number }[];
  commands: { timestamp: string; input_text: string }[];
  variant_count: number;
  variants: { id: string; sessions: number }[];
}

export interface UniqueSession {
  session_id: string;
  src_ip: string;
  connect_time: string;
  duration_ms: number | null;
  commands: number;
  first_command: string | null;
}

export interface UniqueSessionList {
  items: UniqueSession[];
  total: number;
}

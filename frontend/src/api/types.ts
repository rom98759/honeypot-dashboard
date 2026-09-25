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

export interface SessionDetail {
  session: Session;
  commands: Command[];
}

export interface PaginatedSessions {
  items: Session[];
  total: number;
}

export interface OverviewData {
  total_connections: number;
  unique_ips: number;
  login_attempts: number;
  currently_banned: number;
  top_offenders: { src_ip: string; n: number; country: string | null; last_seen: string }[];
  top_countries: { country: string; n: number }[];
  timeline: { bucket: string; n: number }[];
  protocol_split: { protocol: string; n: number }[];
  top_credentials: { login_username: string; login_password: string | null; n: number }[];
  bans_timeline: { bucket: string; n: number }[];
  duration_distribution: { bucket: string; n: number }[];
}

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

export interface MapPoint {
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  session_count: number;
  ips: string[];
}

export interface MapDestination {
  latitude: number;
  longitude: number;
}

export interface MapData {
  points: MapPoint[];
  destination: MapDestination | null;
}

export type MapPeriod = "24h" | "7d" | "30d" | "all";

export interface IpSummary {
  ip: string;
  country: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  first_seen: string | null;
  last_seen: string | null;
  total_sessions: number;
  total_commands: number;
  currently_banned: boolean;
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

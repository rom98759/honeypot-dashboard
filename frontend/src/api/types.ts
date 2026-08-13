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
  top_ips: { src_ip: string; n: number }[];
  top_countries: { country: string; n: number }[];
  timeline: { hour: string; n: number }[];
}

export interface CorrelationRow {
  ip: string;
  honeypot_sessions: number;
  fail2ban_banned: boolean;
  real_ssh_attempts: number;
}

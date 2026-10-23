export type Domain =
  | "Curation"
  | "Marketing"
  | "EPM"
  | "PRxEditing"
  | "Design"
  | "Tech"
  | "Core";

export type Role = "TE" | "SE" | "Core Member";

export interface Member {
  name: string;
  domain: Domain;
  role: Role;
}

export type AttendanceState = "Present" | "Absent";

export interface AttendanceRecord {
  memberName: string;
  domain: Domain;
  role: Role;
  state: AttendanceState;
}

/** A single member's attendance mark, as submitted by a TE. */
export interface AttendanceChange {
  memberName: string;
  state: AttendanceState;
}

export interface AuthSession {
  username: string;
  domain: Domain;
  role: Role;
}

/** Shape of `GET /api/attendance`. */
export interface AttendanceResponse {
  date: string;
  /** The domain actually served — which may not be the one a client asked for. */
  domain: Domain;
  records: AttendanceRecord[];
  /** Epoch ms at which the Core override expires; 0 when there is none. */
  overrideEndMs: number;
  /** The server's clock, so the countdown does not trust the device's. */
  serverTimeMs: number;
}

/** Shape of a successful `POST /api/attendance`. */
export interface AttendanceSaveResponse {
  success: true;
  date: string;
  domain: Domain;
  saved: number;
  createdDateColumn: boolean;
  appendedMembers: string[];
  auditFailed: boolean;
  /** Authoritative state after the save, including other TEs' concurrent marks. */
  records: AttendanceRecord[];
  serverTimeMs: number;
}

export interface MemberStat {
  memberName: string;
  role: Role;
  present: number;
  /** Number of dates recorded in the sheet so far. */
  total: number;
  percentage: number;
}

export interface DateStat {
  date: string;
  present: number;
  absent: number;
  percentage: number;
}

export interface DomainAnalytics {
  domain: Domain;
  today: string;
  totalMembers: number;
  presentToday: number;
  absentToday: number;
  todayPercentage: number;
  /** Whether today's column exists in the sheet yet. */
  todayRecorded: boolean;
  overallPercentage: number;
  memberStats: MemberStat[];
  dateStats: DateStat[];
}

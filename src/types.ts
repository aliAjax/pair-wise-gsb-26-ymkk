export type DeviceRole = "client" | "counselor";
export type DeviceStatus = "connected" | "disconnected" | "stopped";
export type SessionStatus = "active" | "ended";
export type EventKind = "device" | "risk" | "progress" | "session" | "summary";

/** 接入会谈的一台设备端点 */
export interface DeviceEndpoint {
  id: string;
  name: string;
  role: DeviceRole;
  status: DeviceStatus;
  /** 该设备最后确认到的分钟 */
  confirmedMinute: number;
  joinedAt: string;
  lastEventAt: string;
}

/** 会谈时间线段落，risk 为风险话题 */
export interface TimelineSegment {
  start: number;
  end: number;
  topic: string;
  risk: boolean;
}

/** 一次“确认到第 N 分钟”的确认点 */
export interface ConfirmationPoint {
  id: string;
  minute: number;
  deviceId: string;
  deviceName: string;
  at: string;
}

/** 风险话题中掉线形成的挂起：保留原进度，待咨询师确认情绪稳定 */
export interface RiskHold {
  id: string;
  topic: string;
  holdMinute: number;
  droppedDevice: string;
  droppedAt: string;
  resolvedAt: string | null;
}

export interface SessionEvent {
  id: string;
  at: string;
  kind: EventKind;
  text: string;
}

/** 纪要版本：每次修改另存一版并记录原因 */
export interface SummaryVersion {
  version: number;
  content: string;
  reason: string;
  savedAt: string;
}

export interface Session {
  id: string;
  clientCode: string;
  theme: string;
  title: string;
  date: string;
  totalMinutes: number;
  status: SessionStatus;
  /** 会谈当前进行到的分钟（播放游标） */
  cursorMinute: number;
  /** 双方最后共同确认到的分钟，接续以此为锚 */
  confirmedMinute: number;
  devices: DeviceEndpoint[];
  timeline: TimelineSegment[];
  confirmations: ConfirmationPoint[];
  riskHolds: RiskHold[];
  events: SessionEvent[];
  summaryVersions: SummaryVersion[];
  endedAt: string | null;
}

export interface ConsoleState {
  sessions: Session[];
  selectedId: string;
}

// 跨设备续接台：领域类型定义

export type Role = "counselor" | "client";

// online=在线；offline=网络中断；stopped=被新接入的同角色设备接替而停止
export type DeviceState = "online" | "offline" | "stopped";

export type SessionStatus = "ongoing" | "ended";

export type EventKind =
  | "created"
  | "join"
  | "takeover"
  | "offline"
  | "reconnect"
  | "risk"
  | "emotion"
  | "resume"
  | "confirm"
  | "end"
  | "minute";

export interface Device {
  id: string;
  sessionId: string;
  role: Role;
  /** 设备机型，如 “手机 (iPhone 15)” */
  kind: string;
  /** 端名称，如 “来访者端 · 手机” */
  label: string;
  /** 所在标签页 ID；演示种子数据为 null（不属于任何已打开页面） */
  tabId: string | null;
  state: DeviceState;
  joinedAt: number;
  lastSeenAt: number;
  /** 被哪个设备接替 */
  stoppedBy?: string;
}

export interface SessionEvent {
  id: string;
  ts: number;
  kind: EventKind;
  text: string;
}

export interface Confirmation {
  id: string;
  /** 确认到的分钟（整数） */
  minute: number;
  ts: number;
  deviceId: string;
  deviceLabel: string;
  note: string;
}

export interface MinuteVersion {
  id: string;
  version: number;
  ts: number;
  editorLabel: string;
  /** 修订原因；首版（自动生成）为空 */
  reason?: string;
  content: string;
}

export interface Session {
  id: string;
  rev: number;
  clientCode: string;
  topic: string;
  status: SessionStatus;
  startedAt: number;
  endedAt?: number;
  plannedMinutes: number;
  /** 当前会谈进度（分钟，可为小数） */
  playheadMinute: number;
  /** 上次计时心跳时间戳，用于跨标签页按真实时间推进 */
  lastTickAt?: number;
  devices: Device[];
  events: SessionEvent[];
  confirmations: Confirmation[];
  minutes: MinuteVersion[];
  /** 是否正在谈风险话题 */
  riskActive: boolean;
  /** 风险话题中断后的冻结闸门 */
  riskHold: boolean;
  /** 咨询师是否已确认来访者情绪稳定 */
  emotionConfirmed: boolean;
  currentDeviceId?: string;
}

import type { Device, Session } from "../types";

export interface ConsoleProps {
  session: Session;
  tabId: string;
  me?: Device;
  mutate: (sessionId: string, fn: (s: Session) => Session) => void;
}

const stateText: Record<string, string> = {
  online: "在线",
  offline: "网络中断",
  stopped: "已停止",
};

export function DeviceStatePill({ state }: { state: Device["state"] }) {
  return <span className={`pill state-${state}`}>{stateText[state]}</span>;
}

export function eventKindColor(kind: string): string {
  if (kind === "offline" || kind === "risk") return "dot-danger";
  if (kind === "takeover" || kind === "emotion" || kind === "resume") return "dot-warn";
  if (kind === "confirm" || kind === "reconnect") return "dot-ok";
  return "dot-muted";
}

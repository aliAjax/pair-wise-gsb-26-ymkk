import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "./types";
import { buildSeed, uid } from "./model";

const STORE_KEY = "hxwl12.handoff.sessions.v1";
const CHANNEL_NAME = "hxwl12-handoff";
const TAB_KEY = "hxwl12.handoff.tab";

/** 每个标签页有固定 tabId（重开页面后视为新设备，符合“新设备接入”语义） */
export function getTabId(): string {
  let id = sessionStorage.getItem(TAB_KEY);
  if (!id) {
    id = uid();
    sessionStorage.setItem(TAB_KEY, id);
  }
  return id;
}

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Session[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* 数据损坏时回落到演示数据 */
  }
  const seed = buildSeed();
  persist(seed);
  return seed;
}

function persist(sessions: Session[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(sessions));
}

/**
 * 会话存储：
 * - 所有变更落 localStorage，重开页面可找回；
 * - BroadcastChannel 跨标签页广播（模拟跨设备），storage 事件兜底。
 */
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastRemoteRev = useRef<Record<string, number>>({});

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current = channel;
      channel.onmessage = (e: MessageEvent<{ sessions: Session[] }>) => {
        if (!e.data?.sessions) return;
        lastRemoteRev.current = revMap(e.data.sessions);
        setSessions(e.data.sessions);
      };
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORE_KEY || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue) as Session[];
        lastRemoteRev.current = revMap(next);
        setSessions(next);
      } catch {
        /* 忽略无法解析的广播 */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      channel?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /** 对单场会谈做纯函数式修改，并持久化 + 广播 */
  const mutate = useCallback((sessionId: string, fn: (s: Session) => Session) => {
    setSessions((prev) => {
      const next = prev.map((s) => {
        if (s.id !== sessionId) return s;
        const clone: Session = JSON.parse(JSON.stringify(s)) as Session;
        const updated = fn(clone);
        if (updated !== clone) updated.rev = (updated.rev || 0) + 1;
        return updated;
      });
      persist(next);
      channelRef.current?.postMessage({ sessions: next });
      return next;
    });
  }, []);

  const addSession = useCallback((s: Session) => {
    setSessions((prev) => {
      const next = [s, ...prev];
      persist(next);
      channelRef.current?.postMessage({ sessions: next });
      return next;
    });
  }, []);

  const resetDemo = useCallback(() => {
    const seed = buildSeed();
    persist(seed);
    channelRef.current?.postMessage({ sessions: seed });
    setSessions(seed);
  }, []);

  return { sessions, mutate, addSession, resetDemo };
}

function revMap(sessions: Session[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const s of sessions) map[s.id] = s.rev;
  return map;
}

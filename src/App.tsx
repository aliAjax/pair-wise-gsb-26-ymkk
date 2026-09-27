import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import { DeviceDock } from "./components/DeviceDock";
import { MinutesPanel } from "./components/MinutesPanel";
import { ProgressConsole } from "./components/ProgressConsole";
import { SessionList } from "./components/SessionList";
import { createSession, myDevice, tickSession } from "./model";
import { getTabId, useSessions } from "./store";

const TICK_MS = 1000;

function App() {
  const tabId = useMemo(getTabId, []);
  const { sessions, mutate, addSession, resetDemo } = useSessions();
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => sessions[0]?.id
  );

  const session = sessions.find((s) => s.id === selectedId) ?? sessions[0];
  const me = session ? myDevice(session, tabId) : undefined;

  // 新建会谈事件（来自侧栏表单）：本标签页以咨询师端发起
  useEffect(() => {
    const onCreate = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        clientCode: string;
        topic: string;
        plannedMinutes: number;
        kind: string;
      };
      const s = createSession({
        clientCode: detail.clientCode,
        topic: detail.topic,
        plannedMinutes: detail.plannedMinutes,
        kind: detail.kind,
        role: "counselor",
        tabId,
      });
      addSession(s);
      setSelectedId(s.id);
    };
    window.addEventListener("hxwl:create-session", onCreate);
    return () => window.removeEventListener("hxwl:create-session", onCreate);
  }, [addSession, tabId]);

  // 会谈计时心跳：按真实流逝时间推进（多标签页不倍速）；冻结/离线/结束由 tickSession 内部判断
  useEffect(() => {
    const timer = window.setInterval(() => {
      for (const s of sessions) {
        if (s.status !== "ongoing") continue;
        mutate(s.id, (cur) => tickSession(cur));
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [sessions, mutate]);

  if (!session) {
    return (
      <main className="app-shell">
        <p>暂无会谈。</p>
      </main>
    );
  }

  const consoleProps = { session, tabId, me, mutate };

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">hxwl-12 · port 5112</p>
          <h1>心理咨询个案 · 跨设备续接台</h1>
          <p className="subtitle">
            每场会谈记录设备、确认到的分钟与连接状态；新设备接入先停旧端并接走最后确认位置。
            风险话题掉线时冻结进度，情绪稳定确认后方可继续；结束按确认点出纪要，修订另存原因版本。
          </p>
        </div>
        <div className="stack-card">
          <span>本标签页设备身份</span>
          <strong>{me ? me.label : "尚未接入任何设备"}</strong>
          <span>
            {me
              ? me.state === "online"
                ? "连接正常"
                : me.state === "offline"
                ? "本端网络中断"
                : "本端已被接替停止"
              : "多开标签页即可模拟另一台设备"}
          </span>
        </div>
      </header>

      <div className="console-layout">
        <SessionList
          sessions={sessions}
          selectedId={session.id}
          onSelect={setSelectedId}
          tabId={tabId}
          onReset={() => {
            resetDemo();
            setSelectedId(undefined);
          }}
        />
        <div className="console-main">
          <DeviceDock {...consoleProps} />
          <ProgressConsole {...consoleProps} />
          <MinutesPanel {...consoleProps} />
        </div>
      </div>
    </main>
  );
}

export default App;

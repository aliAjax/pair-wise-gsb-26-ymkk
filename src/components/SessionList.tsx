import { useState } from "react";
import type { Session } from "../types";
import { fmtTime, lastConfirmedMinute } from "../model";

interface Props {
  sessions: Session[];
  selectedId?: string;
  onSelect: (id: string) => void;
  tabId: string;
  onReset: () => void;
}

export function SessionList({ sessions, selectedId, onSelect, tabId, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const [clientCode, setClientCode] = useState("");
  const [topic, setTopic] = useState("");
  const [planned, setPlanned] = useState("50");
  const [kind, setKind] = useState("笔记本");

  const submit = () => {
    // 延迟创建真正的 Session（需要 mutate 能力），改为通过自定义事件交给 App
    const detail = {
      clientCode: clientCode.trim() || `C-${Math.floor(100 + Math.random() * 900)}`,
      topic: topic.trim() || "初次会谈",
      plannedMinutes: Math.max(10, parseInt(planned, 10) || 50),
      kind,
    };
    window.dispatchEvent(new CustomEvent("hxwl:create-session", { detail }));
    setClientCode("");
    setTopic("");
    setPlanned("50");
    setKind("笔记本");
    setOpen(false);
  };

  return (
    <div className="panel sidebar">
      <div className="sidebar-head">
        <div>
          <p className="eyebrow">个案续接台</p>
          <h2>会谈场次</h2>
        </div>
        <button className="primary-action small" onClick={() => setOpen((v) => !v)}>
          {open ? "收起" : "新建会谈"}
        </button>
      </div>

      {open && (
        <div className="create-form">
          <label>
            <span>来访者代号</span>
            <input
              value={clientCode}
              onChange={(e) => setClientCode(e.target.value)}
              placeholder="如 C-318"
            />
          </label>
          <label>
            <span>咨询主题</span>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="如 焦虑 · 睡眠"
            />
          </label>
          <label>
            <span>计划时长（分钟）</span>
            <input
              type="number"
              min={10}
              value={planned}
              onChange={(e) => setPlanned(e.target.value)}
            />
          </label>
          <label>
            <span>发起设备</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option>笔记本</option>
              <option>台式机</option>
              <option>手机</option>
              <option>平板</option>
            </select>
          </label>
          <p className="form-hint">本页面将以「咨询师端 · {kind}」身份发起会谈</p>
          <button className="primary-action" onClick={submit}>
            开始会谈
          </button>
        </div>
      )}

      <div className="session-list">
        {sessions.map((s) => {
          const active = s.id === selectedId;
          const offline = s.devices.some(
            (d) => d.state === "offline" && d.tabId !== tabId
          );
          return (
            <button
              key={s.id}
              className={`session-item${active ? " active" : ""}${
                s.riskHold ? " risk" : ""
              }`}
              onClick={() => onSelect(s.id)}
            >
              <span className={`session-dot ${s.riskHold ? "dot-danger-bg" : s.status === "ended" ? "dot-muted-bg" : offline ? "dot-warn-bg" : "dot-ok-bg"}`} />
              <span className="session-item-main">
                <strong>{s.clientCode}</strong>
                <em>{s.topic}</em>
              </span>
              <span className="session-item-meta">
                {s.status === "ended"
                  ? "已结束"
                  : s.riskHold
                  ? "风险冻结"
                  : `${lastConfirmedMinute(s)}′ 已确认`}
                <small>{fmtTime(s.startedAt)}</small>
              </span>
            </button>
          );
        })}
      </div>

      <div className="sidebar-foot">
        <p>多开浏览器标签页即模拟新设备接入，状态实时同步。</p>
        <button className="ghost-btn" onClick={onReset}>
          重置为演示数据
        </button>
      </div>
    </div>
  );
}

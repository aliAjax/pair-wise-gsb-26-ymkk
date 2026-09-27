import { useState } from "react";
import {
  DEVICE_KINDS,
  fmtTime,
  joinDevice,
  markOffline,
  roleName,
} from "../model";
import type { Role } from "../types";
import { ConsoleProps, DeviceStatePill } from "./common";

export function DeviceDock({ session, tabId, me, mutate }: ConsoleProps) {
  const [role, setRole] = useState<Role>("client");
  const [kind, setKind] = useState("手机");

  const takenOver = !!me && me.state === "stopped" && session.status === "ongoing";

  return (
    <section className="panel dock-panel">
      <div className="section-heading">
        <div>
          <p>设备与连接</p>
          <h2>续接设备坞</h2>
        </div>
        <span className={`pill ${session.status === "ongoing" ? "state-online" : "state-stopped"}`}>
          {session.status === "ongoing" ? "会谈进行中" : "会谈已结束"}
        </span>
      </div>

      {takenOver && (
        <div className="notice warn">
          <strong>本端已被新{roleName(me.role)}接替并停止</strong>
          <span>
            最后确认位置已由新端接走，本端不可再继续记录。可换一种设备重新接入。
          </span>
          <button
            className="primary-action small"
            onClick={() =>
              mutate(session.id, (s) =>
                joinDevice(s, { role: me.role, kind: me.kind, tabId })
              )
            }
          >
            以 {me.kind} 重新接入
          </button>
        </div>
      )}

      <div className="device-grid">
        {session.devices.map((d) => {
          const isMe = d.tabId === tabId;
          const stopper = session.devices.find((x) => x.id === d.stoppedBy);
          return (
            <article
              key={d.id}
              className={`device-card device-${d.state}${isMe ? " mine" : ""}`}
            >
              <header>
                <div>
                  <strong>{d.label}</strong>
                  {isMe && <span className="me-tag">本标签页</span>}
                </div>
                <DeviceStatePill state={d.state} />
              </header>
              <dl>
                <div>
                  <dt>接入时间</dt>
                  <dd>{fmtTime(d.joinedAt)}</dd>
                </div>
                <div>
                  <dt>最后在线</dt>
                  <dd>{fmtTime(d.lastSeenAt)}</dd>
                </div>
                {d.state === "stopped" && (
                  <div className="full">
                    <dt>接替去向</dt>
                    <dd>{stopper ? stopper.label : "已由新端接替"}</dd>
                  </div>
                )}
              </dl>
              {isMe && d.state === "online" && session.status === "ongoing" && (
                <button
                  className="danger-outline small"
                  onClick={() =>
                    mutate(session.id, (s) => markOffline(s, d.id))
                  }
                >
                  模拟本端网络中断
                </button>
              )}
            </article>
          );
        })}
      </div>

      {session.status === "ongoing" && (!me || me.state !== "stopped") && (
        <div className="join-bar">
          <div className="join-fields">
            <label>
              <span>新设备角色</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="client">来访者端</option>
                <option value="counselor">咨询师端</option>
              </select>
            </label>
            <label>
              <span>设备机型</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {DEVICE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.value}（{k.hint}）
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="primary-action"
            onClick={() =>
              mutate(session.id, (s) => joinDevice(s, { role, kind, tabId }))
            }
          >
            新设备接入本标签页
          </button>
          <p className="form-hint">
            接入时同角色旧端会先被停止，新端从最后确认分钟续接。
          </p>
        </div>
      )}
    </section>
  );
}

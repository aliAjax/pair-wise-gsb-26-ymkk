import { useState } from "react";
import type { Device } from "../types";
import {
  confirmEmotion,
  confirmPoint,
  endSession,
  fmtClock,
  fmtTime,
  lastConfirmedMinute,
  markReconnected,
  resumeAfterRisk,
  toggleRisk,
} from "../model";
import { ConsoleProps, eventKindColor } from "./common";

export function ProgressConsole({ session, tabId, me, mutate }: ConsoleProps) {
  const [note, setNote] = useState("");
  const anchor = lastConfirmedMinute(session);
  const pct = Math.min(100, (session.playheadMinute / session.plannedMinutes) * 100);
  const offlineDevices = session.devices.filter((d) => d.state === "offline");
  const isCounselor = me?.role === "counselor" && me.state === "online";
  const frozen = session.riskHold;

  const recover = (d: Device) =>
    mutate(session.id, (s) => markReconnected(s, d.id));

  return (
    <section className="panel console-panel">
      <div className="section-heading">
        <div>
          <p>{session.clientCode} · {fmtTime(session.startedAt)} 开始</p>
          <h2>{session.topic}</h2>
        </div>
        <div className="heading-side">
          <span className={`pill ${frozen ? "state-offline" : "state-online"}`}>
            {frozen ? "风险冻结中" : session.riskActive ? "风险话题" : "连接正常"}
          </span>
        </div>
      </div>

      {/* 风险闸门 */}
      {frozen && (
        <div className="notice danger">
          <strong>风险话题中断 · 进度已冻结在 {fmtClock(anchor)}</strong>
          <span>
            掉线发生在风险话题期间，已保留原进度并回退到最后确认点；
            未经情绪稳定确认，任何设备都不能继续。
          </span>
          {isCounselor ? (
            <div className="gate-actions">
              <button
                className="primary-action small"
                disabled={session.emotionConfirmed}
                onClick={() => mutate(session.id, (s) => confirmEmotion(s, me.id))}
              >
                {session.emotionConfirmed ? "✓ 已确认情绪稳定" : "确认来访者情绪稳定"}
              </button>
              <button
                className="primary-action"
                disabled={!session.emotionConfirmed}
                onClick={() => mutate(session.id, (s) => resumeAfterRisk(s, me.id))}
              >
                从第 {anchor} 分钟继续会谈
              </button>
            </div>
          ) : (
            <p className="gate-hint">
              {me
                ? `本端为${me.role === "client" ? "来访者端" : "已停止/离线端"}，请在线咨询师端完成情绪确认`
                : "请先以在线咨询师端接入本标签页，再完成情绪确认"}
            </p>
          )}
        </div>
      )}

      {/* 普通掉线提示 */}
      {!frozen && offlineDevices.length > 0 && (
        <div className="notice warn">
          <strong>{offlineDevices.length} 个设备网络中断</strong>
          <span>
            进度锚定在最后确认点 {fmtClock(anchor)}；设备重连后将从该位置继续，
            掉线期间内容需重新走一遍确认。
          </span>
          <div className="gate-actions">
            {offlineDevices.map((d) => (
              <button key={d.id} className="small" onClick={() => recover(d)}>
                {d.tabId === tabId ? "本端重新连接" : `模拟 ${d.label} 网络恢复`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 进度时间线 */}
      <div className={`timeline-wrap${frozen ? " frozen" : ""}`}>
        <div className="timeline-meta">
          <div>
            <span className="meta-label">当前进度</span>
            <strong>{fmtClock(session.playheadMinute)}</strong>
          </div>
          <div>
            <span className="meta-label">最后确认</span>
            <strong>{anchor} 分钟</strong>
          </div>
          <div>
            <span className="meta-label">计划时长</span>
            <strong>{session.plannedMinutes} 分钟</strong>
          </div>
        </div>
        <div className={`timeline${session.riskActive ? " risk" : ""}`}>
          <div className="timeline-confirmed" style={{ width: `${pct}%` }} />
          <div className="timeline-cursor" style={{ left: `${pct}%` }} />
          {session.confirmations.map((c) => (
            <i
              key={c.id}
              className="timeline-tick"
              title={`第 ${c.minute} 分钟 · ${c.note}`}
              style={{
                left: `${Math.min(100, (c.minute / session.plannedMinutes) * 100)}%`,
              }}
            />
          ))}
        </div>
        <p className="timeline-note">
          {frozen
            ? "已冻结：确认点之后的分钟不计入，重连不跳进度。"
            : session.riskActive
            ? "正在谈风险话题：此时掉线将自动冻结，需情绪确认后恢复。"
            : "绿色为已确认区间；新设备接入或重连一律从最后确认刻度续接。"}
        </p>
      </div>

      {session.status === "ongoing" && (
        <div className="control-row">
          {isCounselor ? (
            <>
              <button
                className={session.riskActive ? "danger-outline" : ""}
                onClick={() => mutate(session.id, toggleRisk)}
              >
                {session.riskActive ? "解除风险话题标记" : "标记风险话题"}
              </button>
              <div className="confirm-box">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={`确认第 ${Math.floor(session.playheadMinute)} 分钟前的内容（可填要点）`}
                />
                <button
                  className="primary-action"
                  disabled={frozen}
                  onClick={() => {
                    mutate(session.id, (s) => confirmPoint(s, me.id, note));
                    setNote("");
                  }}
                >
                  确认到第 {Math.floor(session.playheadMinute)} 分钟
                </button>
              </div>
              <button
                className="danger-outline"
                disabled={frozen}
                title={frozen ? "风险冻结解除后才能结束" : "按确认点生成纪要"}
                onClick={() => {
                  if (window.confirm("结束后将按确认点生成纪要 v1，未确认内容不纳入。确认结束本场会谈？")) {
                    mutate(session.id, (s) => endSession(s, me.id));
                  }
                }}
              >
                结束会谈并生成纪要
              </button>
            </>
          ) : (
            <p className="control-hint">
              {me
                ? `当前为${me.role === "client" ? "来访者端" : "非在线端"}：确认进度、风险闸门与会谈结束由在线咨询师端操作；本端掉线重连后自动从最后确认点续接。`
                : "本标签页尚未接入设备。使用上方“新设备接入”加入会谈；咨询师操作请以咨询师端身份接入。"}
            </p>
          )}
        </div>
      )}

      <div className="two-col">
        <div className="sub-block">
          <h3>确认点（{session.confirmations.length}）</h3>
          {session.confirmations.length === 0 && <p className="muted-note">尚无确认点。</p>}
          <ol className="confirm-list">
            {[...session.confirmations].reverse().map((c) => (
              <li key={c.id}>
                <div className="confirm-minute">{c.minute}′</div>
                <div>
                  <p>{c.note}</p>
                  <small>
                    {c.deviceLabel} · {fmtTime(c.ts)}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="sub-block">
          <h3>连接与确认事件流</h3>
          <ul className="event-log">
            {session.events.slice(0, 14).map((e) => (
              <li key={e.id}>
                <i className={`event-dot ${eventKindColor(e.kind)}`} />
                <div>
                  <p>{e.text}</p>
                  <small>{fmtTime(e.ts)}</small>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

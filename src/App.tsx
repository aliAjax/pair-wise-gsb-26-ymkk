import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import type { ConsoleState, DeviceRole, Session } from "./types";
import {
  activeRiskHold,
  advanceCursor,
  confirmAtCursor,
  connectedDevice,
  endSession,
  fmtClock,
  fmtDateTime,
  joinDevice,
  loadState,
  resetState,
  resolveRiskHold,
  roleLabel,
  saveState,
  saveSummaryVersion,
  segmentAt,
  simulateDrop,
  statusLabel,
} from "./sessionStore";

const project = {
  id: "hxwl-12",
  port: 5112,
  title: "心理咨询个案记录 · 跨设备续接台",
  subtitle:
    "远程会谈中记录每台接入设备、确认到的分钟与连接状态；新设备接入先停旧端、从最后确认位置接续；风险话题掉线保留进度，确认情绪稳定后继续；会谈结束按确认点生成纪要，修改另存原因版本。",
};

function MetricCard({ label, value, index }: { label: string; value: string; index: number }) {
  const colors = ["status-ok", "status-watch", "status-danger", "status-ok"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={colors[index % colors.length]} />
    </article>
  );
}

/** 时间线：段落、已确认进度、当前游标 */
function TimelineBar({ session }: { session: Session }) {
  const pct = (m: number) => `${(m / session.totalMinutes) * 100}%`;
  return (
    <div className="timeline">
      <div className="timeline-track">
        <div className="timeline-confirmed" style={{ width: pct(session.confirmedMinute) }} />
        {session.timeline.map((seg) => (
          <div
            key={seg.topic}
            className={`timeline-seg${seg.risk ? " risk" : ""}`}
            style={{ left: pct(seg.start), width: pct(seg.end - seg.start) }}
            title={`${seg.topic} ${seg.start}–${seg.end} 分钟`}
          />
        ))}
        <div className="timeline-cursor" style={{ left: pct(session.cursorMinute) }} />
      </div>
      <div className="timeline-labels">
        {session.timeline.map((seg) => (
          <div
            key={seg.topic}
            className={seg.risk ? "risk" : ""}
            style={{ left: pct(seg.start), width: pct(seg.end - seg.start) }}
          >
            {seg.risk ? "⚠ " : ""}
            {seg.topic}
            <small>
              {seg.start}–{seg.end}′
            </small>
          </div>
        ))}
      </div>
      <div className="timeline-legend">
        <span>
          <i className="legend-confirmed" /> 已确认至 {session.confirmedMinute} 分钟
        </span>
        <span>
          <i className="legend-cursor" /> 当前 {session.cursorMinute} 分钟
        </span>
        <span>
          <i className="legend-risk" /> 风险话题
        </span>
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState<ConsoleState>(loadState);
  const [deviceName, setDeviceName] = useState("");
  const [deviceRole, setDeviceRole] = useState<DeviceRole>("client");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [summaryReason, setSummaryReason] = useState("");
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);

  useEffect(() => saveState(state), [state]);

  const session =
    state.sessions.find((s) => s.id === state.selectedId) ?? state.sessions[0];
  const hold = activeRiskHold(session);
  const online = connectedDevice(session);
  const currentSeg = segmentAt(session, session.cursorMinute);
  const ended = session.status === "ended";
  const latestSummary = session.summaryVersions[session.summaryVersions.length - 1] ?? null;

  // 切换会谈或生成新版本时，把最新纪要载入编辑框
  useEffect(() => {
    setSummaryDraft(latestSummary?.content ?? "");
    setSummaryReason("");
    setExpandedVersion(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.summaryVersions.length]);

  const metrics = useMemo(() => {
    const active = state.sessions.filter((s) => s.status === "active").length;
    const holds = state.sessions.filter((s) => activeRiskHold(s)).length;
    const confirmed = state.sessions.reduce((n, s) => n + s.confirmedMinute, 0);
    const versions = state.sessions.reduce((n, s) => n + s.summaryVersions.length, 0);
    return [
      { label: "进行中会谈", value: String(active) },
      { label: "风险话题挂起", value: String(holds) },
      { label: "已确认分钟合计", value: String(confirmed) },
      { label: "纪要版本总数", value: String(versions) },
    ];
  }, [state.sessions]);

  const update = (fn: (s: Session) => Session) =>
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => (s.id === session.id ? fn(s) : s)),
    }));

  const canProgress = !ended && !!online && !hold;
  const blockReason = ended
    ? "会谈已结束"
    : hold
      ? "风险话题挂起中，需先确认情绪稳定"
      : !online
        ? "当前无已连接设备，请先接入"
        : null;

  const submitJoin = () => {
    const name = deviceName.trim();
    if (!name) return;
    update((s) => joinDevice(s, name, deviceRole));
    setDeviceName("");
  };

  const submitSummary = () => {
    const reason = summaryReason.trim();
    if (!reason || !summaryDraft.trim()) return;
    update((s) => saveSummaryVersion(s, summaryDraft, reason));
    setSummaryReason("");
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">{project.id} · port {project.port}</p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>续接规则</span>
          <strong>新设备接入 → 旧端先停止 → 从最后确认分钟接续</strong>
          <strong>风险话题掉线 → 保留进度 → 确认情绪稳定后继续</strong>
          <button onClick={() => setState(resetState())}>重置演示数据</button>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, i) => (
          <MetricCard key={m.label} label={m.label} value={m.value} index={i} />
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>会谈列表</h2>
          <div className="session-list">
            {state.sessions.map((s) => {
              const sHold = activeRiskHold(s);
              return (
                <button
                  key={s.id}
                  className={`session-item${s.id === session.id ? " selected" : ""}`}
                  onClick={() => setState((prev) => ({ ...prev, selectedId: s.id }))}
                >
                  <span className="session-item-head">
                    <strong>
                      {s.clientCode} · {s.theme}
                    </strong>
                    <em className={s.status === "active" ? "badge badge-ok" : "badge badge-muted"}>
                      {s.status === "active" ? "进行中" : "已结束"}
                    </em>
                  </span>
                  <span className="session-item-sub">
                    {s.title} · {s.date} · 确认至 {s.confirmedMinute}/{s.totalMinutes} 分钟
                  </span>
                  {sHold && <span className="badge badge-risk">风险挂起 · {sHold.topic}</span>}
                </button>
              );
            })}
          </div>
          <h2>角色</h2>
          <div className="chips">
            <span>咨询师</span>
            <span>督导</span>
            <span>机构管理员</span>
          </div>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>
                {session.clientCode} · {session.theme} · {session.date}
              </p>
              <h2>
                {session.title} 续接台
                <em className={ended ? "badge badge-muted" : "badge badge-ok"}>
                  {ended ? "已结束" : "进行中"}
                </em>
              </h2>
            </div>
            {!ended && (
              <button className="primary-action" onClick={() => update(endSession)}>
                结束会谈并生成纪要
              </button>
            )}
          </div>

          <TimelineBar session={session} />
          <p className="cursor-readout">
            当前段落：{currentSeg ? `${currentSeg.topic}（${currentSeg.start}–${currentSeg.end} 分钟）` : "—"}
            {currentSeg?.risk && <em className="badge badge-risk">风险话题</em>}
          </p>

          {hold && (
            <div className="risk-banner">
              <div>
                <strong>风险话题挂起中 · 「{hold.topic}」</strong>
                <p>
                  「{hold.droppedDevice}」于 {fmtClock(hold.droppedAt)} 掉线，进度保留在{" "}
                  {hold.holdMinute} 分钟。来访者重新接入后，需咨询师确认情绪稳定才能继续。
                </p>
              </div>
              <button
                className="risk-resolve"
                disabled={!online}
                title={online ? "确认情绪稳定并继续" : "请先让来访者重新接入"}
                onClick={() => update(resolveRiskHold)}
              >
                咨询师确认情绪稳定，继续会谈
              </button>
            </div>
          )}

          <div className="controls">
            <div className="controls-buttons">
              <button disabled={!canProgress} onClick={() => update((s) => advanceCursor(s, 1))}>
                +1 分钟
              </button>
              <button disabled={!canProgress} onClick={() => update((s) => advanceCursor(s, 5))}>
                +5 分钟
              </button>
              <button
                className="primary-action"
                disabled={!canProgress}
                onClick={() => update(confirmAtCursor)}
              >
                确认到当前分钟（{session.cursorMinute}′）
              </button>
            </div>
            {blockReason && <p className="controls-hint">{blockReason}</p>}
            {!blockReason && online && (
              <p className="controls-hint ok">由「{online.name}」确认 · 确认点将记入纪要</p>
            )}
          </div>

          <h3 className="subheading">接入设备</h3>
          <div className="device-list">
            {session.devices.map((d) => (
              <article key={d.id} className={`device-card device-${d.status}`}>
                <div className="device-main">
                  <strong>{d.name}</strong>
                  <span className="chip">{roleLabel(d.role)}</span>
                  <em
                    className={
                      d.status === "connected"
                        ? "badge badge-ok"
                        : d.status === "disconnected"
                          ? "badge badge-warn"
                          : "badge badge-muted"
                    }
                  >
                    {statusLabel(d.status)}
                  </em>
                </div>
                <div className="device-meta">
                  确认至 {d.confirmedMinute} 分钟 · 最近动态 {fmtClock(d.lastEventAt)}
                </div>
                {!ended && d.status === "connected" && (
                  <button className="danger-action" onClick={() => update((s) => simulateDrop(s, d.id))}>
                    模拟掉线
                  </button>
                )}
                {!ended && d.status !== "connected" && (
                  <button onClick={() => update((s) => joinDevice(s, d.name, d.role, d.id))}>
                    从此设备接入
                  </button>
                )}
              </article>
            ))}
          </div>

          {!ended && (
            <div className="join-form">
              <input
                placeholder="新设备名称，如：来访者平板 · iPad"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitJoin()}
              />
              <select value={deviceRole} onChange={(e) => setDeviceRole(e.target.value as DeviceRole)}>
                <option value="client">来访者端</option>
                <option value="counselor">咨询师端</option>
              </select>
              <button className="primary-action" disabled={!deviceName.trim()} onClick={submitJoin}>
                接入新设备
              </button>
            </div>
          )}
          <p className="controls-hint">
            接入新设备时，同角色已连接的旧端会先停止，新端从最后确认的 {session.confirmedMinute} 分钟接续。
          </p>

          <h3 className="subheading">连接动态</h3>
          <div className="event-log">
            {[...session.events].reverse().map((e) => (
              <div key={e.id} className={`event-row kind-${e.kind}`}>
                <span className="event-time">{fmtClock(e.at)}</span>
                <span>{e.text}</span>
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>按确认点生成 · 修改另存原因版本 · 重开页面可找回</p>
            <h2>会谈纪要</h2>
          </div>
          {latestSummary && (
            <span className="badge badge-muted">
              共 {session.summaryVersions.length} 版 · 最新第 {latestSummary.version} 版 ·{" "}
              {fmtDateTime(latestSummary.savedAt)}
            </span>
          )}
        </div>

        {!latestSummary && (
          <p className="empty-hint">会谈结束后将按确认点自动生成纪要；进行中可先在上方维护确认点。</p>
        )}

        {latestSummary && (
          <>
            <textarea
              className="summary-editor"
              rows={14}
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
            />
            <div className="join-form summary-actions">
              <input
                placeholder="修改原因（必填），如：补充督导建议"
                value={summaryReason}
                onChange={(e) => setSummaryReason(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitSummary()}
              />
              <button
                className="primary-action"
                disabled={!summaryReason.trim() || !summaryDraft.trim()}
                onClick={submitSummary}
              >
                另存为新版本
              </button>
            </div>

            <h3 className="subheading">版本历史</h3>
            <div className="version-list">
              {[...session.summaryVersions].reverse().map((v) => (
                <article key={v.version} className="version-item">
                  <button
                    className="version-head"
                    onClick={() =>
                      setExpandedVersion(expandedVersion === v.version ? null : v.version)
                    }
                  >
                    <strong>第 {v.version} 版</strong>
                    <span>{v.reason}</span>
                    <em>{fmtDateTime(v.savedAt)}</em>
                  </button>
                  {expandedVersion === v.version && (
                    <pre className="version-content">{v.content}</pre>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default App;

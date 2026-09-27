import { useState } from "react";
import { attachForAmendment, fmtDate, fmtTime, saveMinuteVersion } from "../model";
import { ConsoleProps } from "./common";

export function MinutesPanel({ session, tabId, me, mutate }: ConsoleProps) {
  const [showVersions, setShowVersions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");

  if (session.status !== "ended") {
    return (
      <section className="panel minutes-panel">
        <div className="section-heading">
          <div>
            <p>会谈纪要</p>
            <h2>结束后按确认点生成</h2>
          </div>
        </div>
        <p className="muted-note">
          当前已有 {session.confirmations.length} 个确认点。点击“结束会谈并生成纪要”后，
          系统将只依据已确认分段生成纪要正文；第 {
            session.confirmations.reduce((m, c) => Math.max(m, c.minute), 0)
          }{" "}
          分钟之后未确认的内容不会被写入。
        </p>
      </section>
    );
  }

  const current = session.minutes[session.minutes.length - 1];
  const canEdit = !!me && me.role === "counselor" && me.state === "online";

  const startEdit = () => {
    setDraft(current.content);
    setReason("");
    setEditing(true);
  };

  const save = () => {
    if (!me || !reason.trim() || !draft.trim()) return;
    mutate(session.id, (s) => saveMinuteVersion(s, draft, reason, me.label));
    setEditing(false);
    setDraft("");
    setReason("");
  };

  return (
    <section className="panel minutes-panel">
      <div className="section-heading">
        <div>
          <p>会谈纪要 · 重开页面仍可找回</p>
          <h2>
            {session.clientCode} · 当前 v{current.version}
          </h2>
        </div>
        <div className="heading-actions">
          <button className="small" onClick={() => setShowVersions((v) => !v)}>
            {showVersions ? "收起版本" : `版本记录（${session.minutes.length}）`}
          </button>
          {!editing &&
            (canEdit ? (
              <button className="primary-action small" onClick={startEdit}>
                修订纪要（另存版本）
              </button>
            ) : (
              <button
                className="primary-action small"
                onClick={() =>
                  mutate(session.id, (s) =>
                    attachForAmendment(s, { kind: "笔记本", tabId })
                  )
                }
              >
                以咨询师端接入补录
              </button>
            ))}
        </div>
      </div>

      {showVersions && (
        <div className="version-list">
          {[...session.minutes].reverse().map((v) => (
            <article
              key={v.id}
              className={`version-card${v.version === current.version ? " current" : ""}`}
            >
              <header>
                <strong>v{v.version}</strong>
                <span>
                  {v.reason ? `修订 · 原因：${v.reason}` : "按确认点自动生成"}
                </span>
              </header>
              <p className="version-meta">
                {v.editorLabel} · {fmtTime(v.ts)}
                {v.version === current.version && <em className="current-tag">当前版本</em>}
              </p>
              <pre className="version-content">{v.content}</pre>
            </article>
          ))}
        </div>
      )}

      {!showVersions &&
        (editing ? (
          <div className="minute-edit">
            <label>
              <span>纪要正文（在 v{current.version} 基础上修订）</span>
              <textarea rows={12} value={draft} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <label>
              <span>修订原因（必填，将随新版本留存）</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="如：督导复核后补充风险评估结论"
              />
            </label>
            <div className="heading-actions">
              <button onClick={() => setEditing(false)}>放弃</button>
              <button
                className="primary-action"
                disabled={!reason.trim() || !draft.trim()}
                onClick={save}
              >
                另存为 v{session.minutes.length + 1}
              </button>
            </div>
          </div>
        ) : (
          <pre className="current-minute">{current.content}</pre>
        ))}

      <p className="persist-note">
        纪要与全部版本保存在本机（localStorage），结束于{" "}
        {session.endedAt ? fmtDate(session.endedAt) : "—"}
        {canEdit ? "" : "；需要修订时以咨询师端接入即可补录，旧版本不会被覆盖。"}
      </p>
    </section>
  );
}

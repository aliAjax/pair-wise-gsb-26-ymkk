import type {
  ConfirmationPoint,
  ConsoleState,
  DeviceEndpoint,
  DeviceRole,
  RiskHold,
  Session,
  SessionEvent,
  EventKind,
  SummaryVersion,
} from "./types";

const STORAGE_KEY = "hxwl12.continuation.v1";

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString("zh-CN")} ${fmtClock(iso)}`;
}

export function roleLabel(role: DeviceRole): string {
  return role === "client" ? "来访者端" : "咨询师端";
}

export function statusLabel(status: DeviceEndpoint["status"]): string {
  if (status === "connected") return "已连接";
  if (status === "disconnected") return "已掉线";
  return "已停止";
}

export function activeRiskHold(session: Session): RiskHold | null {
  const hold = session.riskHolds.find((h) => h.resolvedAt === null);
  return hold ?? null;
}

export function connectedDevice(session: Session): DeviceEndpoint | null {
  return session.devices.find((d) => d.status === "connected") ?? null;
}

export function segmentAt(session: Session, minute: number) {
  return (
    session.timeline.find((s) => minute >= s.start && minute < s.end) ??
    session.timeline[session.timeline.length - 1] ??
    null
  );
}

function ev(kind: EventKind, text: string, at?: string): SessionEvent {
  return { id: uid(), at: at ?? nowIso(), kind, text };
}

/* ---------------- 持久化：重开页面可找回 ---------------- */

export function loadState(): ConsoleState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ConsoleState;
      if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
        return parsed;
      }
    }
  } catch {
    // 本地数据损坏时回退到演示数据
  }
  return seedState();
}

export function saveState(state: ConsoleState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时静默失败，页面内状态仍可用
  }
}

export function resetState(): ConsoleState {
  const fresh = seedState();
  saveState(fresh);
  return fresh;
}

/* ---------------- 领域操作（均为纯函数，返回新 Session） ---------------- */

/** 推进游标；有风险挂起或未连接设备时不允许 */
export function advanceCursor(session: Session, delta: number): Session {
  if (session.status !== "active") return session;
  if (activeRiskHold(session) || !connectedDevice(session)) return session;
  const cursorMinute = Math.min(session.totalMinutes, session.cursorMinute + delta);
  return { ...session, cursorMinute };
}

/** 在当前游标处打一个确认点 */
export function confirmAtCursor(session: Session): Session {
  if (session.status !== "active") return session;
  const device = connectedDevice(session);
  if (!device || activeRiskHold(session)) return session;
  const at = nowIso();
  const point: ConfirmationPoint = {
    id: uid(),
    minute: session.cursorMinute,
    deviceId: device.id,
    deviceName: device.name,
    at,
  };
  const devices = session.devices.map((d) =>
    d.id === device.id ? { ...d, confirmedMinute: session.cursorMinute, lastEventAt: at } : d
  );
  return {
    ...session,
    confirmedMinute: session.cursorMinute,
    confirmations: [...session.confirmations, point],
    devices,
    events: [
      ...session.events,
      ev("progress", `「${device.name}」确认至 ${session.cursorMinute} 分钟`, at),
    ],
  };
}

/** 模拟网络中断；若发生在风险话题段落则形成挂起，保留原进度 */
export function simulateDrop(session: Session, deviceId: string): Session {
  if (session.status !== "active") return session;
  const device = session.devices.find((d) => d.id === deviceId);
  if (!device || device.status !== "connected") return session;
  const at = nowIso();
  const devices = session.devices.map((d) =>
    d.id === deviceId ? { ...d, status: "disconnected" as const, lastEventAt: at } : d
  );
  const seg = segmentAt(session, session.cursorMinute);
  const events = [
    ...session.events,
    ev("device", `「${device.name}」网络中断掉线（第 ${session.cursorMinute} 分钟）`, at),
  ];
  let riskHolds = session.riskHolds;
  if (seg?.risk && !activeRiskHold(session)) {
    const hold: RiskHold = {
      id: uid(),
      topic: seg.topic,
      holdMinute: session.confirmedMinute,
      droppedDevice: device.name,
      droppedAt: at,
      resolvedAt: null,
    };
    riskHolds = [...session.riskHolds, hold];
    events.push(
      ev(
        "risk",
        `掉线发生在风险话题「${seg.topic}」，进度保留在 ${session.confirmedMinute} 分钟，待咨询师确认情绪稳定`,
        at
      )
    );
  }
  return { ...session, devices, events, riskHolds };
}

/**
 * 设备接入（新设备或旧设备重连）：
 * 先让同角色的旧端停下，再从最后确认的位置接续。
 */
export function joinDevice(
  session: Session,
  name: string,
  role: DeviceRole,
  existingId?: string
): Session {
  if (session.status !== "active") return session;
  const at = nowIso();
  const anchor = session.confirmedMinute;
  const events = [...session.events];

  // 先让旧端停下
  const stoppedNames: string[] = [];
  let devices = session.devices.map((d) => {
    if (d.role === role && d.status === "connected" && d.id !== existingId) {
      stoppedNames.push(d.name);
      return { ...d, status: "stopped" as const, lastEventAt: at };
    }
    return d;
  });
  for (const n of stoppedNames) {
    events.push(ev("device", `新设备接入，旧端「${n}」已停止`, at));
  }

  let joinedName = name;
  if (existingId) {
    const target = devices.find((d) => d.id === existingId);
    if (!target) return session;
    joinedName = target.name;
    devices = devices.map((d) =>
      d.id === existingId
        ? { ...d, status: "connected" as const, confirmedMinute: anchor, lastEventAt: at }
        : d
    );
  } else {
    const device: DeviceEndpoint = {
      id: uid(),
      name,
      role,
      status: "connected",
      confirmedMinute: anchor,
      joinedAt: at,
      lastEventAt: at,
    };
    devices = [...devices, device];
  }

  events.push(
    ev("device", `「${joinedName}」（${roleLabel(role)}）接入，从最后确认的 ${anchor} 分钟继续`, at)
  );
  return { ...session, devices, events, cursorMinute: anchor };
}

/** 咨询师确认情绪稳定，解除风险挂起，从保留的进度继续 */
export function resolveRiskHold(session: Session): Session {
  const hold = activeRiskHold(session);
  if (!hold || session.status !== "active") return session;
  const at = nowIso();
  const riskHolds = session.riskHolds.map((h) =>
    h.id === hold.id ? { ...h, resolvedAt: at } : h
  );
  return {
    ...session,
    riskHolds,
    cursorMinute: hold.holdMinute,
    events: [
      ...session.events,
      ev("risk", `咨询师确认来访者情绪稳定，从保留的 ${hold.holdMinute} 分钟继续会谈`, at),
    ],
  };
}

/** 结束会谈：全部端点停止，按确认点生成纪要 */
export function endSession(session: Session): Session {
  if (session.status !== "active") return session;
  const at = nowIso();
  const devices = session.devices.map((d) =>
    d.status === "connected" ? { ...d, status: "stopped" as const, lastEventAt: at } : d
  );
  const ended: Session = {
    ...session,
    status: "ended",
    endedAt: at,
    devices,
    events: [...session.events, ev("session", `会谈结束，确认至 ${session.confirmedMinute} 分钟`, at)],
  };
  const summary: SummaryVersion = {
    version: 1,
    content: generateSummary(ended),
    reason: "会谈结束自动生成",
    savedAt: at,
  };
  return { ...ended, summaryVersions: [summary] };
}

/** 修改纪要：另存为新版本并记录原因 */
export function saveSummaryVersion(
  session: Session,
  content: string,
  reason: string
): Session {
  const at = nowIso();
  const version: SummaryVersion = {
    version: session.summaryVersions.length + 1,
    content,
    reason,
    savedAt: at,
  };
  return {
    ...session,
    summaryVersions: [...session.summaryVersions, version],
    events: [
      ...session.events,
      ev("summary", `纪要另存为第 ${version.version} 版：${reason}`, at),
    ],
  };
}

/* ---------------- 纪要生成：按确认点组织 ---------------- */

export function generateSummary(session: Session): string {
  const lines: string[] = [];
  const mm = (m: number) => String(m).padStart(2, "0");

  lines.push(`会谈纪要 · ${session.clientCode} ${session.theme}（${session.title}）`);
  lines.push(
    `会谈日期 ${session.date} · 计划 ${session.totalMinutes} 分钟 · 确认至 ${session.confirmedMinute} 分钟` +
      (session.endedAt ? ` · 结束于 ${fmtClock(session.endedAt)}` : "")
  );
  lines.push("");

  lines.push("一、段落确认情况");
  session.timeline.forEach((seg, i) => {
    const tag = seg.risk ? "（风险话题）" : "";
    const range = `${mm(seg.start)}–${mm(seg.end)} 分钟`;
    const covering = session.confirmations
      .filter((c) => c.minute >= seg.end)
      .sort((a, b) => a.minute - b.minute)[0];
    const partial = session.confirmations
      .filter((c) => c.minute > seg.start && c.minute < seg.end)
      .sort((a, b) => b.minute - a.minute)[0];
    let status: string;
    if (covering) {
      status = `已确认（${fmtClock(covering.at)} · ${covering.deviceName}）`;
    } else if (partial) {
      status = `部分确认至 ${partial.minute} 分钟（${partial.deviceName}）`;
    } else {
      status = "未覆盖";
    }
    lines.push(`${i + 1}. ${range} ${seg.topic}${tag} —— ${status}`);
  });
  lines.push("");

  lines.push(`二、确认点（共 ${session.confirmations.length} 个）`);
  if (session.confirmations.length === 0) {
    lines.push("- 本次会谈未产生确认点");
  } else {
    for (const c of session.confirmations) {
      lines.push(`- ${fmtClock(c.at)} 确认至 ${c.minute} 分钟 · ${c.deviceName}`);
    }
  }
  lines.push("");

  lines.push("三、设备接续与连接");
  const deviceEvents = session.events.filter((e) => e.kind === "device");
  if (deviceEvents.length === 0) {
    lines.push("- 无设备变更");
  } else {
    for (const e of deviceEvents) lines.push(`- ${fmtClock(e.at)} ${e.text}`);
  }
  lines.push("");

  lines.push("四、风险话题处理");
  if (session.riskHolds.length === 0) {
    lines.push("- 本次会谈未发生风险话题中断");
  } else {
    for (const h of session.riskHolds) {
      lines.push(
        `- ${fmtClock(h.droppedAt)} 「${h.droppedDevice}」在风险话题「${h.topic}」中掉线，进度保留在 ${h.holdMinute} 分钟`
      );
      if (h.resolvedAt) {
        lines.push(`- ${fmtClock(h.resolvedAt)} 咨询师确认情绪稳定，自 ${h.holdMinute} 分钟继续`);
      } else {
        lines.push("- 挂起尚未解除，继续前需咨询师确认情绪稳定");
      }
    }
  }
  lines.push("");

  const uncovered = session.timeline.filter(
    (seg) => !session.confirmations.some((c) => c.minute >= seg.end)
  );
  lines.push("五、待跟进");
  if (uncovered.length === 0) {
    lines.push("- 全部段落均已确认");
  } else {
    lines.push(
      `- 未覆盖段落：${uncovered
        .map((s) => `${mm(s.start)}–${mm(s.end)} 分钟 ${s.topic}`)
        .join("；")}`
    );
  }

  return lines.join("\n");
}

/* ---------------- 演示数据 ---------------- */

function seedState(): ConsoleState {
  const T = (hh: number, m: number, s: number) =>
    `2026-09-27T${String(hh).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  const dev = (
    name: string,
    role: DeviceRole,
    status: DeviceEndpoint["status"],
    confirmedMinute: number,
    joinedAt: string,
    lastEventAt: string
  ): DeviceEndpoint => ({
    id: uid(),
    name,
    role,
    status,
    confirmedMinute,
    joinedAt,
    lastEventAt,
  });

  const cp = (minute: number, deviceId: string, deviceName: string, at: string): ConfirmationPoint => ({
    id: uid(),
    minute,
    deviceId,
    deviceName,
    at,
  });

  // C-042：进行中，双方在线，已确认至 16 分钟
  const s1Client = dev("来访者手机 · iPhone", "client", "connected", 16, T(10, 0, 3), T(10, 16, 20));
  const s1Counselor = dev("咨询师工作电脑", "counselor", "connected", 16, T(9, 58, 41), T(10, 16, 20));
  const s1: Session = {
    id: "s-c042",
    clientCode: "C-042",
    theme: "焦虑",
    title: "第 3 次会谈",
    date: "2026-09-27",
    totalMinutes: 50,
    status: "active",
    cursorMinute: 16,
    confirmedMinute: 16,
    devices: [s1Counselor, s1Client],
    timeline: [
      { start: 0, end: 10, topic: "建立安全感与目标澄清", risk: false },
      { start: 10, end: 20, topic: "日常压力梳理", risk: false },
      { start: 20, end: 28, topic: "自伤念头探索", risk: true },
      { start: 28, end: 40, topic: "认知重构练习", risk: false },
      { start: 40, end: 50, topic: "总结与作业布置", risk: false },
    ],
    confirmations: [
      cp(5, s1Client.id, s1Client.name, T(10, 5, 12)),
      cp(10, s1Client.id, s1Client.name, T(10, 10, 2)),
      cp(16, s1Client.id, s1Client.name, T(10, 16, 20)),
    ],
    riskHolds: [],
    events: [
      ev("device", `「${s1Counselor.name}」（咨询师端）接入，从最后确认的 0 分钟继续`, T(9, 58, 41)),
      ev("device", `「${s1Client.name}」（来访者端）接入，从最后确认的 0 分钟继续`, T(10, 0, 3)),
      ev("progress", `「${s1Client.name}」确认至 5 分钟`, T(10, 5, 12)),
      ev("progress", `「${s1Client.name}」确认至 10 分钟`, T(10, 10, 2)),
      ev("progress", `「${s1Client.name}」确认至 16 分钟`, T(10, 16, 20)),
    ],
    summaryVersions: [],
    endedAt: null,
  };

  // C-119：风险话题中掉线，进度保留在 22 分钟，等待确认情绪稳定
  const s2Client = dev("来访者家中电脑", "client", "disconnected", 22, T(14, 0, 22), T(14, 24, 51));
  const s2Counselor = dev("咨询师平板 · iPad", "counselor", "connected", 22, T(13, 59, 10), T(14, 22, 5));
  const s2: Session = {
    id: "s-c119",
    clientCode: "C-119",
    theme: "亲密关系",
    title: "第 5 次会谈",
    date: "2026-09-27",
    totalMinutes: 50,
    status: "active",
    cursorMinute: 24,
    confirmedMinute: 22,
    devices: [s2Counselor, s2Client],
    timeline: [
      { start: 0, end: 10, topic: "近期互动回顾", risk: false },
      { start: 10, end: 22, topic: "沟通模式识别", risk: false },
      { start: 22, end: 30, topic: "冲突事件复盘", risk: true },
      { start: 30, end: 42, topic: "非暴力表达练习", risk: false },
      { start: 42, end: 50, topic: "总结与约定", risk: false },
    ],
    confirmations: [
      cp(8, s2Client.id, s2Client.name, T(14, 8, 40)),
      cp(15, s2Client.id, s2Client.name, T(14, 15, 18)),
      cp(22, s2Client.id, s2Client.name, T(14, 22, 5)),
    ],
    riskHolds: [
      {
        id: uid(),
        topic: "冲突事件复盘",
        holdMinute: 22,
        droppedDevice: s2Client.name,
        droppedAt: T(14, 24, 51),
        resolvedAt: null,
      },
    ],
    events: [
      ev("device", `「${s2Counselor.name}」（咨询师端）接入，从最后确认的 0 分钟继续`, T(13, 59, 10)),
      ev("device", `「${s2Client.name}」（来访者端）接入，从最后确认的 0 分钟继续`, T(14, 0, 22)),
      ev("progress", `「${s2Client.name}」确认至 8 分钟`, T(14, 8, 40)),
      ev("progress", `「${s2Client.name}」确认至 15 分钟`, T(14, 15, 18)),
      ev("progress", `「${s2Client.name}」确认至 22 分钟`, T(14, 22, 5)),
      ev("device", `「${s2Client.name}」网络中断掉线（第 24 分钟）`, T(14, 24, 51)),
      ev("risk", "掉线发生在风险话题「冲突事件复盘」，进度保留在 22 分钟，待咨询师确认情绪稳定", T(14, 24, 51)),
    ],
    summaryVersions: [],
    endedAt: null,
  };

  // C-203：已结束，纪要已有两版
  const s3Client = dev("来访者手机 · 安卓", "client", "stopped", 50, T(16, 0, 12), T(16, 50, 2));
  const s3Counselor = dev("咨询师工作电脑", "counselor", "stopped", 50, T(15, 58, 55), T(16, 50, 2));
  const s3Base: Session = {
    id: "s-c203",
    clientCode: "C-203",
    theme: "职业压力",
    title: "第 2 次会谈",
    date: "2026-09-26",
    totalMinutes: 50,
    status: "ended",
    cursorMinute: 50,
    confirmedMinute: 50,
    devices: [s3Counselor, s3Client],
    timeline: [
      { start: 0, end: 10, topic: "本周压力事件回顾", risk: false },
      { start: 10, end: 24, topic: "边界感练习", risk: false },
      { start: 24, end: 34, topic: "倦怠情绪探索", risk: true },
      { start: 34, end: 44, topic: "资源盘点与支持系统", risk: false },
      { start: 44, end: 50, topic: "总结与下周目标", risk: false },
    ],
    confirmations: [
      cp(10, s3Client.id, s3Client.name, "2026-09-26T16:10:08"),
      cp(24, s3Client.id, s3Client.name, "2026-09-26T16:24:31"),
      cp(34, s3Client.id, s3Client.name, "2026-09-26T16:34:44"),
      cp(44, s3Client.id, s3Client.name, "2026-09-26T16:44:19"),
      cp(50, s3Client.id, s3Client.name, "2026-09-26T16:50:02"),
    ],
    riskHolds: [],
    events: [
      ev("device", `「${s3Counselor.name}」（咨询师端）接入，从最后确认的 0 分钟继续`, "2026-09-26T15:58:55"),
      ev("device", `「${s3Client.name}」（来访者端）接入，从最后确认的 0 分钟继续`, "2026-09-26T16:00:12"),
      ev("progress", `「${s3Client.name}」确认至 10 分钟`, "2026-09-26T16:10:08"),
      ev("progress", `「${s3Client.name}」确认至 24 分钟`, "2026-09-26T16:24:31"),
      ev("progress", `「${s3Client.name}」确认至 34 分钟`, "2026-09-26T16:34:44"),
      ev("progress", `「${s3Client.name}」确认至 44 分钟`, "2026-09-26T16:44:19"),
      ev("progress", `「${s3Client.name}」确认至 50 分钟`, "2026-09-26T16:50:02"),
      ev("session", "会谈结束，确认至 50 分钟", "2026-09-26T16:50:30"),
      ev("summary", "纪要另存为第 2 版：补充督导建议与下次目标", "2026-09-26T18:12:07"),
    ],
    summaryVersions: [],
    endedAt: "2026-09-26T16:50:30",
  };
  const s3v1 = generateSummary(s3Base);
  const s3: Session = {
    ...s3Base,
    summaryVersions: [
      { version: 1, content: s3v1, reason: "会谈结束自动生成", savedAt: "2026-09-26T16:50:30" },
      {
        version: 2,
        content: `${s3v1}\n\n六、督导建议（补充）\n- 下次会谈继续跟进边界练习的落实情况\n- 建议来访者记录一周情绪日记，下次带来讨论`,
        reason: "补充督导建议与下次目标",
        savedAt: "2026-09-26T18:12:07",
      },
    ],
  };

  return { sessions: [s1, s2, s3], selectedId: s1.id };
}

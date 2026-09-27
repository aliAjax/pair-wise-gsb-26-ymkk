import type {
  Confirmation,
  Device,
  EventKind,
  MinuteVersion,
  Role,
  Session,
  SessionEvent,
} from "./types";

export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const nowTs = (): number => Date.now();

/** 设备机型预设 */
export const DEVICE_KINDS: { value: string; hint: string }[] = [
  { value: "手机", hint: "iPhone / 安卓" },
  { value: "笔记本", hint: "MacBook / Windows" },
  { value: "平板", hint: "iPad / Android Pad" },
  { value: "台式机", hint: "桌面浏览器" },
];

export function roleName(role: Role): string {
  return role === "counselor" ? "咨询师端" : "来访者端";
}

export function makeLabel(role: Role, kind: string): string {
  return `${roleName(role)} · ${kind}`;
}

/** 最后确认到的分钟；没有确认点则从 0 开始 */
export function lastConfirmedMinute(s: Session): number {
  return s.confirmations.reduce((m, c) => Math.max(m, c.minute), 0);
}

export function findDevice(s: Session, deviceId?: string): Device | undefined {
  return s.devices.find((d) => d.id === deviceId);
}

export function myDevice(s: Session, tabId: string): Device | undefined {
  return s.devices.find((d) => d.tabId === tabId);
}

/** 已停止（被接替）的设备不可再操作 */
export function isUsable(d?: Device): boolean {
  return !!d && d.state !== "stopped";
}

export function pushEvent(s: Session, kind: EventKind, text: string): void {
  const ev: SessionEvent = { id: uid(), ts: nowTs(), kind, text };
  s.events.unshift(ev);
}

/** 按分钟:秒格式化 */
export function fmtClock(minute: number): string {
  const m = Math.floor(minute);
  const sec = Math.round((minute - m) * 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

/* ----------------------------- 会话生命周期 ----------------------------- */

export function createSession(input: {
  clientCode: string;
  topic: string;
  plannedMinutes: number;
  role: Role;
  kind: string;
  tabId: string;
}): Session {
  const s: Session = {
    id: uid(),
    rev: 1,
    clientCode: input.clientCode.trim() || "未编号",
    topic: input.topic.trim() || "（未填写咨询主题）",
    status: "ongoing",
    startedAt: nowTs(),
    plannedMinutes: Math.max(10, Math.round(input.plannedMinutes) || 50),
    playheadMinute: 0,
    devices: [],
    events: [],
    confirmations: [],
    minutes: [],
    riskActive: false,
    riskHold: false,
    emotionConfirmed: false,
    lastTickAt: Date.now(),
  };

  const device: Device = {
    id: uid(),
    sessionId: s.id,
    role: input.role,
    kind: input.kind,
    label: makeLabel(input.role, input.kind),
    tabId: input.tabId,
    state: "online",
    joinedAt: s.startedAt,
    lastSeenAt: s.startedAt,
  };
  s.devices.push(device);
  s.currentDeviceId = device.id;
  pushEvent(s, "created", `会谈建立，${device.label}（${input.kind}）首先接入`);
  return s;
}

/**
 * 新设备接入：
 * 1. 同角色的旧端一律先停下（无论在线/掉线），防止幽灵端从错误位置继续；
 * 2. 新端从最后确认的分钟接上，绝不从未确认的进度继续。
 */
export function joinDevice(
  s: Session,
  input: { role: Role; kind: string; tabId: string }
): Session {
  if (s.status !== "ongoing") return s;
  const lastSeen = nowTs();
  const device: Device = {
    id: uid(),
    sessionId: s.id,
    role: input.role,
    kind: input.kind,
    label: makeLabel(input.role, input.kind),
    tabId: input.tabId,
    state: "online",
    joinedAt: lastSeen,
    lastSeenAt: lastSeen,
  };

  const sameRole = s.devices.filter((d) => d.role === input.role && d.state !== "stopped");
  for (const old of sameRole) {
    old.state = "stopped";
    old.lastSeenAt = lastSeen;
    old.stoppedBy = device.id;
    pushEvent(
      s,
      "takeover",
      `${device.label}接入，${old.label}已停止；旧端最后确认位置 ${lastConfirmedMinute(s)} 分钟由新端接走`
    );
  }
  s.devices.push(device);
  s.currentDeviceId = device.id;

  if (sameRole.length === 0) {
    pushEvent(s, "join", `${device.label}接入会谈`);
  }

  // 接上最后确认点（掉线期间未确认的分钟作废）
  s.playheadMinute = lastConfirmedMinute(s);
  if (s.riskHold) {
    pushEvent(
      s,
      "join",
      `当前处于风险话题中断冻结，进度保持在 ${fmtClock(s.playheadMinute)}，待咨询师确认情绪稳定`
    );
  }
  return s;
}

/** 模拟某设备网络中断；若正谈风险话题则冻结进度 */
export function markOffline(s: Session, deviceId: string): Session {
  const d = findDevice(s, deviceId);
  if (!d || d.state !== "online" || s.status !== "ongoing") return s;
  d.state = "offline";
  d.lastSeenAt = nowTs();
  if (s.riskActive) {
    s.riskHold = true;
    s.emotionConfirmed = false;
    s.playheadMinute = lastConfirmedMinute(s);
    pushEvent(
      s,
      "offline",
      `风险话题进行中，${d.label}网络中断：进度回退并冻结在最后确认点 ${fmtClock(
        s.playheadMinute
      )}，情绪稳定确认前不得继续`
    );
  } else {
    pushEvent(s, "offline", `${d.label}网络中断，进度停在 ${fmtClock(lastConfirmedMinute(s))}`);
  }
  return s;
}

/** 设备网络恢复（但仍需从最后确认位置继续） */
export function markReconnected(s: Session, deviceId: string): Session {
  const d = findDevice(s, deviceId);
  if (!d || d.state !== "offline" || s.status !== "ongoing") return s;
  d.state = "online";
  d.lastSeenAt = nowTs();
  const anchor = lastConfirmedMinute(s);
  s.playheadMinute = anchor;
  s.lastTickAt = nowTs();
  if (s.riskHold) {
    pushEvent(
      s,
      "reconnect",
      `${d.label}已重连，冻结闸门未解除，等待咨询师确认来访者情绪稳定`
    );
  } else {
    pushEvent(
      s,
      "reconnect",
      `${d.label}已重连，从最后确认位置 ${fmtClock(anchor)} 继续（掉线期间内容需重新确认）`
    );
  }
  return s;
}

/** 咨询师确认来访者情绪稳定（风险闸门解除的前置条件） */
export function confirmEmotion(s: Session, deviceId: string): Session {
  const d = findDevice(s, deviceId);
  if (!d || d.role !== "counselor" || !s.riskHold) return s;
  s.emotionConfirmed = true;
  pushEvent(s, "emotion", `${d.label}确认来访者情绪已稳定，可以继续会谈`);
  return s;
}

/** 情绪稳定确认后解除冻结，从最后确认点继续 */
export function resumeAfterRisk(s: Session, deviceId: string): Session {
  const d = findDevice(s, deviceId);
  if (!d || d.role !== "counselor" || !s.riskHold || !s.emotionConfirmed) return s;
  s.riskHold = false;
  s.riskActive = false;
  s.playheadMinute = lastConfirmedMinute(s);
  s.lastTickAt = nowTs();
  pushEvent(
    s,
    "resume",
    `风险闸门解除，会谈从最后确认点 ${fmtClock(s.playheadMinute)} 继续`
  );
  return s;
}

/** 切换风险话题标记 */
export function toggleRisk(s: Session): Session {
  if (s.status !== "ongoing") return s;
  s.riskActive = !s.riskActive;
  pushEvent(
    s,
    "risk",
    s.riskActive ? "标记当前为风险话题（自伤/自杀等）" : "风险话题标记解除"
  );
  return s;
}

/** 咨询师确认一个进度点 */
export function confirmPoint(
  s: Session,
  deviceId: string,
  note: string
): Session {
  const d = findDevice(s, deviceId);
  if (!d || d.role !== "counselor" || s.status !== "ongoing") return s;
  if (s.riskHold) {
    pushEvent(s, "confirm", "风险冻结中，暂不能确认新进度");
    return s;
  }
  const minute = Math.floor(s.playheadMinute);
  const exists = s.confirmations.some((c) => c.minute === minute);
  if (exists) return s;
  const c: Confirmation = {
    id: uid(),
    minute,
    ts: nowTs(),
    deviceId: d.id,
    deviceLabel: d.label,
    note: note.trim() || "已确认本段内容",
  };
  s.confirmations.push(c);
  s.confirmations.sort((a, b) => a.minute - b.minute);
  pushEvent(
    s,
    "confirm",
    `${d.label}确认至第 ${minute} 分钟：${c.note}`
  );
  return s;
}

/**
 * 会谈计时推进；冻结/全员离线/已结束时不走。
 * 按真实流逝毫秒换算分钟，多标签页同时驱动也不会倍速。
 */
export function tickSession(s: Session, at: number = nowTs()): Session {
  // 冻结/已结束：不推进也不写入（解除冻结或重连时会重置 lastTickAt）
  if (s.status !== "ongoing" || s.riskHold) {
    return s;
  }
  const anyOnline = s.devices.some((d) => d.state === "online");
  if (!anyOnline) {
    s.lastTickAt = at;
    return s;
  }
  const prev = s.lastTickAt ?? at;
  // 标签页长时间挂起后恢复，单次最多补 2 分钟，避免进度跳跃
  const delta = Math.min(2, Math.max(0, (at - prev) / 60000));
  s.lastTickAt = at;
  if (delta > 0) {
    s.playheadMinute = Math.min(
      s.plannedMinutes,
      Math.round((s.playheadMinute + delta) * 100) / 100
    );
  }
  return s;
}

/* ------------------------------- 会谈纪要 ------------------------------- */

export function generateMinutes(s: Session): string {
  const lines: string[] = [];
  lines.push(`个案 ${s.clientCode} · 会谈纪要（按确认点生成）`);
  lines.push(`主题：${s.topic}`);
  lines.push(`开始：${fmtDate(s.startedAt)}`);
  lines.push(`结束：${s.endedAt ? fmtDate(s.endedAt) : "—"}`);
  lines.push(`计划时长：${s.plannedMinutes} 分钟 / 最后确认：${lastConfirmedMinute(s)} 分钟`);
  lines.push("");
  lines.push("已确认分段：");
  if (s.confirmations.length === 0) {
    lines.push("（本次会谈无已确认内容，故纪要正文为空）");
  } else {
    s.confirmations.forEach((c, i) => {
      const to =
        i + 1 < s.confirmations.length
          ? `${s.confirmations[i + 1].minute}`
          : `${lastConfirmedMinute(s)}`;
      lines.push(
        `${i + 1}. 第 ${i === 0 ? 0 : s.confirmations[i - 1].minute}–${to} 分钟（${
          c.deviceLabel
        }，${fmtTime(c.ts)} 确认）：${c.note}`
      );
    });
  }
  lines.push("");
  const riskNote =
    s.confirmations.length > 0 && s.playheadMinute > lastConfirmedMinute(s);
  lines.push(
    `未确认部分：${
      riskNote
        ? `第 ${lastConfirmedMinute(s)} 分钟之后存在未确认内容，已按规程不纳入纪要`
        : "无"
    }`
  );
  return lines.join("\n");
}

/** 结束会谈：冻结闸门未解除时不能结束；结束后按确认点自动生成纪要 v1 */
export function endSession(s: Session, deviceId: string): Session {
  const d = findDevice(s, deviceId);
  if (!d || d.role !== "counselor" || s.status !== "ongoing") return s;
  if (s.riskHold) {
    pushEvent(s, "end", "风险冻结中，确认情绪稳定并恢复后才能结束会谈");
    return s;
  }
  s.status = "ended";
  s.endedAt = nowTs();
  s.riskActive = false;
  s.playheadMinute = lastConfirmedMinute(s);
  for (const dev of s.devices) {
    if (dev.state !== "stopped") dev.state = "stopped";
  }
  const content = generateMinutes(s);
  const v1: MinuteVersion = {
    id: uid(),
    version: 1,
    ts: s.endedAt,
    editorLabel: "系统（按确认点生成）",
    content,
  };
  s.minutes = [v1];
  pushEvent(s, "end", `${d.label}结束会谈，已按 ${s.confirmations.length} 个确认点生成纪要 v1`);
  return s;
}

/** 修改纪要：必须填写原因，另存为新版本，不覆盖旧版 */
export function saveMinuteVersion(
  s: Session,
  content: string,
  reason: string,
  editorLabel: string
): Session {
  if (s.status !== "ended" || !reason.trim() || !content.trim()) return s;
  const v: MinuteVersion = {
    id: uid(),
    version: s.minutes.length + 1,
    ts: nowTs(),
    editorLabel,
    reason: reason.trim(),
    content: content,
  };
  s.minutes.push(v);
  pushEvent(
    s,
    "minute",
    `纪要修订并另存为 v${v.version}（原因：${reason.trim()}），修订人：${editorLabel}`
  );
  return s;
}

/**
 * 已结束会谈的补录接入：以在线咨询师端重新挂上（只读补录纪要用），
 * 不改变进度、确认点与连接状态。
 */
export function attachForAmendment(
  s: Session,
  input: { kind: string; tabId: string }
): Session {
  if (s.status !== "ended") return s;
  const ts = nowTs();
  const device: Device = {
    id: uid(),
    sessionId: s.id,
    role: "counselor",
    kind: input.kind,
    label: makeLabel("counselor", input.kind),
    tabId: input.tabId,
    state: "online",
    joinedAt: ts,
    lastSeenAt: ts,
  };
  s.devices.push(device);
  s.currentDeviceId = device.id;
  pushEvent(s, "join", `${device.label}以补录身份重新打开本场已结束会谈`);
  return s;
}

/* ------------------------------- 演示数据 ------------------------------- */

const MIN = 60 * 1000;

export function buildSeed(): Session[] {
  // ① 风险中断冻结中（C-042）
  const start1 = nowTs() - 42 * MIN;
  const a: Session = {
    id: uid(),
    rev: 1,
    clientCode: "C-042",
    topic: "焦虑 · 睡眠与惊恐发作",
    status: "ongoing",
    startedAt: start1,
    plannedMinutes: 50,
    playheadMinute: 12,
    devices: [],
    events: [],
    confirmations: [],
    minutes: [],
    riskActive: true,
    riskHold: true,
    emotionConfirmed: false,
  };
  const d1: Device = {
    id: uid(),
    sessionId: a.id,
    role: "counselor",
    kind: "笔记本",
    label: makeLabel("counselor", "笔记本"),
    tabId: null,
    state: "online",
    joinedAt: start1,
    lastSeenAt: nowTs(),
  };
  const d2: Device = {
    id: uid(),
    sessionId: a.id,
    role: "client",
    kind: "手机",
    label: makeLabel("client", "手机"),
    tabId: null,
    state: "stopped",
    joinedAt: start1,
    lastSeenAt: start1 + 18 * MIN,
  };
  const d3: Device = {
    id: uid(),
    sessionId: a.id,
    role: "client",
    kind: "平板",
    label: makeLabel("client", "平板"),
    tabId: null,
    state: "offline",
    joinedAt: start1 + 18 * MIN,
    lastSeenAt: start1 + 31 * MIN,
  };
  d2.stoppedBy = d3.id;
  a.devices.push(d1, d2, d3);
  a.currentDeviceId = d3.id;
  a.confirmations = [
    {
      id: uid(),
      minute: 0,
      ts: start1 + 6 * MIN,
      deviceId: d1.id,
      deviceLabel: d1.label,
      note: "开场与知情同意，基线情绪评分 6/10",
    },
    {
      id: uid(),
      minute: 12,
      ts: start1 + 19 * MIN,
      deviceId: d1.id,
      deviceLabel: d1.label,
      note: "完成呼吸放松复盘，由平板端接走继续",
    },
  ];
  pushEvent(a, "created", "会谈建立，咨询师端 · 笔记本首先接入");
  pushEvent(a, "confirm", "咨询师端确认至第 0 分钟：开场与知情同意，基线情绪评分 6/10");
  pushEvent(a, "risk", "标记当前为风险话题（来访者谈及夜间惊恐与自伤念头）");
  pushEvent(
    a,
    "takeover",
    "来访者端 · 平板接入，来访者端 · 手机已停止；旧端最后确认位置 12 分钟由新端接走"
  );
  pushEvent(a, "join", "来访者端 · 平板接入会谈");
  pushEvent(a, "confirm", "咨询师端确认至第 12 分钟：完成呼吸放松复盘，由平板端接走继续");
  pushEvent(
    a,
    "offline",
    "风险话题进行中，来访者端 · 平板网络中断：进度回退并冻结在最后确认点 12:00，情绪稳定确认前不得继续"
  );

  // ② 普通续接进行中（C-119）
  const start2 = nowTs() - 26 * MIN;
  const b: Session = {
    id: uid(),
    rev: 1,
    clientCode: "C-119",
    topic: "亲密关系 · 沟通回避模式",
    status: "ongoing",
    startedAt: start2,
    plannedMinutes: 60,
    playheadMinute: 20,
    devices: [],
    events: [],
    confirmations: [],
    minutes: [],
    riskActive: false,
    riskHold: false,
    emotionConfirmed: false,
  };
  const b1: Device = {
    id: uid(),
    sessionId: b.id,
    role: "counselor",
    kind: "台式机",
    label: makeLabel("counselor", "台式机"),
    tabId: null,
    state: "online",
    joinedAt: start2,
    lastSeenAt: nowTs(),
  };
  const b2: Device = {
    id: uid(),
    sessionId: b.id,
    role: "client",
    kind: "手机",
    label: makeLabel("client", "手机"),
    tabId: null,
    state: "stopped",
    joinedAt: start2,
    lastSeenAt: start2 + 11 * MIN,
  };
  const b3: Device = {
    id: uid(),
    sessionId: b.id,
    role: "client",
    kind: "笔记本",
    label: makeLabel("client", "笔记本"),
    tabId: null,
    state: "online",
    joinedAt: start2 + 11 * MIN,
    lastSeenAt: nowTs(),
  };
  b2.stoppedBy = b3.id;
  b.devices.push(b1, b2, b3);
  b.currentDeviceId = b3.id;
  b.confirmations = [
    {
      id: uid(),
      minute: 0,
      ts: start2 + 5 * MIN,
      deviceId: b1.id,
      deviceLabel: b1.label,
      note: "回顾上周作业，情绪平稳",
    },
    {
      id: uid(),
      minute: 20,
      ts: start2 + 22 * MIN,
      deviceId: b1.id,
      deviceLabel: b1.label,
      note: "识别出冲突后沉默的回避模式",
    },
  ];
  pushEvent(b, "created", "会谈建立，咨询师端 · 台式机首先接入");
  pushEvent(b, "confirm", "咨询师端确认至第 0 分钟：回顾上周作业，情绪平稳");
  pushEvent(
    b,
    "takeover",
    "来访者端 · 笔记本接入，来访者端 · 手机已停止；旧端最后确认位置 0 分钟由新端接走"
  );
  pushEvent(b, "join", "来访者端 · 笔记本接入会谈");
  pushEvent(b, "confirm", "咨询师端确认至第 20 分钟：识别出冲突后沉默的回避模式");

  // ③ 已结束、纪要带修订版本（C-203）
  const start3 = nowTs() - 3 * 24 * 60 * MIN;
  const end3 = start3 + 52 * MIN;
  const c: Session = {
    id: uid(),
    rev: 1,
    clientCode: "C-203",
    topic: "职业压力 · 边界练习",
    status: "ended",
    startedAt: start3,
    endedAt: end3,
    plannedMinutes: 50,
    playheadMinute: 46,
    devices: [],
    events: [],
    confirmations: [],
    minutes: [],
    riskActive: false,
    riskHold: false,
    emotionConfirmed: false,
  };
  const c1: Device = {
    id: uid(),
    sessionId: c.id,
    role: "counselor",
    kind: "笔记本",
    label: makeLabel("counselor", "笔记本"),
    tabId: null,
    state: "stopped",
    joinedAt: start3,
    lastSeenAt: end3,
  };
  const c2: Device = {
    id: uid(),
    sessionId: c.id,
    role: "client",
    kind: "手机",
    label: makeLabel("client", "手机"),
    tabId: null,
    state: "stopped",
    joinedAt: start3,
    lastSeenAt: end3,
  };
  c.devices.push(c1, c2);
  c.confirmations = [
    {
      id: uid(),
      minute: 0,
      ts: start3 + 8 * MIN,
      deviceId: c1.id,
      deviceLabel: c1.label,
      note: "评估加班情境与压力源",
    },
    {
      id: uid(),
      minute: 24,
      ts: start3 + 30 * MIN,
      deviceId: c1.id,
      deviceLabel: c1.label,
      note: "梳理可拒绝的三类额外任务",
    },
    {
      id: uid(),
      minute: 46,
      ts: start3 + 50 * MIN,
      deviceId: c1.id,
      deviceLabel: c1.label,
      note: "商定下周边界练习与复盘时间",
    },
  ];
  pushEvent(c, "created", "会谈建立，咨询师端 · 笔记本首先接入");
  pushEvent(c, "confirm", "咨询师端确认至第 0 分钟：评估加班情境与压力源");
  pushEvent(c, "confirm", "咨询师端确认至第 24 分钟：梳理可拒绝的三类额外任务");
  pushEvent(c, "confirm", "咨询师端确认至第 46 分钟：商定下周边界练习与复盘时间");
  pushEvent(c, "end", "咨询师端 · 笔记本结束会谈，已按 3 个确认点生成纪要 v1");
  const baseContent = generateMinutes(c);
  c.minutes = [
    { id: uid(), version: 1, ts: end3, editorLabel: "系统（按确认点生成）", content: baseContent },
    {
      id: uid(),
      version: 2,
      ts: end3 + 35 * MIN,
      editorLabel: "咨询师端 · 笔记本",
      reason: "来访者补充澄清：练习对象为直属主管而非跨部门",
      content:
        baseContent +
        "\n\n【v2 修订】下周边界练习的沟通对象确认为直属主管；话术以“先共情再给方案”为主。",
    },
  ];
  pushEvent(c, "minute", "纪要修订并另存为 v2（原因：来访者补充澄清：练习对象为直属主管而非跨部门），修订人：咨询师端 · 笔记本");

  return [a, b, c];
}

/* 安响 · 前端数据层 v2（SQLite / 服务端权威）
 * ==================================================================
 * 与 v1 的区别：不再使用 localStorage 保存业务数据，也不再在前端保存账号。
 *
 *   - 所有数据来自 server.py 的 /api/* 接口，持久化在 SQLite；
 *   - 登录态是服务端 sessions 表 + HttpOnly Cookie（前端读不到 token）；
 *   - 读取接口保持同步（返回内存快照），因此 app.js 的三维场景代码无需改动；
 *   - 写入接口是异步的：请求成功后重新拉取 /api/state 并广播变更；
 *   - 定时轮询 /api/state，让管理员和网格员两个窗口实时联动。
 *
 * 前端只做展示，角色权限与状态机由服务端强制校验（见 database.py）。
 */
(function (global) {
  "use strict";

  /* ---------- 静态字典（与 database.py 保持一致，供前端渲染使用） ---------- */
  var ROLE = { ADMIN: "admin", GRID: "grid" };
  var STATUS = {
    PENDING: "待接收", CLAIMED: "已接收", CONTACTED: "已联系住户",
    DISPATCHED: "已安排上门", RESOLVED: "已完成"
  };
  var LEVEL_NAME = { 3: "紧急", 2: "较高", 1: "关注" };
  var LEVEL_CLASS = { 3: "urgent", 2: "high", 1: "watch" };

  var BUILDINGS = [
    { id: "A1", name: "A区 1号楼" }, { id: "A2", name: "A区 2号楼" },
    { id: "B3", name: "B区 3号楼" }, { id: "C2", name: "C区 2号楼" },
    { id: "B5", name: "B区 5号楼" }
  ];
  var RESIDENTS = [
    { id: "AX-001", name: "周慧兰", age: 78, ageText: "78 岁", building: "B3", floor: 31, unit: "2单元", room: "3102", care: "独居 · 重点关怀", contact: "周敏（女儿）", phone: "138 **** 6721" },
    { id: "AX-002", name: "李国栋", age: 82, ageText: "82 岁", building: "A1", floor: 22, unit: "1单元", room: "2201", care: "独居 · 慢病随访", contact: "李建（儿子）", phone: "139 **** 3108" },
    { id: "AX-003", name: "陈秀英", age: 85, ageText: "85 岁", building: "B5", floor: 17, unit: "2单元", room: "1702", care: "独居 · 每日关怀", contact: "陈岚（孙女）", phone: "137 **** 9063" },
    { id: "AX-004", name: "王振华", age: 74, ageText: "74 岁", building: "A2", floor: 28, unit: "1单元", room: "2801", care: "夫妻同住 · 常规关注", contact: "王磊（儿子）", phone: "136 **** 4452" },
    { id: "AX-005", name: "赵淑芬", age: 79, ageText: "79 岁", building: "C2", floor: 12, unit: "2单元", room: "1202", care: "独居 · 门磁提醒", contact: "赵宁（女儿）", phone: "135 **** 7780" }
  ];
  var EVENT_TYPES = [
    { key: "gas", name: "燃气浓度异常", level: 3, icon: "◈", tone: "red", device: "燃气传感器 CH₄-{room} · 18% LEL（连续 3 次超阈值）", description: "住户厨房燃气浓度连续 3 次超过预设阈值，请尽快电话核实并安排现场排查。", advice: "优先电话联系住户，确认是否正在用火；无人接听时立即安排上门。" },
    { key: "smoke", name: "烟雾浓度异常", level: 3, icon: "◉", tone: "red", device: "烟雾探测器 SM-{room} · 86 ppm（持续上报）", description: "烟雾探测器持续上报异常浓度，需联系住户确认现场情况并排查火情。", advice: "第一时间电话核实，必要时联动物业与消防，切勿仅凭设备读数判定误报。" },
    { key: "fall", name: "跌倒紧急求助", level: 3, icon: "✚", tone: "red", device: "紧急呼叫按钮 SOS-{room} · 触发 1 次", description: "住户紧急呼叫装置被触发，系统未能确认住户状态，请立即联系并安排上门查看。", advice: "按最高优先级处置，同时联系紧急联系人，必要时拨打 120。" },
    { key: "inactive", name: "独居关怀提醒", level: 2, icon: "◐", tone: "amber", device: "活动感应器 AC-{room} · 12 小时未检测到活动", description: "住户活动信号长时间未更新，建议先电话联系，再视情况上门关怀。", advice: "先电话问候本人，联系不上再联系家属，最后安排上门巡访。" },
    { key: "water", name: "用水异常", level: 2, icon: "≋", tone: "amber", device: "智能水表 WM-{room} · 连续流量异常 6 小时", description: "智能水表出现持续用水记录，建议联系住户确认是否存在漏水或忘关水龙头。", advice: "联系住户核实，必要时协调物业关闭总阀并上门检查。" },
    { key: "firelane", name: "消防通道占用", level: 2, icon: "▤", tone: "amber", device: "楼道摄像头 CV-{room} · 识别到障碍物滞留", description: "楼道公共区域检测到物品长时间堆放，可能影响消防疏散，请核实并协调清理。", advice: "联系住户确认物品归属，张贴告知并安排物业协助清理。" },
    { key: "door", name: "门磁长时开启", level: 1, icon: "▣", tone: "gold", device: "门磁传感器 DC-{room} · 开启 48 分钟", description: "住户入户门保持开启超过设定时长，请联系住户确认安全状态。", advice: "电话确认为主，若联系不上再安排上门查看。" }
  ];
  var RESOLUTIONS = [
    { key: "cleared", label: "已排除风险", tone: "green" },
    { key: "onsite", label: "已现场处置", tone: "green" },
    { key: "handover", label: "转交其他部门", tone: "amber" },
    { key: "false", label: "设备误报", tone: "amber" },
    { key: "followup", label: "需持续跟进", tone: "red" }
  ];

  /* ---------- 工具 ---------- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmt(d) {
    var x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()) +
      " " + pad(x.getHours()) + ":" + pad(x.getMinutes()) + ":" + pad(x.getSeconds());
  }
  function fmtShort(s) { return s ? s.slice(5, 16) : "—"; }
  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36).toUpperCase().slice(-5) +
      Math.random().toString(36).toUpperCase().slice(2, 4);
  }
  function levelName(n) { return LEVEL_NAME[n] || "关注"; }
  function levelClass(n) { return LEVEL_CLASS[n] || "watch"; }

  /* ---------- 服务端快照 ---------- */
  var STATE = {
    user: null, events: [], logs: [], users: [], serverTime: "", loginAt: "",
    stats: { total: 0, pending: 0, active: 0, resolved: 0, urgent: 0, simulatedToday: 0 }
  };
  var listeners = [];
  var ready = false;
  var readyQueue = [];
  var pollTimer = null;
  var busy = false;
  var lastFingerprint = "";

  function notify(change) {
    var payload = change || { type: "update" };
    listeners.forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error("[AX] 订阅回调异常", e); }
    });
  }
  function subscribe(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }
  function fingerprint(data) {
    return JSON.stringify([data.events || [], data.logs || [], data.stats || {}, data.user || null]);
  }
  function applySnapshot(data, type) {
    if (data.user) STATE.user = data.user;
    if (data.events) STATE.events = data.events;
    if (data.logs) STATE.logs = data.logs;
    if (data.stats) STATE.stats = data.stats;
    if (data.users) STATE.users = data.users;
    if (data.serverTime) STATE.serverTime = data.serverTime;
    notify({ type: type || "update" });
  }

  /** 应用启动：拉取 bootstrap；失败时返回 {ok:false,message} 由外壳展示。 */
  async function init() {
    var res = await global.AXAPI.bootstrap();
    if (!res.ok) return res;
    STATE.loginAt = fmt(new Date());
    applySnapshot(res, "bootstrap");
    lastFingerprint = fingerprint(res);
    ready = true;
    readyQueue.splice(0).forEach(function (fn) {
      try { fn(); } catch (e) { console.error("[AX] ready 回调异常", e); }
    });
    return { ok: true, user: STATE.user };
  }
  function onReady(fn) {
    if (ready) { try { fn(); } catch (e) { console.error(e); } }
    else readyQueue.push(fn);
  }
  function isReady() { return ready; }

  /** 写操作成功后重新拉取完整快照，保证 timeline / logs / stats 同步。 */
  async function syncState(type) {
    var res = await global.AXAPI.state();
    if (res.ok) { lastFingerprint = fingerprint(res); applySnapshot(res, type || "update"); }
    return res;
  }
  /** 轮询：仅当服务端数据与本地快照不同才广播，避免无意义重绘。 */
  async function refresh() {
    if (!ready || busy) return { ok: true, skipped: true };
    busy = true;
    try {
      var res = await global.AXAPI.state();
      if (res.ok && fingerprint(res) !== lastFingerprint) {
        lastFingerprint = fingerprint(res);
        applySnapshot(res, "external");
      }
      return res;
    } finally { busy = false; }
  }
  function startPolling(ms) {
    if (pollTimer) global.clearInterval(pollTimer);
    pollTimer = global.setInterval(refresh, ms || 2500);
  }
  function stopPolling() {
    if (pollTimer) global.clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ---------- 同步读接口（供 app.js / console.js 使用） ---------- */
  function session() {
    return STATE.user
      ? { userId: STATE.user.id, user: STATE.user, loginAt: STATE.loginAt }
      : null;
  }
  function events() { return STATE.events; }
  function event(id) { return STATE.events.find(function (e) { return e.id === id; }); }
  function building(id) { return BUILDINGS.find(function (b) { return b.id === id; }); }
  function resident(id) { return RESIDENTS.find(function (r) { return r.id === id; }); }
  function user(id) { return STATE.users.find(function (u) { return u.id === id; }) || null; }
  function users() { return STATE.users; }
  function gridUsers() { return STATE.users.filter(function (u) { return u.role === ROLE.GRID; }); }
  function stats() { return STATE.stats; }
  function logs() { return STATE.logs; }
  function serverTime() { return STATE.serverTime; }
  function locationText(e) {
    var b = building(e.building);
    return (b ? b.name : e.building) + " · " + e.unit + " · " + e.floor + "层 " + e.room + "室";
  }

  /* ---------- 异步写接口（返回 Promise<{ok,message?,event?}>） ---------- */
  async function login(username, password, role) {
    var res = await global.AXAPI.login(username, password, role);
    if (res.ok) {
      STATE.user = res.user;
      STATE.loginAt = fmt(new Date());
      notify({ type: "login" });
    }
    return res;
  }
  async function logout() {
    var res = await global.AXAPI.logout();
    STATE.user = null;
    STATE.events = [];
    STATE.logs = [];
    notify({ type: "logout" });
    return res;
  }
  async function createEvent(input) {
    var res = await global.AXAPI.createEvent(input);
    if (!res.ok) return res;
    await syncState("created");
    return { ok: true, event: event(res.event.id) || res.event };
  }
  async function removeEvent(id) {
    var res = await global.AXAPI.removeEvent(id);
    if (!res.ok) return res;
    await syncState("removed");
    return { ok: true, id: id };
  }
  async function resetDemo() {
    var res = await global.AXAPI.reset();
    if (!res.ok) return res;
    lastFingerprint = fingerprint(res);
    applySnapshot(res, "reset");
    return { ok: true };
  }
  async function act(kind, id, payload) {
    var res = await global.AXAPI[kind](id, payload);
    if (!res.ok) return res;
    await syncState("updated");
    return { ok: true, event: event(id) };
  }
  function claim(id, note) { return act("claim", id, note || ""); }
  function contact(id, payload) { return act("contact", id, payload); }
  function dispatch(id, payload) { return act("dispatch", id, payload); }
  function resolve(id, payload) { return act("resolve", id, payload); }

  global.AX = {
    ROLE: ROLE, STATUS: STATUS, LEVEL_NAME: LEVEL_NAME, LEVEL_CLASS: LEVEL_CLASS,
    BUILDINGS: BUILDINGS, RESIDENTS: RESIDENTS, EVENT_TYPES: EVENT_TYPES, RESOLUTIONS: RESOLUTIONS,
    fmt: fmt, fmtShort: fmtShort, uid: uid, levelName: levelName, levelClass: levelClass,
    session: session, subscribe: subscribe, notify: notify,
    init: init, onReady: onReady, isReady: isReady, refresh: refresh,
    startPolling: startPolling, stopPolling: stopPolling,
    events: events, event: event, building: building, resident: resident,
    user: user, users: users, gridUsers: gridUsers, locationText: locationText,
    stats: stats, logs: logs, serverTime: serverTime,
    login: login, logout: logout, createEvent: createEvent, removeEvent: removeEvent,
    resetDemo: resetDemo, claim: claim, contact: contact, dispatch: dispatch, resolve: resolve,
    publicUser: function (u) { return u; }
  };
})(window);

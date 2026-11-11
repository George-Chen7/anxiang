/* 安响 · 角色工作台
 * ------------------------------------------------------------------
 * 平台管理员：异常事件模拟器（触发 / 指派 / 撤回 / 全局监管）
 * 社区网格员：事件处置台（接收 → 联系住户 → 安排上门 → 记录结果）
 * 两个角色共享同一份本地数据；跨标签页通过 storage 事件实时同步。
 *
 * 视图切换只重建右侧容器，表单输入用事件委托处理，避免数据刷新时丢失草稿。
 */
(function (global) {
  "use strict";

  var me = null;          /* 由 start() 在服务端 bootstrap 完成后填充 */
  var isAdmin = false;
  var root = document.getElementById("consoleView");
  var heading = document.querySelector(".page-heading");
  var workspace = document.getElementById("workspace");
  var view = "overview";
  var ui = {
    simType: null,
    simLevel: null,
    taskTab: "todo",
    selectedTask: null,
    resolveMode: "dispatch",
    selectedRecord: null
  };

  /* ---------- 通用工具 ---------- */
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function toast(message) { if (global.AXToast) global.AXToast(message); }
  function levelChip(level) {
    return '<span class="level ' + AX.levelClass(level) + '">' + AX.levelName(level) + "</span>";
  }
  function statusTone(status) {
    if (status === AX.STATUS.RESOLVED) return "done";
    if (status === AX.STATUS.PENDING) return "pending";
    return "active";
  }
  function statusChip(status) {
    return '<span class="status-chip is-' + statusTone(status) + '">' + esc(status) + "</span>";
  }
  function sourceLabel(e) { return e.source === "simulator" ? "模拟器触发" : "模拟设备上报"; }
  function assigneeLabel(e) {
    var u = e.assignedTo ? AX.user(e.assignedTo) : null;
    return u ? u.name : "公共事件池";
  }
  function residentLabel(e) {
    var r = e.residentId ? AX.resident(e.residentId) : null;
    return r ? r.name + " · " + r.ageText : "临时住户";
  }
  function locShort(e) {
    var b = AX.building(e.building);
    return (b ? b.name : e.building) + " " + e.floor + "层 " + e.room + "室";
  }
  function localDateTime(offsetHours) {
    var d = new Date(Date.now() + (offsetHours || 1) * 3600000);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function prettyTime(value) { return String(value || "").replace("T", " "); }
  function statStrip(items) {
    return '<div class="stat-strip" id="statStrip">' + items.map(function (item) {
      return '<div class="stat-card"><span>' + esc(item.label) + "</span><b class=\"" + (item.tone || "") + '">' +
        esc(item.value) + "</b><small>" + esc(item.note || "") + "</small></div>";
    }).join("") + "</div>";
  }
  function consoleHead(kicker, title, desc, right) {
    return '<section class="console-head"><div><span class="panel-kicker">' + esc(kicker) + "</span><h2>" +
      esc(title) + "</h2><p>" + esc(desc) + "</p></div>" + (right || "") + "</section>";
  }
  function panelHead(title, note) {
    return '<div class="panel-title"><h3>' + esc(title) + "</h3>" +
      (note ? '<span class="panel-note">' + esc(note) + "</span>" : "") + "</div>";
  }
  function emptyState(text, icon) {
    return '<div class="empty-state"><span>' + (icon || "◌") + "</span><p>" + esc(text) + "</p></div>";
  }
  function report(result, okMessage) {
    if (!result.ok) { toast(result.message); return false; }
    if (okMessage) toast(okMessage);
    return true;
  }

  /* ---------- 视图切换 ---------- */
  function setView(next) {
    view = next;
    var isOverview = next === "overview";
    heading.hidden = !isOverview;
    workspace.hidden = !isOverview;
    root.hidden = isOverview;
    if (isOverview) {
      global.dispatchEvent(new Event("resize"));
      return;
    }
    render();
  }
  function render() {
    if (view === "invitations") renderInvitations();
    else if (view === "simulator") renderSimulator();
    else if (view === "tasks") renderTasks();
    else if (view === "records") renderRecords();
  }
  function onDataChange() {
    if (view === "simulator") { refreshSimStats(); refreshFeed(); }
    else if (view === "tasks") { refreshTaskStats(); refreshTaskList(); refreshTaskDetail(); }
    else if (view === "records") { refreshRecordStats(); refreshRecords(); refreshLogs(); }
  }

  /* ================= 管理员：异常事件模拟器 ================= */
  function renderInvitations() {
    root.innerHTML = consoleHead("", "账号授权", "按申请人的职责选择角色，将一次性邀请码交给本人。", "") +
      '<section class="panel sim-form"><form data-form="invite">' +
      '<label class="field">授权角色<select name="role"><option value="grid">社区网格员</option>' +
      '<option value="admin">平台管理员（可继续授权）</option></select></label>' +
      '<button type="submit" class="primary-btn">生成一次性邀请码</button>' +
      '<p id="inviteResult" role="status"></p></form></section>';
  }
  function simulatorStats() {
    var s = AX.stats();
    return [
      { label: "累计事件", value: pad(s.total), note: "含初始演示告警" },
      { label: "待接收", value: pad(s.pending), note: "等待网格员认领", tone: "tone-red" },
      { label: "处置中", value: pad(s.active), note: "已进入处置流程", tone: "tone-amber" },
      { label: "已办结", value: pad(s.resolved), note: "已完成闭环", tone: "tone-green" },
      { label: "今日模拟", value: pad(s.simulatedToday), note: "本日手动触发" }
    ];
  }
  function refreshSimStats() {
    var node = document.getElementById("statStrip");
    if (node) node.outerHTML = statStrip(simulatorStats());
  }
  function renderSimulator() {
    var template = currentTemplate();
    var residents = AX.RESIDENTS.map(function (r) {
      return '<option value="' + esc(r.id) + '">' + esc(r.name + " · " + r.ageText + " · " + r.care) + "</option>";
    }).join("");
    var buildings = AX.BUILDINGS.map(function (b) {
      return '<option value="' + esc(b.id) + '">' + esc(b.name) + "</option>";
    }).join("");
    var grids = AX.gridUsers().map(function (u) {
      return '<option value="' + esc(u.id) + '">' + esc(u.name + " · " + u.team) + "</option>";
    }).join("");
    var types = AX.EVENT_TYPES.map(function (t) {
      return '<button type="button" class="type-card' + (t.key === ui.simType ? " active" : "") +
        '" data-action="pick-type" data-key="' + esc(t.key) + '" data-tone="' + esc(t.tone) + '">' +
        '<span class="type-icon">' + esc(t.icon) + "</span><b>" + esc(t.name) + "</b>" +
        '<small>' + AX.levelName(t.level) + "告警</small></button>";
    }).join("");
    var levels = [3, 2, 1].map(function (n) {
      return '<button type="button" class="seg-btn' + (n === ui.simLevel ? " active" : "") +
        '" data-action="pick-level" data-level="' + n + '">' + AX.levelName(n) + "</button>";
    }).join("");

    root.innerHTML =
      consoleHead("ADMIN CONSOLE / 01 · 平台管理员", "异常事件模拟器",
        "手动构造一条感知告警。触发后事件会立即出现在社区三维模型、告警列表与网格员待办中。",
        '<button type="button" class="ghost-btn" data-action="reset-demo">↺ 重置演示数据</button>') +
      statStrip(simulatorStats()) +
      '<div class="console-grid console-grid--sim">' +
        '<section class="panel sim-form">' +
          panelHead("配置模拟事件", "STEP 1 · 选择场景与位置") +
          '<div class="form-block"><label class="form-label">异常事件类型 <em>' + AX.EVENT_TYPES.length + ' 类场景</em></label>' +
            '<div class="type-grid" id="typeGrid">' + types + "</div></div>" +
          '<div class="form-block"><label class="form-label">发生位置</label>' +
            '<div class="field-row four">' +
              '<label class="field"><span>楼栋</span><select id="simBuilding">' + buildings + "</select></label>" +
              '<label class="field"><span>单元</span><select id="simUnit"><option>1单元</option><option selected>2单元</option></select></label>' +
              '<label class="field"><span>楼层</span><input id="simFloor" type="number" min="1" max="35" value="31"></label>' +
              '<label class="field"><span>房号</span><input id="simRoom" value="3102" readonly title="由楼层与房号后缀自动生成"></label>' +
            "</div>" +
            '<div class="field-row two">' +
              '<label class="field"><span>房号后缀</span><select id="simSuffix"><option value="01">01 室</option><option value="02" selected>02 室</option></select></label>' +
              '<label class="field"><span>关联住户档案</span><select id="simResident"><option value="">不关联（临时住户）</option>' + residents + "</select></label>" +
            "</div>" +
            '<p class="field-hint">选择住户档案会自动回填楼栋与房号，网格员处置时可直接查看简介与联系家属。</p>' +
          "</div>" +
          '<div class="form-block"><label class="form-label">告警等级</label>' +
            '<div class="segmented" id="levelGroup">' + levels + "</div></div>" +
          '<div class="form-block"><label class="form-label">告警内容 <em>可自由编辑</em></label>' +
            '<label class="field"><span>设备读数 / 依据</span><input id="simDevice" value="' + esc(template.device) + '"></label>' +
            '<label class="field"><span>事件描述</span><textarea id="simDescription" rows="3">' + esc(template.description) + "</textarea></label>" +
            '<p class="field-hint" id="simAdvice">处置建议：' + esc(template.advice) + "</p></div>" +
          '<div class="form-block"><label class="form-label">指派网格员</label>' +
            '<label class="field"><span>接收人</span><select id="simAssign"><option value="">不指派 · 进入公共事件池</option>' + grids + "</select></label></div>" +
          '<div class="sim-preview" id="simPreview"></div>' +
          '<div class="form-error" id="simError" role="alert" hidden></div>' +
          '<button type="button" class="primary-btn btn-block" data-action="trigger">◈ 立即触发告警</button>' +
          '<p class="form-hint center">触发动作会写入平台操作日志，并同步到所有已打开的工作台窗口。</p>' +
        "</section>" +
        '<section class="panel sim-feed">' +
          panelHead("已触发事件流", "实时同步") +
          '<div class="feed-list" id="feedList"></div>' +
        "</section>" +
      "</div>";
    refreshPreview();
    refreshFeed();
  }

  function currentTemplate() {
    return AX.EVENT_TYPES.find(function (t) { return t.key === ui.simType; }) || AX.EVENT_TYPES[0];
  }
  function roomValue() {
    var floor = Math.max(1, Math.min(35, Number(document.getElementById("simFloor").value) || 1));
    var suffix = document.getElementById("simSuffix").value;
    return { floor: floor, room: pad(floor) + suffix };
  }
  function refreshPreview() {
    var node = document.getElementById("simPreview");
    if (!node) return;
    var t = currentTemplate();
    var b = AX.BUILDINGS.find(function (x) { return x.id === document.getElementById("simBuilding").value; });
    var pos = roomValue();
    var r = AX.RESIDENTS.find(function (x) { return x.id === document.getElementById("simResident").value; });
    var assign = document.getElementById("simAssign");
    var u = assign.value ? AX.user(assign.value) : null;
    node.innerHTML = '<span class="preview-kicker">告警预览 / PREVIEW</span>' +
      '<div class="preview-main"><b>' + esc(t.name) + "</b>" + levelChip(ui.simLevel) + "</div>" +
      '<div class="preview-lines"><span>位置</span><b>' + esc((b ? b.name : "—") + " · " +
        document.getElementById("simUnit").value + " · " + pos.floor + "层 " + pos.room + "室") + "</b>" +
      "<span>住户</span><b>" + esc(r ? r.name + " · " + r.ageText + " · " + r.care : "临时住户 · 无档案") + "</b>" +
      "<span>接收</span><b>" + esc(u ? u.name : "公共事件池（任一网格员可认领）") + "</b></div>";
  }
  function syncTypeToForm() {
    var t = currentTemplate();
    var device = document.getElementById("simDevice");
    var description = document.getElementById("simDescription");
    if (device) device.value = t.device;
    if (description) description.value = t.description;
    ui.simLevel = t.level;
    document.querySelectorAll("#levelGroup .seg-btn").forEach(function (b) {
      b.classList.toggle("active", Number(b.dataset.level) === t.level);
    });
    document.querySelectorAll("#typeGrid .type-card").forEach(function (b) {
      b.classList.toggle("active", b.dataset.key === t.key);
    });
    var hint = document.getElementById("simAdvice");
    if (hint) hint.textContent = "处置建议：" + t.advice;
    refreshPreview();
  }
  function refreshFeed() {
    var node = document.getElementById("feedList");
    if (!node) return;
    var list = AX.events().slice().sort(function (a, b) { return b.time.localeCompare(a.time) || b.id.localeCompare(a.id); });
    var count = document.querySelector(".sim-feed .panel-note");
    if (count) count.textContent = "共 " + list.length + " 条 · 实时同步";
    if (!list.length) { node.innerHTML = emptyState("还没有事件，试着在左侧触发一条告警", "◈"); return; }
    node.innerHTML = list.map(function (e) {
      var simulated = e.source === "simulator";
      var last = e.timeline.length ? e.timeline[e.timeline.length - 1] : null;
      return '<article class="feed-item' + (e.status === AX.STATUS.RESOLVED ? " is-done" : "") + '">' +
        '<div class="feed-top">' + levelChip(e.level) + "<b>" + esc(e.type) + "</b>" +
          '<span class="feed-id">' + esc(e.id) + "</span></div>" +
        '<div class="feed-loc">' + esc(locShort(e)) + " · " + esc(residentLabel(e)) + "</div>" +
        '<div class="feed-meta"><span>' + esc(AX.fmtShort(e.time)) + "</span><span>" +
          esc(sourceLabel(e)) + "</span><span>接收：" + esc(assigneeLabel(e)) + "</span></div>" +
        '<div class="feed-bottom">' + statusChip(e.status) +
          '<span class="feed-progress">' + esc(last ? last.action + " · " + AX.fmtShort(last.at) : "等待处置") + "</span>" +
          '<span class="feed-actions">' +
            '<button type="button" class="link-btn" data-action="locate" data-id="' + esc(e.id) + '">定位</button>' +
            (simulated ? '<button type="button" class="link-btn danger" data-action="remove-event" data-id="' + esc(e.id) + '">撤回</button>' : "") +
          "</span></div></article>";
    }).join("");
  }
  async function triggerEvent() {
    var t = currentTemplate();
    var pos = roomValue();
    var payload = {
      typeKey: t.key,
      level: ui.simLevel,
      building: document.getElementById("simBuilding").value,
      unit: document.getElementById("simUnit").value,
      floor: pos.floor,
      room: pos.room,
      device: document.getElementById("simDevice").value,
      description: document.getElementById("simDescription").value,
      residentId: document.getElementById("simResident").value || null,
      assignedTo: document.getElementById("simAssign").value || null
    };
    var errorBox = document.getElementById("simError");
    if (!String(payload.description).trim()) {
      errorBox.textContent = "请填写事件描述后再触发";
      errorBox.hidden = false;
      return;
    }
    errorBox.hidden = true;
    var result = await AX.createEvent(payload);
    if (!result.ok) { errorBox.textContent = result.message; errorBox.hidden = false; return; }
    toast("告警已发出：" + result.event.id + " · " + result.event.type + "（" + locShort(result.event) + "）");
  }

  /* ================= 网格员：事件处置台 ================= */
  function myEvents() {
    return AX.events().filter(function (e) {
      return e.assignedTo === me.id || (!e.assignedTo && e.status === AX.STATUS.PENDING);
    });
  }
  function taskBucket() {
    var list = myEvents();
    return {
      todo: list.filter(function (e) { return e.status === AX.STATUS.PENDING; }),
      active: list.filter(function (e) { return e.status !== AX.STATUS.PENDING && e.status !== AX.STATUS.RESOLVED; }),
      done: list.filter(function (e) { return e.status === AX.STATUS.RESOLVED; })
    };
  }
  function taskStats() {
    var b = taskBucket();
    var urgent = AX.events().filter(function (e) { return e.level === 3 && e.status !== AX.STATUS.RESOLVED; }).length;
    return [
      { label: "待接收", value: pad(b.todo.length), note: "含公共事件池", tone: "tone-red" },
      { label: "处理中", value: pad(b.active.length), note: "我正在处置", tone: "tone-amber" },
      { label: "已办结", value: pad(b.done.length), note: "已完成闭环", tone: "tone-green" },
      { label: "紧急未结", value: pad(urgent), note: "全平台紧急事件", tone: "tone-red" }
    ];
  }
  function refreshTaskStats() {
    var node = document.getElementById("statStrip");
    if (node) node.outerHTML = statStrip(taskStats());
  }
  function renderTasks() {
    root.innerHTML =
      consoleHead("GRID WORKSPACE / 02 · 社区网格员", "我的处置工作台",
        "接收告警 → 联系住户 → 安排上门 → 记录处理结果。每一步都会写入处置时间线与平台操作日志。",
        '<div class="who-card"><span class="who-avatar">网</span><span><b>' + esc(me.name) +
          "</b><small>" + esc(me.team) + "</small></span></div>") +
      statStrip(taskStats()) +
      '<div class="console-grid console-grid--tasks">' +
        '<section class="panel task-list-panel">' +
          panelHead("事件队列", "点击卡片查看处置详情") +
          '<div class="tab-bar" id="taskTabs"></div>' +
          '<div class="task-list" id="taskList"></div>' +
        "</section>" +
        '<section class="panel task-detail-panel" id="taskDetail"></section>' +
      "</div>";
    refreshTaskList();
    refreshTaskDetail();
  }
  function refreshTaskList() {
    var tabs = document.getElementById("taskTabs");
    var listNode = document.getElementById("taskList");
    if (!tabs || !listNode) return;
    var b = taskBucket();
    var defs = [
      { key: "todo", label: "待接收", count: b.todo.length },
      { key: "active", label: "处理中", count: b.active.length },
      { key: "done", label: "已办结", count: b.done.length }
    ];
    tabs.innerHTML = defs.map(function (d) {
      return '<button type="button" class="tab-btn' + (ui.taskTab === d.key ? " active" : "") +
        '" data-action="task-tab" data-tab="' + d.key + '">' + d.label +
        "<em>" + d.count + "</em></button>";
    }).join("");
    var list = b[ui.taskTab].slice().sort(function (x, y) {
      return y.level - x.level || y.time.localeCompare(x.time);
    });
    if (!list.length) {
      listNode.innerHTML = emptyState(
        ui.taskTab === "todo" ? "当前没有待接收告警，管理员触发新事件后会实时出现在这里" :
          ui.taskTab === "active" ? "暂无进行中的处置任务" : "还没有已办结的事件", "☑");
      return;
    }
    listNode.innerHTML = list.map(function (e) {
      var last = e.timeline.length ? e.timeline[e.timeline.length - 1] : null;
      return '<button type="button" class="task-card' + (ui.selectedTask === e.id ? " active" : "") +
        (e.level === 3 ? " is-urgent" : "") + '" data-action="pick-task" data-id="' + esc(e.id) + '">' +
        '<span class="task-card-top">' + levelChip(e.level) + "<b>" + esc(e.type) + "</b>" +
          (e.source === "simulator" ? '<i class="source-tag">模拟</i>' : "") + "</span>" +
        '<span class="task-card-loc">' + esc(locShort(e)) + " · " + esc(residentLabel(e)) + "</span>" +
        '<span class="task-card-bottom"><span>' + esc(AX.fmtShort(e.time)) + "</span>" +
          statusChip(e.status) + "</span>" +
        (followupDue(e) ? '<span class="task-card-step">下次跟进：' + esc(followupDue(e)) + "</span>" : "") +
        '<span class="task-card-step">最新：' + esc(last ? last.action : "告警产生") + "</span></button>";
    }).join("");
  }
  function stepTrack(status, skipped) {
    var steps = ["接收事件", "联系住户", "安排上门", "记录结果"];
    var index = status === AX.STATUS.PENDING ? 0 :
      status === AX.STATUS.CLAIMED ? 1 :
      status === AX.STATUS.CONTACTED ? 2 :
      status === AX.STATUS.DISPATCHED || status === AX.STATUS.FOLLOWUP ? 3 : 4;
    return '<div class="step-track">' + steps.map(function (label, i) {
      var cls = i < index ? "done" : i === index ? "current" : "";
      if (i === 2 && skipped && i < index) cls = "skipped";
      return '<div class="step ' + cls + '"><i>' + (cls === "done" ? "✓" : i + 1) + "</i><span>" + label + "</span></div>";
    }).join("") + "</div>";
  }
  function timelineHtml(e) {
    return '<div class="timeline">' + e.timeline.map(function (s) {
      return '<div class="timeline-item is-' + esc(s.kind || "action") + '"><i></i><div>' +
        '<div class="timeline-top"><b>' + esc(s.action) + "</b><span>" + esc(AX.fmtShort(s.at)) + "</span></div>" +
        '<small>' + esc(s.actorName) + (s.note ? " · " + esc(s.note) : "") + "</small></div></div>";
    }).join("") + "</div>";
  }
  function followupDue(e) {
    return e.status === AX.STATUS.FOLLOWUP ? (e.result.nextFollowupAt || "待补登记") : "";
  }
  function taskFormHtml(e) {
    var S = AX.STATUS;
    var owner = e.assignedTo ? AX.user(e.assignedTo) : null;
    if (e.assignedTo && e.assignedTo !== me.id) {
      return '<div class="action-box"><h4>当前不可处置</h4><p class="action-tip">该事件已由 ' +
        esc(owner ? owner.name : "其他网格员") + " 接收，请联系对方或等待转派。</p></div>";
    }
    if (e.status === S.PENDING) {
      return '<div class="action-box"><h4>下一步 · 接收事件</h4>' +
        '<p class="action-tip">接收后事件将指派给你，并进入「联系住户 → 安排上门 → 记录结果」流程。</p>' +
        stepTrack(e.status) +
        '<form data-form="claim" data-id="' + esc(e.id) + '">' +
          '<label class="field"><span>接单备注（选填）</span><input name="note" placeholder="例如：已看到告警，马上联系住户"></label>' +
          '<button type="submit" class="primary-btn">接收事件 <span aria-hidden="true">→</span></button>' +
        "</form></div>";
    }
    if (e.status === S.CLAIMED) {
      return '<div class="action-box"><h4>下一步 · 联系住户</h4>' +
        '<p class="action-tip">先通过电话或家属确认现场情况，再决定是否安排上门。</p>' +
        stepTrack(e.status) +
        '<form data-form="contact" data-id="' + esc(e.id) + '">' +
          '<div class="field-row two">' +
            '<label class="field"><span>联系方式</span><select name="channel"><option>电话</option><option>微信</option><option>家属电话</option><option>现场喊话</option><option>物业转达</option></select></label>' +
            '<label class="field"><span>联系结果</span><select name="outcome"><option>已接通</option><option>无人接听</option><option>已联系家属</option><option>号码异常</option></select></label>' +
          "</div>" +
          '<label class="field"><span>联系情况说明 <em class="req">必填</em></span><textarea name="note" rows="3" placeholder="例如：两次电话均无人接听，已联系家属核实去向"></textarea></label>' +
          '<button type="submit" class="primary-btn">记录联系住户 <span aria-hidden="true">→</span></button>' +
        "</form></div>";
    }
    if (e.status === S.CONTACTED || e.status === S.FOLLOWUP) {
      var dispatchForm =
        '<form data-form="dispatch" data-id="' + esc(e.id) + '">' +
          '<div class="field-row two">' +
            '<label class="field"><span>上门时间 <em class="req">必填</em></span><input name="time" type="datetime-local" value="' + esc(localDateTime(1)) + '"></label>' +
            '<label class="field"><span>随行人员</span><input name="staff" value="' + esc(me.name) + '"></label>' +
          "</div>" +
          '<label class="field"><span>上门备注（选填）</span><input name="note" placeholder="例如：与社区同事一同前往核实"></label>' +
          '<button type="submit" class="primary-btn">安排上门处置 <span aria-hidden="true">→</span></button>' +
        "</form>";
      var resolveForm = '<form data-form="resolve" data-id="' + esc(e.id) + '">' + resolutionFields() +
        '<button type="submit" class="primary-btn">保存处理记录</button></form>';
      return '<div class="action-box"><h4>安排上门或记录核实结果</h4>' +
        '<p class="action-tip">尚需核实时，选择「记录结果 / 跟进」并登记下次跟进时间。</p>' +
        stepTrack(e.status) +
        '<div class="mini-tabs">' +
          '<button type="button" class="mini-tab' + (ui.resolveMode === "dispatch" ? " active" : "") +
            '" data-action="resolve-mode" data-mode="dispatch">安排上门</button>' +
          '<button type="button" class="mini-tab' + (ui.resolveMode === "direct" ? " active" : "") +
            '" data-action="resolve-mode" data-mode="direct">记录结果 / 跟进</button>' +
        "</div>" + (ui.resolveMode === "direct" ? resolveForm : dispatchForm) + "</div>";
    }
    if (e.status === S.DISPATCHED) {
      return '<div class="action-box"><h4>最后一步 · 记录处理结果</h4>' +
        '<p class="action-tip">填写现场核实情况。如仍需跟进，请登记下一次核实时间。</p>' +
        stepTrack(e.status) +
        '<form data-form="resolve" data-id="' + esc(e.id) + '">' + resolutionFields() +
          '<button type="submit" class="primary-btn">保存处理记录</button></form></div>';
    }
    return '<div class="action-box is-complete"><h4>✓ 事件已办结</h4>' +
      '<div class="result-summary"><div><span>处理结论</span><b>' + esc(e.result ? e.result.resolution : "—") + "</b></div>" +
      '<div><span>办结人 / 时间</span><b>' + esc((e.result ? e.result.by : "—") + " · " + AX.fmtShort(e.resolvedAt || e.time)) + "</b></div>" +
      '<div class="full"><span>处理结果说明</span><p>' + esc(e.result ? e.result.note : "—") + "</p></div></div>" +
      stepTrack(e.status, !e.dispatch) + "</div>";
  }
  function resolutionFields() {
    var options = AX.RESOLUTIONS.map(function (r) {
      return '<option value="' + esc(r.key) + '">' + esc(r.label) + "</option>";
    }).join("");
    return '<div class="field-row two">' +
      '<label class="field"><span>处理结论 <em class="req">必填</em></span><select name="resolution">' + options + "</select></label>" +
      '<label class="field" hidden><span>下次跟进时间</span><input type="datetime-local" name="nextFollowupAt" disabled></label>' +
      '<div class="resolution-legend"><span>结论口径</span><small>已排除风险 / 已现场处置 / 转交其他部门 / 设备误报 / 需持续跟进</small></div>' +
      "</div>" +
      '<label class="field"><span>处理结果说明 <em class="req">必填</em></span><textarea name="note" rows="3" placeholder="例如：家属已到场，确认住户安全并记录现场情况"></textarea></label>';
  }
  function refreshTaskDetail() {
    var node = document.getElementById("taskDetail");
    if (!node) return;
    var e = ui.selectedTask ? AX.event(ui.selectedTask) : null;
    var bucket = taskBucket()[ui.taskTab];
    if (!e || !bucket.some(function (x) { return x.id === e.id; })) {
      var fallback = bucket[0];
      e = fallback || null;
      ui.selectedTask = e ? e.id : null;
      refreshTaskList();
    }
    if (!e) { node.innerHTML = emptyState("暂无可处置的事件", "☑"); return; }
    var r = e.residentId ? AX.resident(e.residentId) : null;
    node.innerHTML =
      '<div class="td-head"><span class="panel-kicker">TASK DETAIL / ' + esc(e.id) + "</span>" +
        '<div class="td-title"><h3>' + esc(e.type) + "</h3>" + levelChip(e.level) + statusChip(e.status) + "</div>" +
        '<p>' + esc(e.description) + "</p></div>" +
      '<div class="td-grid">' +
        '<div><span>发生位置</span><b>' + esc(locShort(e)) + "</b></div>" +
        '<div><span>发生时间</span><b>' + esc(e.time) + "</b></div>" +
        '<div><span>触发来源</span><b>' + esc(sourceLabel(e)) + "</b></div>" +
        '<div><span>处置网格员</span><b>' + esc(assigneeLabel(e)) + "</b></div>" +
        (followupDue(e) ? "<div><span>下次跟进</span><b>" + esc(followupDue(e)) + "</b></div>" : "") +
        '<div class="full"><span>设备依据</span><b>' + esc(e.device) + "</b></div>" +
      "</div>" +
      (r ? '<div class="td-resident"><span class="resident-avatar">' + esc(r.name.charAt(0)) + "</span>" +
        '<div><b>' + esc(r.name + " · " + r.ageText) + "</b><small>" + esc(r.care) +
          " · 紧急联系人 " + esc(r.contact + " " + r.phone) + "</small></div>" +
        '<button type="button" class="ghost-btn" data-action="open-resident" data-id="' + esc(r.id) + '">查看住户简介</button></div>'
        : '<div class="td-no-resident">该事件未关联住户关怀档案，请通过电话或物业核实住户信息。</div>') +
      taskFormHtml(e) +
      '<div class="td-timeline"><div class="panel-title"><h3>处置时间线</h3><span class="panel-note">' +
        e.timeline.length + " 条记录</span></div>" + timelineHtml(e) + "</div>" +
      '<div class="td-foot"><button type="button" class="link-btn" data-action="locate" data-id="' +
        esc(e.id) + '">在总览模型中定位 →</button></div>';
  }

  /* ================= 处置记录（双角色可见） ================= */
  function recordStats() {
    var s = AX.stats();
    return [
      { label: "全部事件", value: pad(s.total), note: "含模拟触发" },
      { label: "待接收", value: pad(s.pending), note: "尚未认领", tone: "tone-red" },
      { label: "处置中", value: pad(s.active), note: "流程进行中", tone: "tone-amber" },
      { label: "已办结", value: pad(s.resolved), note: "完成闭环", tone: "tone-green" }
    ];
  }
  function refreshRecordStats() {
    var node = document.getElementById("statStrip");
    if (node) node.outerHTML = statStrip(recordStats());
  }
  function renderRecords() {
    root.innerHTML =
      consoleHead("AUDIT TRAIL / 03 · 处置留痕", "处置记录与平台日志",
        isAdmin ? "查看全量事件的处置链路、结论与平台操作日志。" : "查看全量事件的处置链路与平台操作日志（只读）。") +
      statStrip(recordStats()) +
      '<section class="panel records-panel">' +
        panelHead("全量事件", "点击行查看完整处置时间线") +
        '<div class="filter-bar">' +
          '<label class="field"><span>状态</span><select id="filterStatus"><option value="all">全部状态</option>' +
            Object.keys(AX.STATUS).map(function (k) { return '<option value="' + esc(AX.STATUS[k]) + '">' + esc(AX.STATUS[k]) + "</option>"; }).join("") +
          "</select></label>" +
          '<label class="field"><span>等级</span><select id="filterLevel"><option value="all">全部等级</option><option value="3">紧急</option><option value="2">较高</option><option value="1">关注</option></select></label>' +
          '<label class="field"><span>来源</span><select id="filterSource"><option value="all">全部来源</option><option value="simulator">模拟器触发</option><option value="seed">模拟设备上报</option></select></label>' +
          '<label class="field grow"><span>搜索</span><input id="filterKeyword" placeholder="事件编号 / 类型 / 位置 / 住户"></label>' +
        "</div>" +
        '<div class="table-wrap" id="recordTable"></div>' +
        '<div id="recordDetail"></div>' +
      "</section>" +
      '<section class="panel log-panel">' + panelHead("平台操作日志", "最近 10 条") +
        '<div class="log-list" id="logList"></div></section>';
    refreshRecords();
    refreshLogs();
  }
  function filteredRecords() {
    var status = (document.getElementById("filterStatus") || {}).value || "all";
    var level = (document.getElementById("filterLevel") || {}).value || "all";
    var source = (document.getElementById("filterSource") || {}).value || "all";
    var keyword = ((document.getElementById("filterKeyword") || {}).value || "").trim().toLowerCase();
    return AX.events().filter(function (e) {
      if (status !== "all" && e.status !== status) return false;
      if (level !== "all" && String(e.level) !== level) return false;
      if (source !== "all" && e.source !== source) return false;
      if (keyword) {
        var haystack = [e.id, e.type, locShort(e), residentLabel(e), assigneeLabel(e), e.device].join(" ").toLowerCase();
        if (haystack.indexOf(keyword) < 0) return false;
      }
      return true;
    }).sort(function (a, b) { return b.time.localeCompare(a.time); });
  }
  function refreshRecords() {
    var node = document.getElementById("recordTable");
    if (!node) return;
    var list = filteredRecords();
    var note = document.querySelector(".records-panel .panel-note");
    if (note) note.textContent = "共 " + list.length + " 条 · 点击行展开";
    if (!list.length) { node.innerHTML = emptyState("没有符合筛选条件的事件", "▤"); }
    else {
      node.innerHTML = '<table class="records-table"><thead><tr>' +
        "<th>编号</th><th>事件类型</th><th>等级</th><th>位置 / 住户</th><th>来源</th><th>处置人</th><th>状态</th><th>处理结论</th><th>发生时间</th>" +
        "</tr></thead><tbody>" + list.map(function (e) {
          return '<tr data-action="pick-record" data-id="' + esc(e.id) + '" class="' +
            (ui.selectedRecord === e.id ? "active" : "") + '">' +
            '<td class="mono">' + esc(e.id) + "</td><td><b>" + esc(e.type) + "</b></td><td>" + levelChip(e.level) + "</td>" +
            "<td>" + esc(locShort(e)) + "<small>" + esc(residentLabel(e)) + "</small></td>" +
            "<td>" + esc(sourceLabel(e)) + "</td><td>" + esc(assigneeLabel(e)) + "</td><td>" + statusChip(e.status) + "</td>" +
            "<td>" + esc(e.result ? e.result.resolution : "—") + "</td><td class=\"mono\">" + esc(AX.fmtShort(e.time)) + "</td></tr>";
        }).join("") + "</tbody></table>";
    }
    refreshRecordDetail();
  }
  function refreshRecordDetail() {
    var node = document.getElementById("recordDetail");
    if (!node) return;
    var e = ui.selectedRecord ? AX.event(ui.selectedRecord) : null;
    if (!e) { node.innerHTML = ""; return; }
    node.innerHTML = '<div class="record-detail"><div class="rd-head"><div>' +
      '<span class="panel-kicker">EVENT TRACE / ' + esc(e.id) + "</span><h4>" + esc(e.type) + " · " + esc(locShort(e)) + "</h4></div>" +
      '<button type="button" class="link-btn" data-action="close-record">收起 ×</button></div>' +
      '<div class="rd-body"><div><h5>处置摘要</h5><div class="rd-facts">' +
        "<div><span>关联住户</span><b>" + esc(residentLabel(e)) + "</b></div>" +
        "<div><span>处置网格员</span><b>" + esc(assigneeLabel(e)) + "</b></div>" +
        "<div><span>当前状态</span><b>" + esc(e.status) + "</b></div>" +
        "<div><span>处理结论</span><b>" + esc(e.result ? e.result.resolution : "未办结") + "</b></div>" +
        (followupDue(e) ? "<div><span>下次跟进</span><b>" + esc(followupDue(e)) + "</b></div>" : "") +
        (e.contact ? '<div><span>联系记录</span><b>' + esc(e.contact.channel + " / " + e.contact.outcome) + "</b></div>" : "") +
        (e.dispatch ? '<div><span>上门安排</span><b>' + esc(prettyTime(e.dispatch.time) + " · " + e.dispatch.staff) + "</b></div>" : "") +
      "</div>" + (e.result ? '<div class="rd-note"><span>处理结果说明</span><p>' + esc(e.result.note) + "</p></div>" : "") +
      "</div><div><h5>处置时间线</h5>" + timelineHtml(e) + "</div></div></div>";
  }
  function refreshLogs() {
    var node = document.getElementById("logList");
    if (!node) return;
    var logs = AX.logs().slice(0, 10);
    if (!logs.length) { node.innerHTML = emptyState("暂无操作日志", "▤"); return; }
    node.innerHTML = logs.map(function (l) {
      var roleClass = l.role === AX.ROLE.ADMIN ? "is-admin" : l.role === AX.ROLE.GRID ? "is-grid" : "is-system";
      return '<div class="log-item"><span class="log-dot ' + roleClass + '"></span>' +
        '<div class="log-main"><b>' + esc(l.action) + "</b><span>" + esc(l.detail) + "</span></div>" +
        '<div class="log-meta"><span>' + esc(l.actorName) + "</span><small>" + esc(AX.fmtShort(l.at)) +
          " · " + esc(l.eventId) + "</small></div></div>";
    }).join("");
  }

  /* ---------- 住户简介浮层（复用 app.js 创建的模态容器） ---------- */
  function openResidentFrame(residentId) {
    if (typeof global.elderPanel !== "function") { toast("住户简介组件尚未就绪"); return; }
    var panel = global.elderPanel();
    var overlay = document.getElementById("elderOverlay");
    var frame = panel.querySelector(".elder-card-frame");
    if (frame.dataset.residentId !== residentId) {
      frame.src = "profile-card/dist/index.html?id=" + encodeURIComponent(residentId);
      frame.dataset.residentId = residentId;
    }
    overlay.hidden = false;
    panel.hidden = false;
  }

  /* ---------- 事件委托 ---------- */
  function onClick(event) {
    var target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (!target || !root.contains(target)) return;
    var action = target.dataset.action;
    var id = target.dataset.id;
    if (action === "pick-type") { ui.simType = target.dataset.key; syncTypeToForm(); return; }
    if (action === "pick-level") {
      ui.simLevel = Number(target.dataset.level);
      document.querySelectorAll("#levelGroup .seg-btn").forEach(function (b) {
        b.classList.toggle("active", b === target);
      });
      refreshPreview(); return;
    }
    if (action === "trigger") { triggerEvent(); return; }
    if (action === "remove-event") {
      if (!global.confirm("确定撤回事件 " + id + " 吗？该事件及其处置记录会一并删除。")) return;
      AX.removeEvent(id).then(function (r) { report(r, "已撤回事件 " + id); });
      return;
    }
    if (action === "reset-demo") {
      if (!global.confirm("重置后将清空所有模拟事件与处置记录，恢复为 5 条初始告警。确定继续？")) return;
      ui.selectedTask = null; ui.selectedRecord = null;
      AX.resetDemo().then(function (r) { report(r, "演示数据已重置"); });
      return;
    }
    if (action === "task-tab") { ui.taskTab = target.dataset.tab; ui.selectedTask = null; refreshTaskList(); refreshTaskDetail(); return; }
    if (action === "pick-task") { ui.selectedTask = id; ui.resolveMode = "dispatch"; refreshTaskList(); refreshTaskDetail(); return; }
    if (action === "resolve-mode") { ui.resolveMode = target.dataset.mode; refreshTaskDetail(); return; }
    if (action === "pick-record") { ui.selectedRecord = id; refreshRecords(); return; }
    if (action === "close-record") { ui.selectedRecord = null; refreshRecords(); return; }
    if (action === "open-resident") { openResidentFrame(id); return; }
    if (action === "locate") {
      AXAuth.go("overview");
      if (typeof global.openAlert === "function") global.openAlert(id);
      return;
    }
  }
  function onChange(event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    var id = target.id;
    if (target.name === "resolution") {
      var due = target.form.elements.nextFollowupAt;
      var followup = target.value === "followup";
      due.closest("label").hidden = !followup;
      due.disabled = !followup;
      due.required = followup;
      if (followup && !due.value) due.value = localDateTime(1);
    }
    if (id === "simResident") {
      var r = AX.RESIDENTS.find(function (x) { return x.id === target.value; });
      if (r) {
        document.getElementById("simBuilding").value = r.building;
        document.getElementById("simUnit").value = r.unit;
        document.getElementById("simFloor").value = r.floor;
        document.getElementById("simSuffix").value = r.room.slice(-2);
        document.getElementById("simRoom").value = r.room;
      }
    }
    if (id === "simFloor" || id === "simSuffix") {
      document.getElementById("simRoom").value = roomValue().room;
    }
    if (id === "simBuilding" || id === "simUnit" || id === "simResident" || id === "simAssign" ||
        id === "simFloor" || id === "simSuffix") refreshPreview();
    if (id === "filterStatus" || id === "filterLevel" || id === "filterSource") refreshRecords();
  }
  function onInput(event) {
    if (event.target && event.target.id === "filterKeyword") refreshRecords();
  }
  async function onSubmit(event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
    event.preventDefault();
    var kind = form.dataset.form;
    var id = form.dataset.id;
    var data = new FormData(form);
    var value = function (key) { return String(data.get(key) || "").trim(); };
    var result;
    if (kind === "invite") {
      var button = form.querySelector("button");
      if (button.disabled) return;
      button.disabled = true;
      result = await AXAPI.request("POST", "/api/invitations", {role: value("role")});
      button.disabled = false;
      form.querySelector("#inviteResult").textContent = result.ok
        ? (result.role === "admin" ? "管理员" : "网格员") + "邀请码：" + result.code + "（有效期至 " + result.expiresAt + "）"
        : result.message;
      return;
    }
    var save = form.querySelector('button[type="submit"]');
    if (save.disabled) return;
    save.disabled = true;
    if (kind === "claim") result = await AX.claim(id, value("note"));
    else if (kind === "contact") result = await AX.contact(id, { channel: value("channel"), outcome: value("outcome"), note: value("note") });
    else if (kind === "dispatch") result = await AX.dispatch(id, { time: prettyTime(value("time")), staff: value("staff"), note: value("note") });
    else if (kind === "resolve") result = await AX.resolve(id, { resolution: value("resolution"), note: value("note"), nextFollowupAt: value("nextFollowupAt") });
    else return;
    save.disabled = false;
    if (!result.ok) { toast(result.message); return; }
    var messages = {
      claim: "已接收事件 " + id + "，请尽快联系住户",
      contact: "联系记录已保存，可安排上门或直接办结",
      dispatch: "上门安排已记录，待现场处置后填写结果",
      resolve: "事件 " + id + " 已办结，处置结果已归档"
    };
    var following = kind === "resolve" && result.event.status === AX.STATUS.FOLLOWUP;
    toast(following ? "跟进计划已保存，事件保留在处理中" : messages[kind]);
    ui.selectedTask = id;
    ui.resolveMode = "dispatch";
    if (kind === "resolve") ui.taskTab = following ? "active" : "done";
    else if (kind === "claim" || kind === "contact" || kind === "dispatch") ui.taskTab = "active";
    refreshTaskStats(); refreshTaskList(); refreshTaskDetail();
  }

  /* 由 index.html 启动器在 AX.init() 成功后调用：此时服务端会话与数据都已就绪。 */
  function start() {
    var s = AX.session();
    if (!s) return;
    me = s.user;
    ui.simType = AX.EVENT_TYPES[0].key;
    ui.simLevel = AX.EVENT_TYPES[0].level;
    isAdmin = me.role === AX.ROLE.ADMIN;
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.addEventListener("input", onInput);
    root.addEventListener("submit", onSubmit);
    global.addEventListener("ax:navigate", function (event) { setView(event.detail.view); });
    AX.subscribe(onDataChange);
    setView(AXAuth.currentView());
  }

  global.AXConsole = {
    start: start,
    openTask: function (id) {
      var e = AX.event(id);
      if (e) {
        ui.selectedTask = id;
        ui.taskTab = e.status === AX.STATUS.PENDING ? "todo" :
          e.status === AX.STATUS.RESOLVED ? "done" : "active";
      }
      AXAuth.go("tasks");
    },
    openRecord: function (id) { ui.selectedRecord = id; AXAuth.go("records"); }
  };
})(window);

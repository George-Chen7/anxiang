/* 安响 · 应用外壳：登录守卫、顶部导航、角色徽章、待办角标
 * 会话由服务端 HttpOnly Cookie 维护；本文件在 AX.init() 完成后由启动器调用 start()。
 */
(function (global) {
  "use strict";

  var NAV = [
    { key: "overview", label: "总览看板", icon: "▦", roles: null },
    { key: "simulator", label: "事件模拟器", icon: "◈", roles: ["admin"] },
    { key: "tasks", label: "我的处置", icon: "☑", roles: ["grid"] },
    { key: "records", label: "处置记录", icon: "▤", roles: null }
  ];

  var currentView = "overview";
  function currentSession() { return AX.session(); }

  function visibleNav() {
    var s = currentSession();
    return NAV.filter(function (item) {
      return !item.roles || (s && item.roles.indexOf(s.user.role) >= 0);
    });
  }

  function todoCount() {
    var s = currentSession();
    if (!s || s.user.role !== AX.ROLE.GRID) return 0;
    return AX.events().filter(function (e) {
      var mine = e.assignedTo === s.user.id;
      var openPool = !e.assignedTo && e.status === AX.STATUS.PENDING;
      return (mine || openPool) && e.status !== AX.STATUS.RESOLVED;
    }).length;
  }

  function render() {
    var bar = document.getElementById("topbar");
    var s = currentSession();
    if (!bar || !s) return;
    var user = s.user;
    var roleClass = user.role === AX.ROLE.ADMIN ? "is-admin" : "is-grid";
    var roleLabel = user.role === AX.ROLE.ADMIN ? "平台管理员" : "社区网格员";
    bar.className = "topbar " + roleClass;
    bar.innerHTML =
      '<div class="topbar-inner">' +
        '<div class="brand"><span class="brand-mark" aria-hidden="true">安</span>' +
          '<span class="brand-text"><b>安响</b><small>社区告警与处置</small></span></div>' +
        '<nav class="topnav" aria-label="主导航">' +
          visibleNav().map(function (item) {
            var badge = item.key === "tasks" && todoCount() > 0
              ? '<em class="nav-badge">' + todoCount() + "</em>" : "";
            return '<button type="button" class="nav-btn' + (item.key === currentView ? " active" : "") +
              '" data-view="' + item.key + '"><span class="nav-icon" aria-hidden="true">' + item.icon +
              "</span>" + item.label + badge + "</button>";
          }).join("") +
        "</nav>" +
        '<div class="topbar-user">' +
          '<span class="role-chip ' + roleClass + '">' + roleLabel + "</span>" +
          '<span class="user-meta"><b>' + user.name + "</b><small>" + user.team + "</small></span>" +
          '<button type="button" class="logout-btn" id="logoutButton" title="退出登录">退出</button>' +
        "</div>" +
      "</div>";
    bar.querySelectorAll(".nav-btn").forEach(function (button) {
      button.addEventListener("click", function () { go(button.dataset.view); });
    });
    document.getElementById("logoutButton").addEventListener("click", async function () {
      await AX.logout();
      global.location.replace("login.html");
    });
  }

  function go(view) {
    var item = visibleNav().find(function (n) { return n.key === view; });
    if (!item) return;
    currentView = view;
    render();
    global.dispatchEvent(new CustomEvent("ax:navigate", { detail: { view: view } }));
  }

  function refreshBadge() {
    var button = document.querySelector('.nav-btn[data-view="tasks"]');
    if (!button) return;
    var badge = button.querySelector(".nav-badge");
    var count = todoCount();
    if (count > 0) {
      if (badge) badge.textContent = String(count);
      else {
        badge = document.createElement("em");
        badge.className = "nav-badge";
        badge.textContent = String(count);
        button.appendChild(badge);
      }
    } else if (badge) badge.remove();
  }

  /* 数据变化时刷新待办角标；轮询发现新告警时提示网格员。 */
  var lastEventCount = null;
  AX.subscribe(function () {
    refreshBadge();
    var countNow = AX.events().length;
    var s = currentSession();
    if (lastEventCount !== null && countNow > lastEventCount &&
        s && s.user.role === AX.ROLE.GRID && currentView !== "tasks") {
      global.AXToast && global.AXToast("收到新告警：有新的异常事件进入待办，请前往「我的处置」查看");
    }
    lastEventCount = countNow;
  });

  /* 服务端会话失效 / 被登出时统一回到登录页 */
  global.addEventListener("ax:unauthorized", function () {
    global.location.replace("login.html");
  });

  function start() {
    if (!currentSession()) { global.location.replace("login.html"); return; }
    render();
    global.dispatchEvent(new CustomEvent("ax:navigate", { detail: { view: currentView } }));
  }

  global.AXAuth = {
    start: start,
    session: currentSession,
    render: render,
    go: go,
    currentView: function () { return currentView; },
    nav: visibleNav
  };
})(window);

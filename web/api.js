/* 安响 · HTTP API 客户端
 * ------------------------------------------------------------------
 * 统一封装 fetch：同源携带 HttpOnly Cookie、统一错误结构、401 广播。
 * 后端为 server.py（Python 标准库 + SQLite），所有业务数据以服务端为准。
 */
(function (global) {
  "use strict";

  async function request(method, url, body) {
    var options = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    var response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      return { ok: false, offline: true, message: "无法连接本地服务，请用「start.bat」启动 server.py" };
    }
    var data;
    try {
      data = await response.json();
    } catch (error) {
      return { ok: false, offline: true, message: "后端未返回 JSON，请确认运行的是 server.py 而不是纯静态服务" };
    }
    if (response.status === 401 && url !== "/api/login") {
      global.dispatchEvent(new CustomEvent("ax:unauthorized", { detail: { message: data.message } }));
    }
    if (!response.ok || data.ok === false) {
      return {
        ok: false,
        status: response.status,
        message: data.message || ("请求失败（HTTP " + response.status + "）")
      };
    }
    return Object.assign({ ok: true }, data);
  }

  function eventPath(id, action) {
    return "/api/events/" + encodeURIComponent(id) + (action ? "/" + action : "");
  }

  global.AXAPI = {
    request: request,
    health: function () { return request("GET", "/api/health"); },
    me: function () { return request("GET", "/api/me"); },
    login: function (username, password, role) {
      return request("POST", "/api/login", { username: username, password: password, role: role });
    },
    logout: function () { return request("POST", "/api/logout", {}); },
    bootstrap: function () { return request("GET", "/api/bootstrap"); },
    state: function () { return request("GET", "/api/state"); },
    createEvent: function (payload) { return request("POST", "/api/events", payload); },
    removeEvent: function (id) { return request("DELETE", eventPath(id)); },
    reset: function () { return request("POST", "/api/reset", {}); },
    claim: function (id, note) { return request("POST", eventPath(id, "claim"), { note: note || "" }); },
    contact: function (id, payload) { return request("POST", eventPath(id, "contact"), payload); },
    dispatch: function (id, payload) { return request("POST", eventPath(id, "dispatch"), payload); },
    resolve: function (id, payload) { return request("POST", eventPath(id, "resolve"), payload); }
  };
})(window);

// @ts-check
"use strict";

/* 演示登录：只用于展示“社区网格员 / 平台管理员”的角色差异，
   不是真实身份验证。正式部署应改用 WorkBuddy Auth，并在数据库侧配置 RLS。 */
(function () {
  const SESSION_KEY = "anxiang-demo-session";

  /** @typedef {{username:string,password:string,role:"grid"|"admin",displayName:string}} DemoAccount */
  /** @typedef {{username:string,role:"grid"|"admin",displayName:string}} DemoSession */

  /** @type {Record<string, DemoAccount>} */
  const ACCOUNTS = {
    grid: { username: "grid", password: "grid123", role: "grid", displayName: "值班网格员" },
    admin: { username: "admin", password: "admin123", role: "admin", displayName: "应用管理员" }
  };

  /** @type {((session:DemoSession)=>void)|null} */
  let onAuthenticated = null;

  /** @returns {DemoSession|null} */
  function readSession() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data.username !== "string" || typeof data.displayName !== "string") return null;
      if (data.role !== "grid" && data.role !== "admin") return null;
      return { username: data.username, role: data.role, displayName: data.displayName };
    } catch (error) {
      return null;
    }
  }

  /** @param {DemoSession} session @returns {void} */
  function writeSession(session) {
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      /* 隐私模式等场景下无法持久化，当前标签页内仍可继续使用 */
    }
  }

  /** @returns {void} */
  function clearSession() {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch (error) {
      /* 忽略清理失败 */
    }
  }

  /** @param {string} username @param {string} password @returns {{ok:boolean,session?:DemoSession,error?:string}} */
  function login(username, password) {
    const account = ACCOUNTS[username.trim()];
    if (!account || account.password !== password) {
      return { ok: false, error: "账号或密码不正确" };
    }
    const session = { username: account.username, role: account.role, displayName: account.displayName };
    writeSession(session);
    return { ok: true, session };
  }

  /** @returns {HTMLElement} */
  function buildLoginGate() {
    const gate = document.createElement("div");
    gate.className = "auth-gate";
    gate.innerHTML = `
      <form class="auth-card" id="authForm" autocomplete="on">
        <span class="auth-card__eyebrow">ANXIANG · DEMO ACCESS</span>
        <h1>登录安响</h1>
        <p class="auth-card__intro">使用演示账号进入社区告警处置页面。</p>
        <label class="auth-field" for="authUsername">账号<input id="authUsername" name="username" type="text" autocomplete="username" required></label>
        <label class="auth-field" for="authPassword">密码<input id="authPassword" name="password" type="password" autocomplete="current-password" required></label>
        <p class="auth-error" id="authError" hidden></p>
        <button class="auth-submit" type="submit">进入系统</button>
        <div class="auth-demo">
          <b>演示账号</b>
          <span>社区网格员：grid / grid123</span>
          <span>平台管理员：admin / admin123</span>
        </div>
        <p class="auth-note">演示登录仅用于展示角色差异，不是真实身份验证；正式部署需接入 WorkBuddy Auth 与数据库权限策略。</p>
      </form>`;
    return gate;
  }

  /** @param {Event} event @returns {void} */
  function handleSubmit(event) {
    event.preventDefault();
    const gate = document.querySelector(".auth-gate");
    const form = document.getElementById("authForm");
    const usernameInput = /** @type {HTMLInputElement|null} */ (document.getElementById("authUsername"));
    const passwordInput = /** @type {HTMLInputElement|null} */ (document.getElementById("authPassword"));
    const errorBox = document.getElementById("authError");
    if (!gate || !form || !usernameInput || !passwordInput || !errorBox) return;

    const result = login(usernameInput.value, passwordInput.value);
    if (!result.ok || !result.session) {
      errorBox.textContent = result.error || "登录失败";
      errorBox.hidden = false;
      passwordInput.value = "";
      passwordInput.focus();
      return;
    }

    gate.remove();
    document.body.classList.remove("auth-locked");
    if (onAuthenticated) onAuthenticated(result.session);
  }

  /** @param {{onAuthenticated:(session:DemoSession)=>void}} options @returns {void} */
  function init(options) {
    if (!options || typeof options.onAuthenticated !== "function") {
      throw new Error("AnxiangAuth.init 需要 onAuthenticated 回调");
    }
    onAuthenticated = options.onAuthenticated;
    const session = readSession();
    if (session) {
      document.body.classList.remove("auth-locked");
      onAuthenticated(session);
      return;
    }

    document.body.classList.add("auth-locked");
    if (!document.querySelector(".auth-gate")) document.body.append(buildLoginGate());
    const form = document.getElementById("authForm");
    if (form) form.addEventListener("submit", handleSubmit);
    const usernameInput = /** @type {HTMLInputElement|null} */ (document.getElementById("authUsername"));
    if (usernameInput) usernameInput.focus();
  }

  /** @returns {void} */
  function logout() {
    clearSession();
    window.location.reload();
  }

  window.AnxiangAuth = { init, logout, getSession: readSession };
})();

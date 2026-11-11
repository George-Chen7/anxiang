# -*- coding: utf-8 -*-
"""安响 · 本地服务端（静态托管 + REST API）
=====================================================================
技术栈：Python 3.13 标准库
  http.server.ThreadingHTTPServer  多线程 HTTP 服务
  sqlite3 (见 database.py)        持久化存储
  http.cookies / secrets          HttpOnly Cookie 会话
  hashlib.pbkdf2_hmac (database)  密码哈希

启动：双击 web/start.bat，或执行 `python server.py`
默认地址：http://127.0.0.1:8765/welcome.html

安全边界：
  - 仅监听 127.0.0.1（本机），不对外暴露；
  - 数据库文件、Python 源码、bat 等不在静态文件白名单内，无法通过 HTTP 下载；
  - 所有 /api/* 写操作都要求有效会话，并按角色鉴权；
  - 登录失败 5 次锁定 60 秒；Cookie 为 HttpOnly + SameSite=Lax。
"""
import functools
import json
import os
import socketserver
import sys
import threading
import time
import traceback
import webbrowser
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

import database as db

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT_FIRST = 8765
PORT_LAST = 8775
COOKIE_NAME = "ax_session"
COOKIE_MAX_AGE = db.SESSION_HOURS * 3600

# 静态资源白名单：确保 anxiang.db / *.py / *.bat 等不会被 HTTP 下载
ALLOWED_EXTENSIONS = {
    ".html", ".htm", ".js", ".mjs", ".css", ".json", ".map",
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
    ".woff", ".woff2", ".ttf", ".txt", ".md",
}

# 登录限流：同一 IP 连续失败 5 次锁定 60 秒
_login_guard = {}
_login_lock = threading.Lock()
MAX_FAILS = 5
LOCK_SECONDS = 60


def _rate_check(ip):
    with _login_lock:
        now = time.time()
        record = _login_guard.get(ip)
        if record and record[1] > now:
            raise db.ApiError("尝试次数过多，请 %d 秒后再试" % int(record[1] - now), 429)
        if record and record[1] <= now:
            _login_guard.pop(ip, None)


def _rate_fail(ip):
    with _login_lock:
        now = time.time()
        count, locked_until = _login_guard.get(ip, (0, 0))
        count += 1
        if count >= MAX_FAILS:
            count, locked_until = 0, now + LOCK_SECONDS
        _login_guard[ip] = (count, locked_until)


def _rate_clear(ip):
    with _login_lock:
        _login_guard.pop(ip, None)


class Handler(SimpleHTTPRequestHandler):
    server_version = "AnXiang/1.0"

    # ------------------------------------------------------------ 基础响应
    def log_message(self, *_args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        super().end_headers()

    def guess_type(self, path):
        mime = super().guess_type(path)
        if mime.startswith("text/") or mime in ("application/javascript", "application/json"):
            return mime + "; charset=utf-8"
        return mime

    def send_json(self, status, payload, cookie=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def session_token(self):
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        morsel = jar.get(COOKIE_NAME)
        return morsel.value if morsel else None

    def read_json(self):
        ctype = self.headers.get("Content-Type", "")
        if "application/json" not in ctype.lower():
            raise db.ApiError("请求需要使用 application/json", 415)
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise db.ApiError("请求长度不合法")
        if length <= 0:
            return {}
        if length > 65536:
            raise db.ApiError("请求体过大", 413)
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw.decode("utf-8"))
        except Exception:
            raise db.ApiError("请求体不是合法 JSON")
        if not isinstance(value, dict):
            raise db.ApiError("请求体必须是 JSON 对象")
        return value

    @staticmethod
    def _static_allowed(path):
        if path == "/" or path.endswith("/"):
            return True
        return os.path.splitext(path)[1].lower() in ALLOWED_EXTENSIONS

    # ------------------------------------------------------------ 请求入口
    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/":
            self.path = "/welcome.html"
        if path.startswith("/api/"):
            return self.handle_api("GET", path, {})
        if not self._static_allowed(path):
            return self.send_error(404, "Not Found")
        return super().do_GET()

    def do_HEAD(self):
        path = unquote(urlparse(self.path).path)
        if path.startswith("/api/"):
            return self.send_error(405, "Method Not Allowed")
        if not self._static_allowed(path):
            return self.send_error(404, "Not Found")
        return super().do_HEAD()

    def do_POST(self):
        path = unquote(urlparse(self.path).path)
        if path.startswith("/api/"):
            return self.handle_api("POST", path, None)
        return self.send_error(405, "Method Not Allowed")

    def do_DELETE(self):
        path = unquote(urlparse(self.path).path)
        if path.startswith("/api/"):
            return self.handle_api("DELETE", path, {})
        return self.send_error(405, "Method Not Allowed")

    def do_PUT(self):
        return self.send_error(405, "Method Not Allowed")

    # ------------------------------------------------------------ API 路由
    def handle_api(self, method, path, body):
        token = self.session_token()
        ip = self.client_address[0]
        try:
            # 健康检查无需登录
            if method == "GET" and path == "/api/health":
                return self.send_json(200, {
                    "ok": True, "service": "anxiang", "database": os.path.basename(db.DB_PATH),
                    "time": db.now_str(), "auth": "sqlite-session",
                })

            # 登录
            if method == "POST" and path == "/api/login":
                _rate_check(ip)
                payload = self.read_json()
                user = db.authenticate(payload.get("username"), payload.get("password"), payload.get("role"))
                if not user:
                    _rate_fail(ip)
                    raise db.ApiError("账号、密码或角色不匹配，请检查后重试", 401)
                _rate_clear(ip)
                new_token = db.create_session(user["id"])
                cookie = "%s=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=%d" % (
                    COOKIE_NAME, new_token, COOKIE_MAX_AGE)
                return self.send_json(200, {"ok": True, "user": user}, cookie=cookie)

            user = db.resolve_session(token)

            # 登出（即使会话已过期也返回成功，便于前端统一处理）
            if method == "POST" and path == "/api/logout":
                db.destroy_session(token)
                cookie = "%s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" % COOKIE_NAME
                return self.send_json(200, {"ok": True}, cookie=cookie)

            if not user:
                raise db.ApiError("请先登录", 401)

            if method == "GET" and path == "/api/me":
                return self.send_json(200, {"ok": True, "user": user})

            if method == "GET" and path == "/api/bootstrap":
                return self.send_json(200, {"ok": True, **db.bootstrap(user)})

            if method == "GET" and path == "/api/state":
                return self.send_json(200, {"ok": True, **db.state_snapshot(user)})

            if method == "GET" and path == "/api/events":
                return self.send_json(200, {"ok": True, "events": db.list_events()})

            if method == "GET" and path == "/api/logs":
                return self.send_json(200, {"ok": True, "logs": db.list_logs()})

            # 管理员：触发 / 撤回 / 重置
            if method == "POST" and path == "/api/events":
                db.require(user, db.ROLE_ADMIN)
                payload = self.read_json()
                event = db.create_event(user, payload)
                return self.send_json(201, {"ok": True, "event": event})

            if method == "POST" and path == "/api/reset":
                db.require(user, db.ROLE_ADMIN)
                db.reset_demo(user)
                return self.send_json(200, {"ok": True, **db.state_snapshot(user)})

            parts = [p for p in path.split("/") if p]
            if len(parts) == 3 and parts[0] == "api" and parts[1] == "events" and method == "DELETE":
                db.require(user, db.ROLE_ADMIN)
                db.delete_event(user, parts[2])
                return self.send_json(200, {"ok": True, "id": parts[2]})

            # 网格员：四步处置流转
            if len(parts) == 4 and parts[0] == "api" and parts[1] == "events" and method == "POST":
                db.require(user, db.ROLE_GRID)
                event_id, action = parts[2], parts[3]
                payload = self.read_json()
                handlers = {
                    "claim": lambda: db.claim_event(user, event_id, str(payload.get("note") or "")),
                    "contact": lambda: db.contact_event(user, event_id, payload),
                    "dispatch": lambda: db.dispatch_event(user, event_id, payload),
                    "resolve": lambda: db.resolve_event(user, event_id, payload),
                }
                if action not in handlers:
                    raise db.ApiError("未知的处置动作", 404)
                event = handlers[action]()
                return self.send_json(200, {"ok": True, "event": event})

            raise db.ApiError("接口不存在或方法不被支持", 404)

        except db.ApiError as exc:
            self.send_json(exc.status, {"ok": False, "message": exc.message})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            self.send_json(500, {"ok": False, "message": "服务器内部错误，请查看控制台日志"})


def open_browser(url):
    try:
        webbrowser.open(url)
    except Exception:
        print("无法自动打开浏览器，请手动访问：")
        print("  " + url)


def main():
    db.initialize()
    handler = functools.partial(Handler, directory=ROOT)
    server = None
    for port in range(PORT_FIRST, PORT_LAST + 1):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), handler)
            server.daemon_threads = True
            break
        except OSError:
            continue
    if server is None:
        print("ERROR: 8765-8775 端口均被占用，无法启动。")
        sys.exit(1)

    url = "http://127.0.0.1:%d/welcome.html" % server.server_address[1]
    print("=" * 62)
    print(" 安响 · 社区告警与处置  (Python + SQLite)")
    print(" 访问地址 : %s" % url)
    print(" 数据库   : %s" % db.DB_PATH)
    print(" 演示账号 : admin/admin123 (管理员)  grid/grid123 (网格员)")
    print(" 目录     : %s" % ROOT)
    print(" 关闭窗口或按 Ctrl+C 停止服务")
    print("=" * 62)
    if os.environ.get("ELDER_NO_BROWSER") != "1":
        threading.Timer(0.8, lambda: open_browser(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

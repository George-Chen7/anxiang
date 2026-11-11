# -*- coding: utf-8 -*-
"""安响 · 数据访问层（SQLite）
=====================================================================
技术栈：Python 3.13 标准库 sqlite3，零第三方依赖。

表结构：
  users      账号（PBKDF2-SHA256 加盐哈希，绝不明文存密码）
  sessions   服务端会话（随机 token + 过期时间，支持滑动续期）
  events     异常事件（含处置状态、联系/上门/结果的结构化字段）
  timeline   每条事件的处置时间线（一次处置 = 一条不可变记录）
  logs       平台操作日志（跨事件审计）
  meta       事件自增序号等元数据

所有写操作在单个事务内完成「事件状态 + 时间线 + 操作日志」的原子更新。
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "anxiang.db")
SESSION_HOURS = 12
PBKDF2_ITERATIONS = 120_000

# ---------------------------------------------------------------- 常量
STATUS = {
    "PENDING": "待接收",
    "CLAIMED": "已接收",
    "CONTACTED": "已联系住户",
    "DISPATCHED": "已安排上门",
    "FOLLOWUP": "需持续跟进",
    "RESOLVED": "已完成",
}
LEVEL_NAME = {3: "紧急", 2: "较高", 1: "关注"}
ROLE_ADMIN = "admin"
ROLE_GRID = "grid"

BUILDINGS = [
    {"id": "A1", "name": "A区 1号楼"},
    {"id": "A2", "name": "A区 2号楼"},
    {"id": "B3", "name": "B区 3号楼"},
    {"id": "C2", "name": "C区 2号楼"},
    {"id": "B5", "name": "B区 5号楼"},
]

# 住户档案摘要（与 profile-card 子应用 residents.js 对应）
RESIDENTS = [
    {"id": "AX-001", "name": "周慧兰", "ageText": "78 岁", "building": "B3", "floor": 31, "unit": "2单元", "room": "3102", "care": "独居 · 重点关怀", "contact": "周敏（女儿）", "phone": "138 **** 6721"},
    {"id": "AX-002", "name": "李国栋", "ageText": "82 岁", "building": "A1", "floor": 22, "unit": "1单元", "room": "2201", "care": "独居 · 慢病随访", "contact": "李建（儿子）", "phone": "139 **** 3108"},
    {"id": "AX-003", "name": "陈秀英", "ageText": "85 岁", "building": "B5", "floor": 17, "unit": "2单元", "room": "1702", "care": "独居 · 每日关怀", "contact": "陈岚（孙女）", "phone": "137 **** 9063"},
    {"id": "AX-004", "name": "王振华", "ageText": "74 岁", "building": "A2", "floor": 28, "unit": "1单元", "room": "2801", "care": "夫妻同住 · 常规关注", "contact": "王磊（儿子）", "phone": "136 **** 4452"},
    {"id": "AX-005", "name": "赵淑芬", "ageText": "79 岁", "building": "C2", "floor": 12, "unit": "2单元", "room": "1202", "care": "独居 · 门磁提醒", "contact": "赵宁（女儿）", "phone": "135 **** 7780"},
]

EVENT_TYPES = [
    {"key": "suspected_fall", "name": "疑似跌倒", "level": 3, "icon": "✚", "tone": "red", "device": "模拟活动传感器 MV-{room} · 最后活动在告警前 2 分钟，检测到高度骤降，之后未见起身信号", "description": "住户可能无法主动求助。当前信号无法区分跌倒与主动坐卧，请核实住户是否安全。", "advice": "联系住户或紧急联系人；无人回应时按社区流程安排上门核实。"},
    {"key": "inactive", "name": "异常长时间静止", "level": 2, "icon": "◐", "tone": "amber", "device": "模拟活动传感器 AC-{room} · 最后活动在告警前 3 小时，此后设备心跳正常，未收到新活动信号", "description": "当前缺少个人作息基线，需核实住户是否外出、休息或需要协助。", "advice": "先核实住户行程与设备覆盖情况，再记录联系或上门结果。"},
    {"key": "fall", "name": "住户主动求助", "level": 3, "icon": "✚", "tone": "red", "device": "模拟求助按钮 SOS-{room} · 收到主动求助信号", "description": "住户触发了求助按钮，具体原因待核实。", "advice": "联系住户了解需要何种协助，按核实情况安排处置。"},
    {"key": "gas", "name": "燃气浓度异常", "level": 3, "icon": "◈", "tone": "red", "device": "燃气传感器 CH₄-{room} · 18% LEL（连续 3 次超阈值）", "description": "住户厨房燃气浓度连续 3 次超过预设阈值，请尽快电话核实并安排现场排查。", "advice": "优先电话联系住户，确认是否正在用火；无人接听时立即安排上门。"},
    {"key": "smoke", "name": "烟雾浓度异常", "level": 3, "icon": "◉", "tone": "red", "device": "烟雾探测器 SM-{room} · 86 ppm（持续上报）", "description": "烟雾探测器持续上报异常浓度，需联系住户确认现场情况并排查火情。", "advice": "第一时间电话核实，必要时联动物业与消防，切勿仅凭设备读数判定误报。"},
    {"key": "water", "name": "用水异常", "level": 2, "icon": "≋", "tone": "amber", "device": "智能水表 WM-{room} · 连续流量异常 6 小时", "description": "智能水表出现持续用水记录，建议联系住户确认是否存在漏水或忘关水龙头。", "advice": "联系住户核实，必要时协调物业关闭总阀并上门检查。"},
    {"key": "firelane", "name": "消防通道占用", "level": 2, "icon": "▤", "tone": "amber", "device": "楼道摄像头 CV-{room} · 识别到障碍物滞留", "description": "楼道公共区域检测到物品长时间堆放，可能影响消防疏散，请核实并协调清理。", "advice": "联系住户确认物品归属，张贴告知并安排物业协助清理。"},
    {"key": "door", "name": "门磁长时开启", "level": 1, "icon": "▣", "tone": "gold", "device": "门磁传感器 DC-{room} · 开启 48 分钟", "description": "住户入户门保持开启超过设定时长，请联系住户确认安全状态。", "advice": "电话确认为主，若联系不上再安排上门查看。"},
]

RESOLUTIONS = [
    {"key": "cleared", "label": "已排除风险", "tone": "green"},
    {"key": "onsite", "label": "已现场处置", "tone": "green"},
    {"key": "handover", "label": "转交其他部门", "tone": "amber"},
    {"key": "false", "label": "设备误报", "tone": "amber"},
    {"key": "followup", "label": "需持续跟进", "tone": "red"},
]

SEED_USERS = [
    ("u-admin", "admin", "admin123", "沈砚", ROLE_ADMIN, "平台管理员", "平台运营中心", "0571-**** 8801"),
    ("u-grid-1", "grid", "grid123", "林岸", ROLE_GRID, "社区网格员", "澄湾社区 · A/B 区网格", "138 **** 2201"),
    ("u-grid-2", "grid2", "grid123", "许澄", ROLE_GRID, "社区网格员", "澄湾社区 · C 区网格", "139 **** 2202"),
]

SEED_EVENTS = [
    ("AX-001", "疑似跌倒", "suspected_fall", 3, "B3", 31, "2单元", "3102", "模拟活动传感器 MV-3102 · 09:10 最后活动时高度骤降，至 09:12 未见起身信号", "住户可能无法主动求助。信号无法区分跌倒与主动坐卧，请核实住户是否安全。", "2026-11-07 09:12:40", STATUS["PENDING"], None, "AX-001"),
    ("AX-002", "烟雾浓度异常", "smoke", 3, "A1", 22, "1单元", "2201", "烟雾探测器 SM-2201 · 86 ppm", "烟雾探测器持续上报异常，值班人员需联系住户并确认现场情况。", "2026-11-07 08:56:20", STATUS["CLAIMED"], "u-grid-1", "AX-002"),
    ("AX-003", "异常长时间静止", "inactive", 2, "B5", 17, "2单元", "1702", "模拟活动传感器 AC-1702 · 05:31 最后活动，至 08:31 心跳正常，未收到新活动信号", "当前缺少个人作息基线，需核实住户是否外出、休息或需要协助。", "2026-11-07 08:31:10", STATUS["PENDING"], None, "AX-003"),
    ("AX-004", "用水异常", "water", 2, "A2", 28, "1单元", "2801", "智能水表 WM-2801 · 连续流量异常", "智能水表出现持续用水记录，建议联系住户确认是否存在漏水。", "2026-11-07 07:41:12", STATUS["CONTACTED"], "u-grid-1", "AX-004"),
    ("AX-005", "门磁长时开启", "door", 1, "C2", 12, "2单元", "1202", "门磁传感器 DC-1202 · 开启 48 分钟", "住户入户门保持开启超过设定时长，请联系住户确认。", "2026-11-07 07:13:00", STATUS["DISPATCHED"], "u-grid-2", "AX-005"),
]

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','grid')),
    role_name     TEXT NOT NULL,
    team          TEXT NOT NULL,
    phone         TEXT NOT NULL,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
    digest TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('admin','grid')),
    issued_by TEXT REFERENCES users(id),
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    type_key    TEXT,
    level       INTEGER NOT NULL CHECK (level IN (1,2,3)),
    building    TEXT NOT NULL,
    floor       INTEGER NOT NULL,
    unit        TEXT NOT NULL,
    room        TEXT NOT NULL,
    device      TEXT NOT NULL,
    description TEXT NOT NULL,
    time        TEXT NOT NULL,
    source      TEXT NOT NULL CHECK (source IN ('seed','simulator')),
    resident_id TEXT,
    assigned_to TEXT REFERENCES users(id),
    status      TEXT NOT NULL,
    contact     TEXT,
    dispatch    TEXT,
    result      TEXT,
    resolved_at TEXT,
    created_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(time DESC);
CREATE TABLE IF NOT EXISTS timeline (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    at         TEXT NOT NULL,
    actor_id   TEXT,
    actor_name TEXT NOT NULL,
    role       TEXT NOT NULL,
    action     TEXT NOT NULL,
    note       TEXT,
    kind       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timeline_event ON timeline(event_id, id);
CREATE TABLE IF NOT EXISTS logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL,
    actor_id   TEXT,
    actor_name TEXT NOT NULL,
    role       TEXT NOT NULL,
    action     TEXT NOT NULL,
    event_id   TEXT,
    detail     TEXT
);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class ApiError(Exception):
    """带 HTTP 状态码的业务异常，由 server.py 统一转成 JSON。"""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------- 基础
def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return "pbkdf2_sha256$%d$%s$%s" % (PBKDF2_ITERATIONS, salt.hex(), digest.hex())


def verify_password(password, encoded):
    try:
        _algo, iterations, salt_hex, hash_hex = encoded.split("$")
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def public_user(row):
    return {
        "id": row["id"], "username": row["username"], "name": row["name"],
        "role": row["role"], "roleName": row["role_name"],
        "canInvite": row["role"] == ROLE_ADMIN and row["id"] != "u-admin",
        "team": row["team"], "phone": row["phone"],
    }


def require(user, role=None):
    if not user:
        raise ApiError("登录状态已失效，请重新登录", 401)
    if role and user["role"] != role:
        raise ApiError("当前角色无权执行此操作", 403)
    return user


# ---------------------------------------------------------------- 初始化
def initialize():
    """建库、建表、写入演示账号与初始事件（仅首次执行）。"""
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        count = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        if count == 0:
            with conn:
                stamp = now_str()
                for uid, username, password, name, role, role_name, team, phone in SEED_USERS:
                    conn.execute(
                        "INSERT INTO users (id,username,password_hash,name,role,role_name,team,phone,is_active,created_at)"
                        " VALUES (?,?,?,?,?,?,?,?,1,?)",
                        (uid, username, hash_password(password), name, role, role_name, team, phone, stamp),
                    )
                for row in SEED_EVENTS:
                    (eid, etype, ekey, level, building, floor, unit, room,
                     device, desc, time_value, status, assignee, resident_id) = row
                    conn.execute(
                        "INSERT INTO events (id,type,type_key,level,building,floor,unit,room,device,description,"
                        "time,source,resident_id,assigned_to,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (eid, etype, ekey, level, building, floor, unit, room, device, desc,
                         time_value, "seed", resident_id, assignee, status),
                    )
                    _timeline(conn, eid, "system", "安响感知平台", "system", "告警产生", device, "alert", time_value)
                    if assignee:
                        owner = conn.execute("SELECT name FROM users WHERE id=?", (assignee,)).fetchone()
                        _timeline(conn, eid, assignee, owner["name"] if owner else assignee,
                                  ROLE_GRID, "接收事件", "系统按网格分派", "claim", time_value)
                conn.execute("INSERT INTO meta (key,value) VALUES ('event_seq', '6')")
                _log(conn, "system", "安响感知平台", "system", "载入演示数据", "—", "初始化 5 条社区告警事件")
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            if not conn.execute("SELECT 1 FROM meta WHERE key='care_demo_v2'").fetchone():
                # Only update untouched original seed alerts. Keep all real operator history.
                for seed, old_type in ((SEED_EVENTS[0], "燃气浓度异常"), (SEED_EVENTS[2], "独居关怀提醒")):
                    eid, title, key, level = seed[:4]
                    changed = conn.execute(
                        "UPDATE events SET type=?,type_key=?,level=?,device=?,description=? "
                        "WHERE id=? AND source='seed' AND type=? AND status=? AND assigned_to IS NULL "
                        "AND (SELECT COUNT(*) FROM timeline WHERE event_id=events.id)=1",
                        (title, key, level, seed[8], seed[9], eid, old_type, STATUS["PENDING"]),
                    )
                    if changed.rowcount:
                        conn.execute("UPDATE timeline SET note=? WHERE event_id=? AND kind='alert'", (seed[8], eid))
                conn.execute("UPDATE events SET status=?,resolved_at=NULL WHERE status=? "
                             "AND json_extract(result,'$.resolutionKey')='followup'",
                             (STATUS["FOLLOWUP"], STATUS["RESOLVED"]))
                conn.execute("INSERT INTO meta VALUES ('care_demo_v2','1')")
    finally:
        conn.close()


# ---------------------------------------------------------------- 会话
def issue_invitation(role: str, issuer_id: str | None) -> dict:
    if role not in (ROLE_ADMIN, ROLE_GRID):
        raise ApiError("请选择有效的账号角色")
    code = secrets.token_urlsafe(24)
    digest = hashlib.sha256(code.encode()).hexdigest()
    expires = (datetime.now() + timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
    conn = connect()
    try:
        with conn:
            conn.execute("DELETE FROM invitations WHERE expires_at <= ?", (now_str(),))
            conn.execute("INSERT INTO invitations VALUES (?,?,?,?)", (digest, role, issuer_id, expires))
    finally:
        conn.close()
    return {"code": code, "role": role, "expiresAt": expires}


def register_account(payload: dict) -> None:
    if not isinstance(payload.get("username"), str) or not isinstance(payload.get("name"), str):
        raise ApiError("请输入账号和姓名")
    username = payload["username"].strip().lower()
    name = payload["name"].strip()
    role = payload.get("role")
    password = payload.get("password")
    code = str(payload.get("code") or "").strip()
    if not re.fullmatch(r"[a-z0-9_]{3,32}", username):
        raise ApiError("账号需为 3 至 32 位字母、数字或下划线")
    if not 1 <= len(name) <= 32 or not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise ApiError("请输入 1 至 32 字的姓名和 8 至 128 位密码")
    if role not in (ROLE_ADMIN, ROLE_GRID) or not code:
        raise ApiError("请选择角色并提供对应的邀请码")
    digest = hashlib.sha256(code.encode()).hexdigest()
    role_name = "平台管理员" if role == ROLE_ADMIN else "社区网格员"
    conn = connect()
    try:
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            used = conn.execute("DELETE FROM invitations WHERE digest=? AND role=? AND expires_at>?",
                                (digest, role, now_str()))
            if not used.rowcount:
                raise ApiError("邀请码无效、过期或不适用于所选角色")
            if conn.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                raise ApiError("该账号已注册，请更换账号", 409)
            conn.execute("INSERT INTO users (id,username,password_hash,name,role,role_name,team,phone,created_at)"
                         " VALUES (?,?,?,?,?,?,?,?,?)",
                         ("u-" + secrets.token_hex(16), username, hash_password(password), name, role,
                          role_name, "澄湾社区", "", now_str()))
    finally:
        conn.close()


def authenticate(username, password, role=None):
    """校验账号密码，返回公开用户信息；失败返回 None。"""
    conn = connect()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE username=? AND is_active=1",
            (str(username or "").strip().lower(),),
        ).fetchone()
    finally:
        conn.close()
    if not row or not verify_password(str(password or ""), row["password_hash"]):
        return None
    if role and row["role"] != role:
        return None
    return public_user(row)


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    now = datetime.now()
    conn = connect()
    try:
        with conn:
            conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now_str(),))
            conn.execute(
                "INSERT INTO sessions (token,user_id,created_at,expires_at,last_seen) VALUES (?,?,?,?,?)",
                (token, user_id, now_str(), (now + timedelta(hours=SESSION_HOURS)).strftime("%Y-%m-%d %H:%M:%S"), now_str()),
            )
    finally:
        conn.close()
    return token


def resolve_session(token):
    """校验 token 并滑动续期；无效返回 None。"""
    if not token:
        return None
    conn = connect()
    try:
        row = conn.execute(
            "SELECT s.token,s.expires_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id"
            " WHERE s.token=? AND s.expires_at > ? AND u.is_active=1",
            (token, now_str()),
        ).fetchone()
        if not row:
            return None
        with conn:
            conn.execute(
                "UPDATE sessions SET last_seen=?, expires_at=? WHERE token=?",
                (now_str(), (datetime.now() + timedelta(hours=SESSION_HOURS)).strftime("%Y-%m-%d %H:%M:%S"), token),
            )
        return public_user(row)
    finally:
        conn.close()


def destroy_session(token):
    if not token:
        return
    conn = connect()
    try:
        with conn:
            conn.execute("DELETE FROM sessions WHERE token=?", (token,))
    finally:
        conn.close()


# ---------------------------------------------------------------- 内部辅助
def _timeline(conn, event_id, actor_id, actor_name, role, action, note, kind, at=None):
    conn.execute(
        "INSERT INTO timeline (event_id,at,actor_id,actor_name,role,action,note,kind) VALUES (?,?,?,?,?,?,?,?)",
        (event_id, at or now_str(), actor_id, actor_name, role, action, note or "", kind),
    )


def _log(conn, actor_id, actor_name, role, action, event_id, detail):
    conn.execute(
        "INSERT INTO logs (at,actor_id,actor_name,role,action,event_id,detail) VALUES (?,?,?,?,?,?,?)",
        (now_str(), actor_id, actor_name, role, action, event_id or "—", detail or ""),
    )


def _actor(user):
    return user["id"], user["name"], user["role"]


def _add_step(conn, event_id, user, action, note, kind):
    actor_id, actor_name, role = _actor(user)
    _timeline(conn, event_id, actor_id, actor_name, role, action, note, kind)
    _log(conn, actor_id, actor_name, role, action, event_id, note)


def _json_field(value):
    return json.loads(value) if value else None


# ---------------------------------------------------------------- 事件读取
def _serialize_event(conn, row):
    item = dict(row)
    # 输出驼峰别名，与前端既有字段保持一致（前端无需感知数据库列名）
    item["assignedTo"] = row["assigned_to"]
    item["residentId"] = row["resident_id"]
    item["resolvedAt"] = row["resolved_at"]
    item["createdBy"] = row["created_by"]
    item["typeKey"] = row["type_key"]
    item["contact"] = _json_field(row["contact"])
    item["dispatch"] = _json_field(row["dispatch"])
    item["result"] = _json_field(row["result"])
    item["timeline"] = []
    for t in conn.execute(
        "SELECT at,actor_id,actor_name,role,action,note,kind FROM timeline WHERE event_id=? ORDER BY id",
        (row["id"],),
    ).fetchall():
        step = dict(t)
        step["actorName"] = t["actor_name"]
        step["actorId"] = t["actor_id"]
        item["timeline"].append(step)
    return item


def list_events():
    conn = connect()
    try:
        rows = conn.execute("SELECT * FROM events ORDER BY time DESC, id DESC").fetchall()
        return [_serialize_event(conn, r) for r in rows]
    finally:
        conn.close()


def get_event(event_id):
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
        return _serialize_event(conn, row) if row else None
    finally:
        conn.close()


def list_logs(limit=60):
    conn = connect()
    try:
        result = []
        for r in conn.execute(
            "SELECT at,actor_id,actor_name,role,action,event_id,detail FROM logs ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall():
            item = dict(r)
            item["actorName"] = r["actor_name"]
            item["actorId"] = r["actor_id"]
            item["eventId"] = r["event_id"]
            result.append(item)
        return result
    finally:
        conn.close()


def list_users():
    conn = connect()
    try:
        return [public_user(r) for r in conn.execute(
            "SELECT * FROM users WHERE is_active=1 ORDER BY role, id"
        ).fetchall()]
    finally:
        conn.close()


def stats():
    conn = connect()
    try:
        rows = conn.execute("SELECT status,level,source,time FROM events").fetchall()
    finally:
        conn.close()
    today = datetime.now().strftime("%Y-%m-%d")
    return {
        "total": len(rows),
        "pending": sum(1 for r in rows if r["status"] == STATUS["PENDING"]),
        "active": sum(1 for r in rows if r["status"] not in (STATUS["PENDING"], STATUS["RESOLVED"])),
        "resolved": sum(1 for r in rows if r["status"] == STATUS["RESOLVED"]),
        "urgent": sum(1 for r in rows if r["level"] == 3 and r["status"] != STATUS["RESOLVED"]),
        "simulatedToday": sum(1 for r in rows if r["source"] == "simulator" and r["time"][:10] == today),
    }


def bootstrap(user):
    """登录后一次性返回前端渲染所需的全部基础数据。"""
    return {
        "user": public_user(user) if isinstance(user, sqlite3.Row) else user,
        "eventTypes": EVENT_TYPES,
        "events": list_events(),
        "logs": list_logs(),
        "stats": stats(),
        "users": list_users(),
        "serverTime": now_str(),
        "database": os.path.basename(DB_PATH),
    }


def state_snapshot(user):
    """轮询用的轻量快照（不含静态字典）。"""
    return {
        "user": user,
        "events": list_events(),
        "users": list_users(),
        "logs": list_logs(20),
        "stats": stats(),
        "serverTime": now_str(),
    }


# ---------------------------------------------------------------- 管理员：事件模拟器
def create_event(user, payload):
    require(user, ROLE_ADMIN)
    template = next((t for t in EVENT_TYPES if t["key"] == payload.get("typeKey")), None)
    if not template:
        raise ApiError("未知的事件类型")
    building = payload.get("building")
    if building not in [b["id"] for b in BUILDINGS]:
        raise ApiError("请选择有效楼栋")
    try:
        floor = int(payload.get("floor", 0))
    except (TypeError, ValueError):
        raise ApiError("楼层格式不正确")
    if not 1 <= floor <= 35:
        raise ApiError("楼层需在 1 - 35 之间")
    level = int(payload.get("level") or template["level"])
    if level not in (1, 2, 3):
        raise ApiError("告警等级不正确")
    room = str(payload.get("room") or ("%02d02" % floor))[:12]
    device = str(payload.get("device") or template["device"]).replace("{room}", room)
    description = str(payload.get("description") or template["description"]).strip()
    if not description:
        raise ApiError("请填写事件描述")
    resident_id = payload.get("residentId") or None
    assigned_to = payload.get("assignedTo") or None
    if assigned_to:
        valid = any(u["id"] == assigned_to and u["role"] == ROLE_GRID for u in list_users())
        if not valid:
            raise ApiError("指派的网格员不存在")

    conn = connect()
    try:
        with conn:
            seq_row = conn.execute("SELECT value FROM meta WHERE key='event_seq'").fetchone()
            seq = int(seq_row["value"]) if seq_row else 6
            conn.execute("UPDATE meta SET value=? WHERE key='event_seq'", (str(seq + 1),))
            event_id = "AX-%03d" % seq
            stamp = now_str()
            conn.execute(
                "INSERT INTO events (id,type,type_key,level,building,floor,unit,room,device,description,"
                "time,source,resident_id,assigned_to,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (event_id, template["name"], template["key"], level, building, floor,
                 str(payload.get("unit") or "2单元"), room, device, description, stamp,
                 "simulator", resident_id, assigned_to, STATUS["PENDING"], user["id"]),
            )
            _timeline(conn, event_id, user["id"], user["name"], user["role"],
                      "模拟器触发告警", device, "alert", stamp)
            assignee_name = "公共事件池"
            if assigned_to:
                owner = conn.execute("SELECT name FROM users WHERE id=?", (assigned_to,)).fetchone()
                assignee_name = "指派 " + (owner["name"] if owner else assigned_to)
            _log(conn, user["id"], user["name"], user["role"], "触发异常事件", event_id,
                 "%s · %s %d层 %s室 · %s" % (template["name"], building, floor, room, assignee_name))
        return get_event(event_id)
    finally:
        conn.close()


def delete_event(user, event_id):
    require(user, ROLE_ADMIN)
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
        if not row:
            raise ApiError("事件不存在", 404)
        with conn:
            conn.execute("DELETE FROM events WHERE id=?", (event_id,))
            _log(conn, user["id"], user["name"], user["role"], "撤回事件", event_id,
                 "%s · %s" % (row["type"], row["room"]))
        return {"id": event_id}
    finally:
        conn.close()


def reset_demo(user):
    require(user, ROLE_ADMIN)
    conn = connect()
    try:
        with conn:
            conn.execute("DELETE FROM timeline")
            conn.execute("DELETE FROM logs")
            conn.execute("DELETE FROM events")
            for row in SEED_EVENTS:
                (eid, etype, ekey, level, building, floor, unit, room,
                 device, desc, time_value, status, assignee, resident_id) = row
                conn.execute(
                    "INSERT INTO events (id,type,type_key,level,building,floor,unit,room,device,description,"
                    "time,source,resident_id,assigned_to,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (eid, etype, ekey, level, building, floor, unit, room, device, desc,
                     time_value, "seed", resident_id, assignee, status),
                )
                _timeline(conn, eid, "system", "安响感知平台", "system", "告警产生", device, "alert", time_value)
                if assignee:
                    owner = conn.execute("SELECT name FROM users WHERE id=?", (assignee,)).fetchone()
                    _timeline(conn, eid, assignee, owner["name"] if owner else assignee,
                              ROLE_GRID, "接收事件", "系统按网格分派", "claim", time_value)
            conn.execute("UPDATE meta SET value='6' WHERE key='event_seq'")
            _log(conn, user["id"], user["name"], user["role"], "重置演示数据", "—",
                 "恢复 5 条初始告警，清空模拟事件与处置记录")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------- 网格员：处置流转
def _load_event_for_action(conn, user, event_id):
    require(user, ROLE_GRID)
    conn.execute("BEGIN IMMEDIATE")
    row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    if not row:
        raise ApiError("事件不存在", 404)
    if row["assigned_to"] and row["assigned_to"] != user["id"]:
        owner = conn.execute("SELECT name FROM users WHERE id=?", (row["assigned_to"],)).fetchone()
        raise ApiError("该事件已由 %s 接收" % (owner["name"] if owner else "其他网格员"), 403)
    return row


def claim_event(user, event_id, note=""):
    conn = connect()
    try:
        with conn:
            row = _load_event_for_action(conn, user, event_id)
            if row["status"] != STATUS["PENDING"]:
                raise ApiError("该事件已被接收，无需重复操作")
            conn.execute("UPDATE events SET assigned_to=?, status=? WHERE id=?",
                         (user["id"], STATUS["CLAIMED"], event_id))
            _add_step(conn, event_id, user, "接收事件", note or "网格员认领，开始处置", "claim")
        return get_event(event_id)
    finally:
        conn.close()


def contact_event(user, event_id, payload):
    note = str((payload or {}).get("note") or "").strip()
    if not note:
        raise ApiError("请填写联系情况说明")
    channel = str((payload or {}).get("channel") or "电话")
    outcome = str((payload or {}).get("outcome") or "已接通")
    conn = connect()
    try:
        with conn:
            row = _load_event_for_action(conn, user, event_id)
            if row["status"] != STATUS["CLAIMED"]:
                raise ApiError("请先接收事件，再记录联系住户")
            value = {"channel": channel, "outcome": outcome, "note": note,
                     "at": now_str(), "by": user["name"]}
            conn.execute("UPDATE events SET contact=?, status=? WHERE id=?",
                         (json.dumps(value, ensure_ascii=False), STATUS["CONTACTED"], event_id))
            _add_step(conn, event_id, user, "联系住户", "%s · %s｜%s" % (channel, outcome, note), "contact")
        return get_event(event_id)
    finally:
        conn.close()


def dispatch_event(user, event_id, payload):
    when = str((payload or {}).get("time") or "").strip()
    if not when:
        raise ApiError("请选择上门时间")
    staff = str((payload or {}).get("staff") or user["name"]).strip()
    note = str((payload or {}).get("note") or "").strip()
    conn = connect()
    try:
        with conn:
            row = _load_event_for_action(conn, user, event_id)
            if row["status"] not in (STATUS["CONTACTED"], STATUS["FOLLOWUP"]):
                raise ApiError("请先完成联系住户记录")
            value = {"time": when, "staff": staff, "note": note, "at": now_str(), "by": user["name"]}
            conn.execute("UPDATE events SET dispatch=?, status=?, result=NULL WHERE id=?",
                         (json.dumps(value, ensure_ascii=False), STATUS["DISPATCHED"], event_id))
            _add_step(conn, event_id, user, "安排上门",
                      "%s · %s%s" % (when, staff, "｜" + note if note else ""), "dispatch")
        return get_event(event_id)
    finally:
        conn.close()


def resolve_event(user, event_id, payload):
    resolution_key = str((payload or {}).get("resolution") or "")
    note = str((payload or {}).get("note") or "").strip()
    resolution = next((r for r in RESOLUTIONS if r["key"] == resolution_key), None)
    if not resolution:
        raise ApiError("请选择处理结论")
    if not note:
        raise ApiError("请填写处理结果说明")
    conn = connect()
    try:
        with conn:
            row = _load_event_for_action(conn, user, event_id)
            if row["status"] not in (STATUS["CONTACTED"], STATUS["DISPATCHED"], STATUS["FOLLOWUP"]):
                raise ApiError("请先完成联系住户后再记录处理结果")
            stamp = now_str()
            value = {"resolution": resolution["label"], "resolutionKey": resolution_key,
                     "note": note, "at": stamp, "by": user["name"]}
            status = STATUS["RESOLVED"]
            action, kind, resolved_at = "记录处理结果", "resolve", stamp
            detail = "%s｜%s" % (resolution["label"], note)
            if resolution_key == "followup":
                try:
                    due = datetime.strptime(str(payload.get("nextFollowupAt", "")), "%Y-%m-%dT%H:%M")
                except ValueError:
                    raise ApiError("请填写有效的下次跟进时间")
                if due <= datetime.now():
                    raise ApiError("下次跟进时间应晚于当前时间")
                value["nextFollowupAt"] = due.strftime("%Y-%m-%d %H:%M")
                status, resolved_at = STATUS["FOLLOWUP"], None
                action, kind = "登记持续跟进", "followup"
                detail = "下次跟进 %s｜%s" % (value["nextFollowupAt"], note)
            conn.execute("UPDATE events SET result=?, status=?, resolved_at=? WHERE id=?",
                         (json.dumps(value, ensure_ascii=False), status, resolved_at, event_id))
            _add_step(conn, event_id, user, action, detail, kind)
        return get_event(event_id)
    finally:
        conn.close()

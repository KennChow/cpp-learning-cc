"""C++ 学院后端 — FastAPI + SQLite"""

from __future__ import annotations

import sqlite3
import json
from contextlib import contextmanager
from pathlib import Path
from typing import Dict

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

# ── 配置 ──
DB_PATH = Path(__file__).parent / "data" / "progress.db"
STATIC_DIR = Path(__file__).parent.parent  # 项目根目录

app = FastAPI(title="C++ 学院 API")


# ── 自动补 .html 后缀 ──
class HtmlSuffixMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/") and "." not in path.split("/")[-1] and path != "/":
            html_file = STATIC_DIR / path.lstrip("/")
            if not html_file.exists() and html_file.with_suffix(".html").exists():
                return RedirectResponse(url=path + ".html", status_code=301)
        return await call_next(request)


app.add_middleware(HtmlSuffixMiddleware)


# ── 数据库 ──
def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_progress (
                user_id    TEXT NOT NULL,
                course_id  TEXT NOT NULL,
                progress   INTEGER DEFAULT 0,
                completed  INTEGER DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, course_id)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS quiz_results (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    TEXT NOT NULL,
                course_id  TEXT NOT NULL,
                question   TEXT NOT NULL,
                answer     TEXT NOT NULL,
                correct    INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)


@contextmanager
def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# ── 数据模型 ──
class ProgressUpdate(BaseModel):
    user_id: str
    course_id: str
    progress: int  # 0-100
    completed: bool = False


class ProgressBatch(BaseModel):
    user_id: str
    items: Dict[str, dict]  # { "b1": {"progress": 100, "completed": true}, ... }


class QuizSubmit(BaseModel):
    user_id: str
    course_id: str
    question: str
    answer: str
    correct: bool


# ── API 路由 ──
@app.get("/api/progress/{user_id}")
def get_progress(user_id: str):
    """获取用户全部课程进度"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT course_id, progress, completed FROM user_progress WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    return {
        row["course_id"]: {
            "progress": row["progress"],
            "completed": bool(row["completed"]),
        }
        for row in rows
    }


@app.put("/api/progress")
def update_progress(data: ProgressUpdate):
    """更新单个课程进度"""
    with get_db() as conn:
        conn.execute(
            """INSERT INTO user_progress (user_id, course_id, progress, completed, updated_at)
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(user_id, course_id)
               DO UPDATE SET progress=excluded.progress,
                             completed=excluded.completed,
                             updated_at=CURRENT_TIMESTAMP""",
            (data.user_id, data.course_id, data.progress, int(data.completed)),
        )
    return {"ok": True}


@app.put("/api/progress/batch")
def batch_update_progress(data: ProgressBatch):
    """批量同步进度（前端 localStorage → 服务端）"""
    with get_db() as conn:
        for course_id, info in data.items.items():
            conn.execute(
                """INSERT INTO user_progress (user_id, course_id, progress, completed, updated_at)
                   VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(user_id, course_id)
                   DO UPDATE SET progress=MAX(excluded.progress, user_progress.progress),
                                 completed=MAX(excluded.completed, user_progress.completed),
                                 updated_at=CURRENT_TIMESTAMP""",
                (
                    data.user_id,
                    course_id,
                    info.get("progress", 0),
                    int(info.get("completed", False)),
                ),
            )
    return {"ok": True}


@app.post("/api/quiz")
def submit_quiz(data: QuizSubmit):
    """提交答题记录"""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO quiz_results (user_id, course_id, question, answer, correct) VALUES (?, ?, ?, ?, ?)",
            (data.user_id, data.course_id, data.question, data.answer, int(data.correct)),
        )
    return {"ok": True}


@app.get("/api/quiz/{user_id}/{course_id}")
def get_quiz_results(user_id: str, course_id: str):
    """获取用户某课程的答题记录"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT question, answer, correct, created_at FROM quiz_results WHERE user_id = ? AND course_id = ? ORDER BY created_at DESC",
            (user_id, course_id),
        ).fetchall()
    return [dict(row) for row in rows]


# ── 静态文件 & SPA 回退 ──
@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


# 挂载静态文件（放在路由注册之后）
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


# ── 启动时初始化数据库 ──
@app.on_event("startup")
def on_startup():
    init_db()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

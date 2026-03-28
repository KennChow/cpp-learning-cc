# C++ 学院

系统化的 C++ 在线学习平台，覆盖从基础语法到现代 C++20 特性，共 24 节课程。

## 特性

- **三阶段课程体系**：初级（8 课）、中级（8 课）、进阶（8 课）
- **在线编译器**：内嵌 Monaco Editor，通过 Wandbox API 编译运行，无需本地环境
- **图解教学**：指针、vtable、内存布局等复杂概念配有 SVG 图解
- **知识检验与课后作业**：每课含选择题和编程作业
- **学习进度持久化**：SQLite 后端存储，支持跨设备同步

## 技术栈

- 前端：HTML + Tailwind CSS + PrismJS
- 后端：FastAPI + SQLite
- 编译：Wandbox API

## 部署

### Docker（推荐）

```bash
docker build -t cpp-academy .
docker run -d -p 8000:8000 cpp-academy
```

打开 `http://127.0.0.1:8000/` 即可访问。

持久化数据库（可选）：

```bash
docker run -d -p 8000:8000 -v cpp-data:/app/backend/data cpp-academy
```

### 本地运行

```bash
pip install -r backend/requirements.txt
python3 -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

打开 `http://127.0.0.1:8000/` 即可访问。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/progress/{user_id}` | 获取用户全部课程进度 |
| PUT | `/api/progress` | 更新单个课程进度 |
| PUT | `/api/progress/batch` | 批量同步进度 |
| POST | `/api/quiz` | 提交答题记录 |
| GET | `/api/quiz/{user_id}/{course_id}` | 获取答题历史 |

## 目录结构

```
├── index.html              # 首页
├── compiler.html           # 在线编译器
├── css/main.css            # 全局样式
├── data/curriculum.json    # 课程元数据
├── js/                     # 编译器与核心逻辑
├── backend/
│   ├── app.py              # FastAPI 应用 + SQLite
│   └── requirements.txt
├── lessons/
│   ├── beginner/           # 初级课程 01-08
│   ├── intermediate/       # 中级课程 01-08
│   └── advanced/           # 进阶课程 01-08
└── diagrams/               # 图解脚本
```

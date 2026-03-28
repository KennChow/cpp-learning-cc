# C++ 学院

系统化的 C++ 在线学习平台，覆盖从基础语法到现代 C++20 特性，共 24 节课程。

## 特性

- **三阶段课程体系**：初级（8 课）、中级（8 课）、进阶（8 课）
- **在线编译器**：内嵌 Monaco Editor，通过 Wandbox API 编译运行，无需本地环境
- **图解教学**：指针、vtable、内存布局等复杂概念配有 SVG 图解
- **知识检验与课后作业**：每课含选择题和编程作业

## 技术栈

- 纯前端静态站点（HTML + CSS + JS）
- Tailwind CSS CDN
- PrismJS 语法高亮
- Wandbox API 在线编译

## 部署

### Docker（推荐）

```bash
docker build -t cpp-academy .
docker run -d -p 8080:80 cpp-academy
```

打开 `http://127.0.0.1:8080/` 即可访问。

### 本地静态服务器

```bash
# Python
python3 -m http.server 8000

# Node.js
npx serve -p 8000
```

打开 `http://127.0.0.1:8000/` 即可访问。

## 目录结构

```
├── index.html              # 首页
├── compiler.html           # 在线编译器
├── css/main.css            # 全局样式
├── data/curriculum.json    # 课程元数据
├── js/                     # 编译器与核心逻辑
├── lessons/
│   ├── beginner/           # 初级课程 01-08
│   ├── intermediate/       # 中级课程 01-08
│   └── advanced/           # 进阶课程 01-08
└── diagrams/               # 图解脚本
```

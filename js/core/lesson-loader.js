/**
 * 课程页通用初始化逻辑
 *
 * 依赖：
 *   - window.ProgressStore  (store.js)
 *   - window.EditorManager  (editor-init.js)
 *   - window.WandboxCompiler (wandbox.js)
 *   - /data/curriculum.json
 */

var LessonLoader = (function () {
  'use strict';

  /** curriculum.json 内存缓存 */
  var _curriculumCache = null;

  // ─────────────────────────────────────────────
  // 公共 API
  // ─────────────────────────────────────────────

  /**
   * 从 /data/curriculum.json 加载课程元数据（内存缓存）
   * @returns {Promise<object>}
   */
  async function fetchCurriculum() {
    if (_curriculumCache) return _curriculumCache;

    try {
      var response = await fetch('/data/curriculum.json', { cache: 'default' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      _curriculumCache = await response.json();
      return _curriculumCache;
    } catch (e) {
      console.error('[LessonLoader] fetchCurriculum 失败:', e.message);
      // 返回空结构避免崩溃
      return { levels: [] };
    }
  }

  /**
   * 初始化当前课程页
   *
   * @param {string} lessonId  - 当前课程 ID，如 "beginner-03"
   */
  async function initLesson(lessonId) {
    if (!lessonId) {
      console.error('[LessonLoader] initLesson: lessonId 不能为空');
      return;
    }

    var curriculum = await fetchCurriculum();

    // 并行初始化各模块（互不依赖）
    await Promise.all([
      _safeRun('renderSidebar',      function () { renderSidebar(lessonId, curriculum); }),
      _safeRun('initProgressButtons',function () { initProgressButtons(lessonId); }),
      _safeRun('initQuiz',           function () { initQuiz(lessonId); }),
      _safeRun('initEmbeddedEditors',function () { return initEmbeddedEditors(); })
    ]);

    // 更新上/下课导航链接
    _safeRun('renderNavigation', function () {
      var adj = getAdjacentLessons(lessonId, curriculum);
      _renderNavigation(adj);
    });

    // 恢复已完成状态的视觉反馈
    if (window.ProgressStore && window.ProgressStore.isCompleted(lessonId)) {
      _markPageAsCompleted();
    }
  }

  // ─────────────────────────────────────────────
  // 侧边栏
  // ─────────────────────────────────────────────

  /**
   * 渲染侧边栏（高亮当前课）
   *
   * 期望 HTML 中存在 id="lesson-sidebar" 的元素。
   * curriculum.json 期望格式：
   * {
   *   levels: [
   *     { id: "beginner", title: "入门", lessons: [{ id, title, href }] },
   *     ...
   *   ]
   * }
   *
   * @param {string} currentLessonId
   * @param {object} curriculum
   */
  function renderSidebar(currentLessonId, curriculum) {
    var sidebar = document.getElementById('lesson-sidebar');
    if (!sidebar) return;

    // 找到当前课所在的级别
    var currentLevel = null;
    var levels       = (curriculum && curriculum.levels) ? curriculum.levels : [];

    for (var li = 0; li < levels.length; li++) {
      var level   = levels[li];
      var lessons = level.lessons || [];
      for (var lj = 0; lj < lessons.length; lj++) {
        if (lessons[lj].id === currentLessonId) {
          currentLevel = level;
          break;
        }
      }
      if (currentLevel) break;
    }

    if (!currentLevel) {
      // 当前课程不在 curriculum 中，仍渲染全部
      currentLevel = levels[0] || { title: '', lessons: [] };
    }

    var levelTitle   = currentLevel.title || '';
    var levelLessons = currentLevel.lessons || [];
    var store        = window.ProgressStore;

    var html = '<div class="sidebar-level-title">' + _esc(levelTitle) + '</div>';
    html    += '<ul class="sidebar-lesson-list">';

    for (var i = 0; i < levelLessons.length; i++) {
      var lesson      = levelLessons[i];
      var isCurrent   = lesson.id === currentLessonId;
      var isDone      = store ? store.isCompleted(lesson.id) : false;
      var icon        = isCurrent ? '→' : (isDone ? '✓' : '○');
      var cssClass    = 'sidebar-lesson-item' +
                        (isCurrent ? ' current' : '') +
                        (isDone    ? ' done'    : '');
      var href        = lesson.href || ('#' + lesson.id);

      html += '<li class="' + cssClass + '">' +
                '<a href="' + _esc(href) + '" title="' + _esc(lesson.title || '') + '">' +
                  '<span class="sidebar-icon" aria-hidden="true">' + icon + '</span>' +
                  '<span class="sidebar-lesson-title">' + _esc(lesson.title || lesson.id) + '</span>' +
                '</a>' +
              '</li>';
    }

    html += '</ul>';
    sidebar.innerHTML = html;
  }

  // ─────────────────────────────────────────────
  // 嵌入式编辑器
  // ─────────────────────────────────────────────

  /**
   * 初始化课程页内嵌编辑器
   *
   * 查找所有带 data-editor="runnable" 的 div，初始化为可运行编辑器。
   * 可选属性：
   *   data-code="..."   — 初始代码（也可放在 <script data-code> 子元素中）
   *   data-height="300" — 编辑区高度（px）
   *
   * @returns {Promise<void>}
   */
  async function initEmbeddedEditors() {
    var manager = window.EditorManager;
    if (!manager) {
      console.warn('[LessonLoader] EditorManager 未加载，跳过编辑器初始化');
      return;
    }

    var containers = document.querySelectorAll('[data-editor="runnable"]');
    if (!containers.length) return;

    // 确保 Monaco 加载完毕再批量初始化
    await manager.loadMonaco();

    var tasks = [];
    for (var ci = 0; ci < containers.length; ci++) {
      tasks.push(_initSingleEditor(manager, containers[ci]));
    }
    await Promise.all(tasks);
  }

  /**
   * 初始化单个嵌入式编辑器
   * @private
   */
  async function _initSingleEditor(manager, container) {
    var id          = container.id || ('editor-' + Math.random().toString(36).slice(2, 8));
    container.id    = id;

    // 提取初始代码：优先 data-code 属性，其次 <pre>/<code> 子元素，否则空
    var code = container.getAttribute('data-code') || '';
    if (!code) {
      var preEl  = container.querySelector('pre, code');
      if (preEl) code = preEl.textContent || '';
    }
    code = code.trim();

    // 设定高度
    var heightAttr = container.getAttribute('data-height');
    if (heightAttr) {
      container.style.height = parseInt(heightAttr, 10) + 'px';
    }

    try {
      await manager.initRunnable(id, code, null);
    } catch (e) {
      console.error('[LessonLoader] 编辑器初始化失败 #' + id + ':', e.message);
    }
  }

  // ─────────────────────────────────────────────
  // Quiz
  // ─────────────────────────────────────────────

  /**
   * 初始化 Quiz 交互
   *
   * 期望 HTML 结构：
   *   <div id="lesson-quiz" data-total="3">
   *     <div class="quiz-question" data-index="0" data-correct="B">
   *       <div class="quiz-options">
   *         <label class="quiz-option" data-value="A">...</label>
   *         ...
   *       </div>
   *     </div>
   *     <button id="quiz-submit">提交答案</button>
   *     <div id="quiz-result"></div>
   *   </div>
   *
   * @param {string} lessonId
   */
  function initQuiz(lessonId) {
    var quizContainer = document.getElementById('lesson-quiz');
    if (!quizContainer) return;

    var submitBtn  = document.getElementById('quiz-submit')  || quizContainer.querySelector('.quiz-submit');
    var resultEl   = document.getElementById('quiz-result')  || quizContainer.querySelector('.quiz-result');
    var questions  = quizContainer.querySelectorAll('.quiz-question');

    if (!questions.length) return;

    // 用户选择状态：questionIndex -> Set(选中的值)
    var userAnswers = {};

    // 绑定选项点击事件
    for (var qi = 0; qi < questions.length; qi++) {
      (function (qEl, qIdx) {
        var options      = qEl.querySelectorAll('.quiz-option');
        var isMultiple   = qEl.getAttribute('data-multiple') === 'true';
        userAnswers[qIdx] = new Set();

        for (var oi = 0; oi < options.length; oi++) {
          (function (optEl) {
            optEl.addEventListener('click', function () {
              var val = optEl.getAttribute('data-value');
              if (isMultiple) {
                // 多选：toggle
                if (userAnswers[qIdx].has(val)) {
                  userAnswers[qIdx].delete(val);
                  optEl.classList.remove('selected');
                } else {
                  userAnswers[qIdx].add(val);
                  optEl.classList.add('selected');
                }
              } else {
                // 单选：清除其他，选中当前
                userAnswers[qIdx].clear();
                for (var k = 0; k < options.length; k++) {
                  options[k].classList.remove('selected');
                }
                userAnswers[qIdx].add(val);
                optEl.classList.add('selected');
              }
            });
          })(options[oi]);
        }
      })(questions[qi], qi);
    }

    // 提交按钮
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        var totalQ      = questions.length;
        var correctCount = 0;

        for (var qi = 0; qi < questions.length; qi++) {
          var qEl        = questions[qi];
          var correctRaw = qEl.getAttribute('data-correct') || '';
          // 支持多选：data-correct="A,C"
          var correctSet = new Set(correctRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean));
          var userSet    = userAnswers[qi] || new Set();
          var options    = qEl.querySelectorAll('.quiz-option');

          // 比较 Sets
          var isCorrect = _setsEqual(userSet, correctSet);
          if (isCorrect) correctCount++;

          // 显示反馈
          for (var oi = 0; oi < options.length; oi++) {
            var optEl = options[oi];
            var val   = optEl.getAttribute('data-value');
            optEl.classList.remove('correct', 'wrong');
            if (correctSet.has(val)) {
              optEl.classList.add('correct');
            } else if (userSet.has(val) && !correctSet.has(val)) {
              optEl.classList.add('wrong');
            }
          }

          // 显示题目级别的解析
          var explanation = qEl.querySelector('.quiz-explanation');
          if (explanation) {
            explanation.style.display = 'block';
          }
        }

        var score = Math.round((correctCount / totalQ) * 100);

        // 显示总体结果
        if (resultEl) {
          var passed     = score >= 60;
          var resultHtml = '<div class="quiz-result-banner ' + (passed ? 'pass' : 'fail') + '">' +
                             '<b>' + (passed ? '通过！' : '未通过') + '</b> ' +
                             '得分：' + correctCount + '/' + totalQ + '（' + score + '%）' +
                           '</div>';
          if (!passed) {
            resultHtml += '<p class="quiz-retry-hint">请复习后重新作答。</p>';
          }
          resultEl.innerHTML = resultHtml;
          resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        // 禁用提交按钮，防止重复提交
        submitBtn.disabled    = true;
        submitBtn.textContent = '已提交';

        // 保存到 ProgressStore
        if (window.ProgressStore) {
          window.ProgressStore.markCompleted(lessonId, score);
          _markPageAsCompleted();
        }
      });
    }
  }

  // ─────────────────────────────────────────────
  // 进度按钮
  // ─────────────────────────────────────────────

  /**
   * 初始化"标记完成"按钮
   *
   * 期望 HTML：<button id="mark-complete-btn">标记为已完成</button>
   *
   * @param {string} lessonId
   */
  function initProgressButtons(lessonId) {
    var btn = document.getElementById('mark-complete-btn');
    if (!btn) return;

    var store = window.ProgressStore;

    // 恢复已完成状态
    if (store && store.isCompleted(lessonId)) {
      _setCompleteBtnDone(btn);
    }

    btn.addEventListener('click', function () {
      if (!store) return;
      store.markCompleted(lessonId, null);
      _setCompleteBtnDone(btn);
      _markPageAsCompleted();
    });
  }

  function _setCompleteBtnDone(btn) {
    btn.textContent  = '✓ 已完成';
    btn.disabled     = true;
    btn.classList.add('btn-completed');
  }

  function _markPageAsCompleted() {
    var indicator = document.getElementById('lesson-complete-indicator');
    if (indicator) {
      indicator.style.display = 'block';
      indicator.textContent   = '✓ 本课已完成';
    }
    // 给 <body> 添加 class，便于 CSS 样式联动
    document.body.classList.add('lesson-completed');
  }

  // ─────────────────────────────────────────────
  // 导航
  // ─────────────────────────────────────────────

  /**
   * 计算上/下课
   *
   * @param {string} lessonId
   * @param {object} curriculum
   * @returns {{ prev: {id, title, href}|null, next: {id, title, href}|null }}
   */
  function getAdjacentLessons(lessonId, curriculum) {
    var levels  = (curriculum && curriculum.levels) ? curriculum.levels : [];
    var allLessons = [];

    for (var li = 0; li < levels.length; li++) {
      var lessons = levels[li].lessons || [];
      for (var lj = 0; lj < lessons.length; lj++) {
        allLessons.push(lessons[lj]);
      }
    }

    var idx = -1;
    for (var i = 0; i < allLessons.length; i++) {
      if (allLessons[i].id === lessonId) { idx = i; break; }
    }

    return {
      prev: idx > 0                       ? allLessons[idx - 1] : null,
      next: idx >= 0 && idx < allLessons.length - 1 ? allLessons[idx + 1] : null
    };
  }

  /**
   * 将 prev/next 渲染到页面中的导航元素
   * 期望：id="lesson-prev-btn" 和 id="lesson-next-btn"
   * @private
   */
  function _renderNavigation(adj) {
    var prevBtn = document.getElementById('lesson-prev-btn');
    var nextBtn = document.getElementById('lesson-next-btn');

    if (prevBtn) {
      if (adj.prev) {
        prevBtn.href        = adj.prev.href || ('#' + adj.prev.id);
        prevBtn.textContent = '← ' + (adj.prev.title || adj.prev.id);
        prevBtn.style.visibility = 'visible';
      } else {
        prevBtn.style.visibility = 'hidden';
      }
    }

    if (nextBtn) {
      if (adj.next) {
        nextBtn.href        = adj.next.href || ('#' + adj.next.id);
        nextBtn.textContent = (adj.next.title || adj.next.id) + ' →';
        nextBtn.style.visibility = 'visible';
      } else {
        nextBtn.style.visibility = 'hidden';
      }
    }
  }

  // ─────────────────────────────────────────────
  // 工具函数
  // ─────────────────────────────────────────────

  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _setsEqual(a, b) {
    if (a.size !== b.size) return false;
    var arr = Array.from(a);
    for (var i = 0; i < arr.length; i++) {
      if (!b.has(arr[i])) return false;
    }
    return true;
  }

  async function _safeRun(label, fn) {
    try {
      await fn();
    } catch (e) {
      console.error('[LessonLoader] ' + label + ' 出错:', e.message);
    }
  }

  // ─────────────────────────────────────────────
  // 公开接口
  // ─────────────────────────────────────────────

  var LessonLoader = {
    fetchCurriculum:    fetchCurriculum,
    initLesson:         initLesson,
    renderSidebar:      renderSidebar,
    initEmbeddedEditors: initEmbeddedEditors,
    initQuiz:           initQuiz,
    initProgressButtons: initProgressButtons,
    getAdjacentLessons: getAdjacentLessons
  };

  return LessonLoader;
})();

// 挂载到全局
if (typeof window !== 'undefined') {
  window.LessonLoader = LessonLoader;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LessonLoader;
}

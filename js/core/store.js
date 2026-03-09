/**
 * 学习进度持久化存储
 * 使用 localStorage 保存用户学习进度、连击天数等数据。
 *
 * 数据结构版本：1
 * Key: cpp_learning_progress
 */

var ProgressStore = (function () {
  'use strict';

  var STORAGE_KEY = 'cpp_learning_progress';
  var VERSION     = 1;

  /**
   * 课程级别定义（与 curriculum.json 保持同步）
   * 用于计算各级别进度。
   */
  var LEVEL_LESSON_PREFIXES = {
    beginner:     'beginner-',
    intermediate: 'intermediate-',
    advanced:     'advanced-'
  };

  // ─────────────────────────────────────────────
  // 数据结构
  // ─────────────────────────────────────────────

  /**
   * 默认数据结构
   * @returns {object}
   */
  function defaultData() {
    return {
      version:        VERSION,
      lessons:        {},    // lessonId -> LessonRecord
      streak: {
        current:       0,
        longest:       0,
        lastStudyDate: null  // ISO 日期字符串 "YYYY-MM-DD"
      },
      totalCompleted: 0
    };
  }

  /**
   * 单条课程记录结构
   * @param {number|null} quizScore
   */
  function _defaultLessonRecord(quizScore) {
    return {
      completed:    true,
      completedAt:  new Date().toISOString(),
      quizScore:    quizScore !== undefined ? quizScore : null,
      attempts:     1
    };
  }

  // ─────────────────────────────────────────────
  // 读写
  // ─────────────────────────────────────────────

  /**
   * 从 localStorage 读取数据（含版本迁移）
   * @returns {object}
   */
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();

      var data = JSON.parse(raw);

      // 版本迁移
      data = _migrate(data);

      return data;
    } catch (e) {
      console.warn('[ProgressStore] load 失败，返回默认数据:', e.message);
      return defaultData();
    }
  }

  /**
   * 将数据写入 localStorage
   * @param {object} data
   * @returns {boolean} 是否写入成功
   */
  function save(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      // 可能因存储空间不足（QuotaExceededError）失败
      console.error('[ProgressStore] save 失败:', e.message);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // 版本迁移
  // ─────────────────────────────────────────────

  /**
   * 处理旧版数据迁移
   * @private
   */
  function _migrate(data) {
    if (!data || typeof data !== 'object') return defaultData();

    var version = data.version || 0;

    // v0 -> v1：添加 streak 字段和 totalCompleted
    if (version < 1) {
      data.version        = 1;
      data.lessons        = data.lessons        || {};
      data.streak         = data.streak         || { current: 0, longest: 0, lastStudyDate: null };
      data.totalCompleted = data.totalCompleted !== undefined
                              ? data.totalCompleted
                              : Object.keys(data.lessons).filter(function (id) {
                                  return data.lessons[id] && data.lessons[id].completed;
                                }).length;
    }

    // 未来版本迁移在此添加：if (version < 2) { ... }

    return data;
  }

  // ─────────────────────────────────────────────
  // 核心操作
  // ─────────────────────────────────────────────

  /**
   * 将课程标记为已完成
   *
   * @param {string}      lessonId   - 课程 ID，如 "beginner-01"
   * @param {number|null} quizScore  - 测验得分（0-100），null 表示无测验
   */
  function markCompleted(lessonId, quizScore) {
    if (!lessonId) { console.warn('[ProgressStore] markCompleted: lessonId 不能为空'); return; }

    var data   = load();
    var record = data.lessons[lessonId];

    if (record && record.completed) {
      // 已完成：更新 quizScore（取最高分），累加 attempts
      record.attempts = (record.attempts || 1) + 1;
      if (quizScore !== null && quizScore !== undefined) {
        record.quizScore = Math.max(record.quizScore || 0, quizScore);
      }
    } else {
      // 首次完成
      data.lessons[lessonId] = _defaultLessonRecord(quizScore);
      data.totalCompleted    = (data.totalCompleted || 0) + 1;
    }

    _updateStreak(data);
    save(data);

    // 触发自定义事件，供其他模块监听
    _dispatchEvent('progressUpdate', { lessonId: lessonId, data: data });
  }

  /**
   * 查询课程是否已完成
   * @param {string} lessonId
   * @returns {boolean}
   */
  function isCompleted(lessonId) {
    var data   = load();
    var record = data.lessons[lessonId];
    return !!(record && record.completed);
  }

  /**
   * 获取指定级别的进度
   *
   * @param {string} level - 'beginner' | 'intermediate' | 'advanced'
   * @param {number} [total] - 该级别总课程数（如不传则从已知数据推算）
   * @returns {{ completed: number, total: number, percentage: number }}
   */
  function getProgress(level, total) {
    var data    = load();
    var prefix  = LEVEL_LESSON_PREFIXES[level] || (level + '-');
    var lessons = data.lessons;

    // 统计已完成数量
    var completed = Object.keys(lessons).filter(function (id) {
      return id.startsWith(prefix) && lessons[id] && lessons[id].completed;
    }).length;

    // 若未传入 total，尝试从数据中推断（已完成数量即下限）
    var resolvedTotal = (total !== undefined && total !== null) ? total : Math.max(completed, 1);
    var percentage    = resolvedTotal > 0 ? Math.round((completed / resolvedTotal) * 100) : 0;

    return {
      completed:  completed,
      total:      resolvedTotal,
      percentage: percentage
    };
  }

  /**
   * 获取课程详情记录
   * @param {string} lessonId
   * @returns {object|null}
   */
  function getLessonRecord(lessonId) {
    var data = load();
    return data.lessons[lessonId] || null;
  }

  // ─────────────────────────────────────────────
  // 连击天数
  // ─────────────────────────────────────────────

  /**
   * 更新连击天数（内部调用）
   * @private
   */
  function _updateStreak(data) {
    var today         = _todayString();
    var streak        = data.streak || { current: 0, longest: 0, lastStudyDate: null };
    var lastDate      = streak.lastStudyDate;

    if (lastDate === today) {
      // 今天已经学过，不重复计算
      return;
    }

    if (lastDate === _yesterdayString()) {
      // 昨天学过 -> 连击 +1
      streak.current = (streak.current || 0) + 1;
    } else {
      // 中断 -> 重置
      streak.current = 1;
    }

    streak.longest       = Math.max(streak.longest || 0, streak.current);
    streak.lastStudyDate = today;
    data.streak          = streak;
  }

  /**
   * 公开的 updateStreak 方法（手动触发，用于每日登录场景）
   */
  function updateStreak() {
    var data = load();
    _updateStreak(data);
    save(data);
  }

  // ─────────────────────────────────────────────
  // 统计
  // ─────────────────────────────────────────────

  /**
   * 获取首页所需的统计数据
   *
   * @param {{ beginner?: number, intermediate?: number, advanced?: number }} [levelTotals]
   *   各级别总课程数，若不传则用已完成数量作为分母
   *
   * @returns {{
   *   totalCompleted: number,
   *   currentStreak: number,
   *   longestStreak: number,
   *   beginnerProgress: { completed, total, percentage },
   *   intermediateProgress: { completed, total, percentage },
   *   advancedProgress: { completed, total, percentage }
   * }}
   */
  function getStats(levelTotals) {
    var data     = load();
    levelTotals  = levelTotals || {};

    return {
      totalCompleted:       data.totalCompleted || 0,
      currentStreak:        (data.streak && data.streak.current)  || 0,
      longestStreak:        (data.streak && data.streak.longest)  || 0,
      beginnerProgress:     getProgress('beginner',     levelTotals.beginner),
      intermediateProgress: getProgress('intermediate', levelTotals.intermediate),
      advancedProgress:     getProgress('advanced',     levelTotals.advanced)
    };
  }

  // ─────────────────────────────────────────────
  // 调试工具
  // ─────────────────────────────────────────────

  /**
   * 清除所有进度数据（调试用）
   */
  function reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      console.info('[ProgressStore] 进度已重置');
      _dispatchEvent('progressReset', {});
    } catch (e) {
      console.error('[ProgressStore] reset 失败:', e.message);
    }
  }

  /**
   * 导出数据（调试用）
   * @returns {string} JSON 字符串
   */
  function exportData() {
    return JSON.stringify(load(), null, 2);
  }

  /**
   * 导入数据（调试/迁移用）
   * @param {string|object} dataOrJson
   * @returns {boolean}
   */
  function importData(dataOrJson) {
    try {
      var data = typeof dataOrJson === 'string' ? JSON.parse(dataOrJson) : dataOrJson;
      data     = _migrate(data);
      return save(data);
    } catch (e) {
      console.error('[ProgressStore] importData 失败:', e.message);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // 工具函数
  // ─────────────────────────────────────────────

  function _todayString() {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  }

  function _yesterdayString() {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  function _dispatchEvent(name, detail) {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      try {
        window.dispatchEvent(new CustomEvent('progressStore:' + name, { detail: detail }));
      } catch (_) {}
    }
  }

  // ─────────────────────────────────────────────
  // 公开接口
  // ─────────────────────────────────────────────

  var ProgressStore = {
    STORAGE_KEY:   STORAGE_KEY,
    VERSION:       VERSION,
    defaultData:   defaultData,
    load:          load,
    save:          save,
    markCompleted: markCompleted,
    isCompleted:   isCompleted,
    getProgress:   getProgress,
    getLessonRecord: getLessonRecord,
    updateStreak:  updateStreak,
    getStats:      getStats,
    reset:         reset,
    exportData:    exportData,
    importData:    importData
  };

  return ProgressStore;
})();

// 挂载到全局
if (typeof window !== 'undefined') {
  window.ProgressStore = ProgressStore;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProgressStore;
}

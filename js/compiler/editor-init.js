/**
 * Monaco Editor 初始化和管理模块
 * 负责编辑器实例的创建、只读展示块和可运行编辑器的初始化。
 *
 * 依赖：
 *   - window.WandboxCompiler（从 wandbox.js 注入）
 *   - window.Judge0Compiler（可选备用，从 judge0.js 注入）
 *   - Monaco Editor CDN
 */

var EditorManager = (function () {
  'use strict';

  var MONACO_VERSION = '0.44.0';
  var MONACO_CDN     = 'https://cdn.jsdelivr.net/npm/monaco-editor@' + MONACO_VERSION + '/min/vs';

  /** containerId -> Monaco editor 实例 */
  var instances = new Map();

  /** Monaco 加载 Promise，防止重复加载 */
  var _monacoLoadPromise = null;

  // ─────────────────────────────────────────────
  // 公共 API
  // ─────────────────────────────────────────────

  /**
   * 全局加载 Monaco Editor（幂等，只加载一次）
   * @returns {Promise<void>}
   */
  function loadMonaco() {
    if (_monacoLoadPromise) return _monacoLoadPromise;

    _monacoLoadPromise = new Promise(function (resolve, reject) {
      // 已经加载完毕
      if (window.monaco) { resolve(); return; }

      var script = document.createElement('script');
      script.src = MONACO_CDN + '/loader.js';
      script.async = true;

      script.onerror = function () {
        _monacoLoadPromise = null; // 允许重试
        reject(new Error('Monaco loader.js 加载失败，请检查网络连接'));
      };

      script.onload = function () {
        try {
          window.require.config({ paths: { vs: MONACO_CDN } });
          window.require(['vs/editor/editor.main'], function () {
            // 注册 C++ 代码片段（可选增强）
            _registerCppSnippets();
            resolve();
          });
        } catch (e) {
          reject(e);
        }
      };

      document.head.appendChild(script);
    });

    return _monacoLoadPromise;
  }

  /**
   * 初始化一个编辑器实例
   *
   * @param {string} containerId  - 容器元素 ID（不含 #）
   * @param {object} [options]    - 选项
   * @param {string}  [options.value='']          - 初始代码
   * @param {string}  [options.language='cpp']    - 语言
   * @param {string}  [options.theme='vs-dark']   - 主题
   * @param {number}  [options.fontSize=14]       - 字号
   * @param {boolean} [options.readOnly=false]    - 是否只读
   * @param {boolean} [options.minimap=false]     - 是否显示 minimap
   * @param {string}  [options.lineNumbers='on']  - 行号显示
   *
   * @returns {Promise<monaco.editor.IStandaloneCodeEditor>}
   */
  async function init(containerId, options) {
    options = options || {};

    var container = _getContainer(containerId);
    if (!container) {
      throw new Error('找不到容器元素: #' + containerId);
    }

    await loadMonaco();

    // 若该容器已有实例，先销毁
    if (instances.has(containerId)) {
      instances.get(containerId).dispose();
      instances.delete(containerId);
    }

    var editorOptions = {
      value:          options.value       !== undefined ? options.value       : '',
      language:       options.language    || 'cpp',
      theme:          options.theme       || 'vs-dark',
      fontSize:       options.fontSize    || 14,
      readOnly:       options.readOnly    || false,
      minimap:        { enabled: options.minimap !== undefined ? options.minimap : false },
      lineNumbers:    options.lineNumbers || 'on',
      scrollBeyondLastLine: false,
      automaticLayout:      true,          // 自动适应容器大小
      tabSize:              4,
      insertSpaces:         true,
      wordWrap:             'off',
      folding:              true,
      renderLineHighlight:  'line',
      cursorBlinking:       'smooth',
      smoothScrolling:      true
    };

    var editor = window.monaco.editor.create(container, editorOptions);
    instances.set(containerId, editor);
    return editor;
  }

  /**
   * 初始化只读的代码展示块（用于课程页的代码示例）
   *
   * @param {string} containerId
   * @param {string} code
   * @param {string} [language='cpp']
   * @returns {Promise<monaco.editor.IStandaloneCodeEditor>}
   */
  async function initReadOnly(containerId, code, language) {
    language = language || 'cpp';

    var container = _getContainer(containerId);
    if (!container) throw new Error('找不到容器元素: #' + containerId);

    // 根据代码行数动态设置高度（最小 80px，最大 600px）
    var lines   = (code || '').split('\n').length;
    var height  = Math.min(Math.max(lines * 20 + 20, 80), 600);
    container.style.height = height + 'px';

    var editor = await init(containerId, {
      value:       code || '',
      language:    language,
      theme:       'vs-dark',
      fontSize:    13,
      readOnly:    true,
      minimap:     false,
      lineNumbers: 'on'
    });

    // 只读样式标记
    container.setAttribute('data-readonly', 'true');
    return editor;
  }

  /**
   * 初始化可运行的嵌入式编辑器（用于课程页的练习区）
   *
   * 会在 containerId 容器内创建：
   *   1. 编辑区（.editor-pane）
   *   2. 工具栏（运行按钮 + 编译器选择）
   *   3. 输出区（.output-pane）
   *
   * @param {string}   containerId    - 外层包装容器 ID
   * @param {string}   initialCode    - 初始代码
   * @param {function} [onRun]        - 运行回调，参数 (result, editorInstance)
   * @returns {Promise<{editor, run}>}
   */
  async function initRunnable(containerId, initialCode, onRun) {
    var wrapper = _getContainer(containerId);
    if (!wrapper) throw new Error('找不到容器元素: #' + containerId);

    // 构建 DOM 结构
    wrapper.classList.add('runnable-editor-wrapper');
    wrapper.innerHTML = _buildRunnableHTML(containerId);

    var editorPaneId  = containerId + '-editor-pane';
    var outputPaneId  = containerId + '-output';
    var runBtnId      = containerId + '-run-btn';
    var compSelectId  = containerId + '-compiler-select';

    // 创建编辑器
    var editor = await init(editorPaneId, {
      value:    initialCode || '',
      language: 'cpp',
      theme:    'vs-dark',
      fontSize: 14,
      minimap:  false
    });

    // 绑定运行按钮
    var runBtn    = document.getElementById(runBtnId);
    var compSel   = document.getElementById(compSelectId);
    var outputEl  = document.getElementById(outputPaneId);

    if (runBtn) {
      runBtn.addEventListener('click', async function () {
        var code        = editor.getValue();
        var compilerKey = compSel ? compSel.value : 'gcc-cpp17';

        _setRunState(runBtn, outputEl, true);

        var result = await _runCode(code, compilerKey);

        _setRunState(runBtn, outputEl, false);
        _renderOutput(outputEl, result);

        if (typeof onRun === 'function') {
          onRun(result, editor);
        }
      });
    }

    // 暴露 run() 方法供外部调用
    function run(compilerKey) {
      if (runBtn) runBtn.click();
    }

    return { editor: editor, run: run };
  }

  /**
   * 获取一个已创建的编辑器实例
   * @param {string} containerId
   * @returns {monaco.editor.IStandaloneCodeEditor|null}
   */
  function getInstance(containerId) {
    return instances.get(containerId) || null;
  }

  /**
   * 销毁一个编辑器实例并释放资源
   * @param {string} containerId
   */
  function dispose(containerId) {
    if (instances.has(containerId)) {
      instances.get(containerId).dispose();
      instances.delete(containerId);
    }
  }

  /**
   * 销毁所有实例（页面卸载时调用）
   */
  function disposeAll() {
    instances.forEach(function (editor) { editor.dispose(); });
    instances.clear();
  }

  // ─────────────────────────────────────────────
  // 内部工具函数
  // ─────────────────────────────────────────────

  function _getContainer(containerId) {
    if (!containerId) return null;
    return document.getElementById(containerId) || document.querySelector(containerId);
  }

  /**
   * 执行编译请求（优先 Wandbox，失败时回退 Judge0）
   * @private
   */
  async function _runCode(code, compilerKey) {
    // 尝试 Wandbox
    if (window.WandboxCompiler) {
      try {
        var r = await window.WandboxCompiler.compile({ code: code, compilerKey: compilerKey });
        if (!r.error) return r;
        console.warn('[EditorManager] Wandbox 失败，尝试 Judge0:', r.error);
      } catch (e) {
        console.warn('[EditorManager] Wandbox 异常，尝试 Judge0:', e.message);
      }
    }

    // 回退到 Judge0
    if (window.Judge0Compiler) {
      // 将 gcc-cpp17 等映射到 Judge0 languageKey
      var langMap = {
        'gcc-cpp11':   'cpp11',
        'gcc-cpp14':   'cpp14',
        'gcc-cpp17':   'cpp17',
        'gcc-cpp20':   'cpp20',
        'clang-cpp11': 'cpp11',
        'clang-cpp14': 'cpp14',
        'clang-cpp17': 'cpp17',
        'clang-cpp20': 'cpp20'
      };
      var langKey = langMap[compilerKey] || 'cpp17';
      try {
        return await window.Judge0Compiler.compile({ code: code, languageKey: langKey });
      } catch (e) {
        return {
          success: false, stdout: '', stderr: '', compilerMsg: '',
          status: '', exitCode: null, signal: null,
          error: 'Judge0 异常: ' + e.message
        };
      }
    }

    return {
      success: false, stdout: '', stderr: '', compilerMsg: '',
      status: '', exitCode: null, signal: null,
      error: '未找到可用的编译器（请引入 wandbox.js 或 judge0.js）'
    };
  }

  /**
   * 构建可运行编辑器的 HTML 骨架
   * @private
   */
  function _buildRunnableHTML(containerId) {
    var editorPaneId  = containerId + '-editor-pane';
    var outputPaneId  = containerId + '-output';
    var runBtnId      = containerId + '-run-btn';
    var compSelectId  = containerId + '-compiler-select';

    return '<div class="editor-toolbar">' +
             '<select id="' + compSelectId + '" class="compiler-select" title="选择编译器">' +
               '<option value="gcc-cpp17">GCC C++17</option>' +
               '<option value="gcc-cpp20">GCC C++20</option>' +
               '<option value="gcc-cpp14">GCC C++14</option>' +
               '<option value="gcc-cpp11">GCC C++11</option>' +
               '<option value="clang-cpp17">Clang C++17</option>' +
             '</select>' +
             '<button id="' + runBtnId + '" class="run-btn" title="运行代码 (Ctrl+Enter)">' +
               '<span class="run-icon">&#9654;</span> 运行' +
             '</button>' +
           '</div>' +
           '<div id="' + editorPaneId + '" class="editor-pane" style="height:300px;"></div>' +
           '<div id="' + outputPaneId + '" class="output-pane" aria-label="程序输出">' +
             '<span class="output-placeholder">点击"运行"执行代码...</span>' +
           '</div>';
  }

  /**
   * 设置运行中 / 运行结束状态
   * @private
   */
  function _setRunState(runBtn, outputEl, running) {
    if (runBtn) {
      runBtn.disabled    = running;
      runBtn.textContent = running ? '⏳ 编译中...' : '▶ 运行';
    }
    if (outputEl && running) {
      outputEl.innerHTML = '<span class="output-running">正在编译运行...</span>';
    }
  }

  /**
   * 将编译结果渲染到输出区
   * @private
   */
  function _renderOutput(outputEl, result) {
    if (!outputEl) return;

    var html = '';

    if (result.error) {
      html = '<div class="output-error"><b>错误:</b> ' + _escHtml(result.error) + '</div>';
    } else {
      // 编译器输出（警告/错误）
      if (result.compilerMsg && result.compilerMsg.trim()) {
        var cls = result.success ? 'output-compiler-warning' : 'output-compiler-error';
        html += '<div class="' + cls + '"><b>编译信息:</b><pre>' + _escHtml(result.compilerMsg.trim()) + '</pre></div>';
      }

      // 程序输出
      if (result.stdout) {
        html += '<div class="output-stdout"><pre>' + _escHtml(result.stdout) + '</pre></div>';
      }

      // 运行时错误
      if (result.stderr && result.stderr.trim()) {
        html += '<div class="output-stderr"><b>stderr:</b><pre>' + _escHtml(result.stderr.trim()) + '</pre></div>';
      }

      // 退出状态
      var statusClass = result.success ? 'output-status-ok' : 'output-status-fail';
      var exitInfo    = result.exitCode !== null ? '退出码: ' + result.exitCode : '';
      if (result.signal) exitInfo += (exitInfo ? ' | ' : '') + '信号: ' + result.signal;
      if (exitInfo) {
        html += '<div class="' + statusClass + ' output-status-line">' + _escHtml(exitInfo) + '</div>';
      }

      if (!html) {
        html = '<span class="output-empty">（无输出）</span>';
      }
    }

    outputEl.innerHTML = html;
  }

  function _escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 注册 C++ 代码片段（可选增强）
   * @private
   */
  function _registerCppSnippets() {
    if (!window.monaco || !window.monaco.languages) return;

    window.monaco.languages.registerCompletionItemProvider('cpp', {
      provideCompletionItems: function (model, position) {
        var word  = model.getWordUntilPosition(position);
        var range = {
          startLineNumber: position.lineNumber,
          endLineNumber:   position.lineNumber,
          startColumn:     word.startColumn,
          endColumn:       word.endColumn
        };

        var snippets = [
          {
            label:            'main',
            kind:             window.monaco.languages.CompletionItemKind.Snippet,
            documentation:    'C++ main 函数',
            insertText:       '#include <iostream>\nusing namespace std;\n\nint main() {\n\t${1:// 代码}\n\treturn 0;\n}',
            insertTextRules:  window.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range:            range
          },
          {
            label:            'cout',
            kind:             window.monaco.languages.CompletionItemKind.Snippet,
            documentation:    'std::cout 输出',
            insertText:       'cout << ${1:value} << endl;',
            insertTextRules:  window.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range:            range
          },
          {
            label:            'for',
            kind:             window.monaco.languages.CompletionItemKind.Snippet,
            documentation:    'for 循环',
            insertText:       'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t${3:// 循环体}\n}',
            insertTextRules:  window.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range:            range
          },
          {
            label:            'class',
            kind:             window.monaco.languages.CompletionItemKind.Snippet,
            documentation:    '类定义',
            insertText:       'class ${1:ClassName} {\npublic:\n\t${2:// 成员}\n};',
            insertTextRules:  window.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range:            range
          }
        ];

        return { suggestions: snippets };
      }
    });
  }

  // ─────────────────────────────────────────────
  // 公开接口
  // ─────────────────────────────────────────────

  var EditorManager = {
    instances:    instances,
    loadMonaco:   loadMonaco,
    init:         init,
    initReadOnly: initReadOnly,
    initRunnable: initRunnable,
    getInstance:  getInstance,
    dispose:      dispose,
    disposeAll:   disposeAll,
    // 暴露版本信息
    MONACO_VERSION: MONACO_VERSION
  };

  return EditorManager;
})();

// 挂载到全局
if (typeof window !== 'undefined') {
  window.EditorManager = EditorManager;

  // 页面卸载时自动清理
  window.addEventListener('unload', function () {
    EditorManager.disposeAll();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EditorManager;
}

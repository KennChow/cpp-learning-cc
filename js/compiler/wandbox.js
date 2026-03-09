/**
 * Wandbox API 封装
 * API: POST https://wandbox.org/api/compile.json
 * 文档: https://github.com/melpon/wandbox/blob/master/kennel2/API.rst
 */

var WandboxCompiler = (function () {
  'use strict';

  // 编译器列表缓存
  var _compilersCache = null;
  var _cacheTimestamp = 0;
  var CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

  var BASE_URL = 'https://wandbox.org/api/compile.json';
  var LIST_URL = 'https://wandbox.org/api/list.json';

  /**
   * 编译器预设映射
   * key: 用于外部传入的逻辑名称
   * compiler: Wandbox 实际编译器名
   * options: 编译选项字符串
   */
  var COMPILERS = {
    'gcc-cpp11': {
      compiler: 'gcc-head',
      options: '-std=c++11 -O2 -Wall -Wextra'
    },
    'gcc-cpp14': {
      compiler: 'gcc-head',
      options: '-std=c++14 -O2 -Wall -Wextra'
    },
    'gcc-cpp17': {
      compiler: 'gcc-head',
      options: '-std=c++17 -O2 -Wall -Wextra'
    },
    'gcc-cpp20': {
      compiler: 'gcc-head',
      options: '-std=c++20 -O2 -Wall -Wextra'
    },
    'gcc-cpp23': {
      compiler: 'gcc-head',
      options: '-std=c++23 -O2 -Wall -Wextra'
    },
    'clang-cpp11': {
      compiler: 'clang-head',
      options: '-std=c++11 -O2 -Wall -Wextra'
    },
    'clang-cpp14': {
      compiler: 'clang-head',
      options: '-std=c++14 -O2 -Wall -Wextra'
    },
    'clang-cpp17': {
      compiler: 'clang-head',
      options: '-std=c++17 -O2 -Wall -Wextra'
    },
    'clang-cpp20': {
      compiler: 'clang-head',
      options: '-std=c++20 -O2 -Wall -Wextra'
    }
  };

  /**
   * 编译 C++ 代码
   *
   * @param {object} params
   * @param {string} params.code         - 源代码
   * @param {string} [params.compilerKey='gcc-cpp17'] - 编译器预设键名
   * @param {string} [params.stdin='']   - 标准输入
   * @param {number} [params.timeoutMs=15000] - 超时毫秒数
   *
   * @returns {Promise<{
   *   success: boolean,
   *   stdout: string,
   *   stderr: string,
   *   compilerMsg: string,
   *   status: string,
   *   exitCode: number|null,
   *   signal: string|null,
   *   error: string|null
   * }>}
   */
  async function compile({ code, compilerKey = 'gcc-cpp17', stdin = '', timeoutMs = 15000 }) {
    // 参数校验
    if (typeof code !== 'string' || code.trim() === '') {
      return _errorResult('代码不能为空');
    }

    var preset = COMPILERS[compilerKey];
    if (!preset) {
      return _errorResult('未知的编译器预设: ' + compilerKey + '，可用值: ' + Object.keys(COMPILERS).join(', '));
    }

    var body = JSON.stringify({
      compiler: preset.compiler,
      code: code,
      options: preset.options,
      stdin: stdin || '',
      'compiler-option-raw': '',
      save: false
    });

    var controller = new AbortController();
    var timerId = null;

    // 兼容旧版浏览器的超时：手动 abort
    var timeoutPromise = new Promise(function (_, reject) {
      timerId = setTimeout(function () {
        controller.abort();
        reject(new Error('编译超时（超过 ' + timeoutMs + ' ms）'));
      }, timeoutMs);
    });

    try {
      var fetchPromise = fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: body,
        signal: controller.signal
      });

      var response = await Promise.race([fetchPromise, timeoutPromise]);
      clearTimeout(timerId);

      if (!response.ok) {
        var errText = '';
        try { errText = await response.text(); } catch (_) {}
        return _errorResult(
          'Wandbox 服务器返回错误: HTTP ' + response.status + ' ' + response.statusText +
          (errText ? ' — ' + errText.slice(0, 200) : '')
        );
      }

      var data = await response.json();

      /*
       * Wandbox 返回字段说明：
       *   status         — 退出状态码（字符串）
       *   compiler_output — 编译器输出（包含警告/错误）
       *   compiler_error  — 编译错误（部分版本）
       *   program_output  — 程序 stdout
       *   program_error   — 程序 stderr
       *   signal          — 因信号终止时的信号名
       */
      var compilerOutput = (data.compiler_output || '') + (data.compiler_error || '');
      var programStdout  = data.program_output || '';
      var programStderr  = data.program_error  || '';
      var exitCodeRaw    = data.status;
      var exitCode       = (exitCodeRaw !== undefined && exitCodeRaw !== null)
                            ? parseInt(exitCodeRaw, 10)
                            : null;
      var signalName     = data.signal || null;

      // 编译失败：exitCode 非零且有编译器输出、无程序输出
      var compileFailed  = (exitCode !== 0) && (compilerOutput.trim() !== '') && (programStdout === '') && (programStderr === '');
      var success        = exitCode === 0;

      return {
        success:     success,
        stdout:      programStdout,
        stderr:      programStderr,
        compilerMsg: compilerOutput,
        status:      exitCodeRaw !== undefined ? String(exitCodeRaw) : '',
        exitCode:    exitCode,
        signal:      signalName,
        error:       null
      };

    } catch (err) {
      clearTimeout(timerId);

      if (err.name === 'AbortError') {
        return _errorResult('编译请求被中止（超时）');
      }
      // 网络错误
      return _errorResult('网络错误: ' + (err.message || String(err)));
    }
  }

  /**
   * 列出 Wandbox 可用编译器（带 5 分钟内存缓存）
   *
   * @returns {Promise<Array<object>>}  Wandbox 返回的编译器对象列表
   */
  async function listCompilers() {
    var now = Date.now();
    if (_compilersCache && (now - _cacheTimestamp) < CACHE_TTL_MS) {
      return _compilersCache;
    }

    try {
      var response = await fetch(LIST_URL, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      var data = await response.json();
      _compilersCache  = data;
      _cacheTimestamp  = now;
      return data;
    } catch (err) {
      console.warn('[WandboxCompiler] listCompilers 失败:', err.message);
      // 返回缓存（哪怕已过期），或空数组
      return _compilersCache || [];
    }
  }

  /**
   * 清除编译器列表缓存（调试用）
   */
  function clearCache() {
    _compilersCache  = null;
    _cacheTimestamp  = 0;
  }

  /**
   * 获取本模块内置的编译器预设列表
   * @returns {Array<{key: string, compiler: string, options: string}>}
   */
  function getPresets() {
    return Object.keys(COMPILERS).map(function (key) {
      return { key: key, compiler: COMPILERS[key].compiler, options: COMPILERS[key].options };
    });
  }

  // 内部工具：构造统一错误返回值
  function _errorResult(msg) {
    return {
      success:     false,
      stdout:      '',
      stderr:      '',
      compilerMsg: '',
      status:      '',
      exitCode:    null,
      signal:      null,
      error:       msg
    };
  }

  // 公开接口
  var WandboxCompiler = {
    BASE_URL:     BASE_URL,
    COMPILERS:    COMPILERS,
    compile:      compile,
    listCompilers: listCompilers,
    clearCache:   clearCache,
    getPresets:   getPresets
  };

  return WandboxCompiler;
})();

// 挂载到全局，便于 <script src="..."> 直接引用
if (typeof window !== 'undefined') {
  window.WandboxCompiler = WandboxCompiler;
}

// 同时支持 CommonJS / ES 模块环境（可选）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WandboxCompiler;
}

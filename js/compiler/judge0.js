/**
 * Judge0 CE 公共实例封装（备用编译器）
 * 无需 API Key，使用 https://ce.judge0.com
 * 文档: https://ce.judge0.com/
 */

var Judge0Compiler = (function () {
  'use strict';

  var BASE_URL = 'https://ce.judge0.com';

  /**
   * Judge0 语言 ID 映射
   * 完整列表: GET https://ce.judge0.com/languages
   */
  var LANGUAGE_IDS = {
    'cpp11': 76,   // C++ (GCC 11.1.0) — 最接近 C++11 支持的版本
    'cpp14': 55,   // C++ (GCC 8.1.0)
    'cpp17': 54,   // C++ (GCC 9.2.0)
    'cpp20': 76,   // C++ (GCC 11.1.0) — C++20 部分支持
    'c':     50,   // C (GCC 9.2.0)
    'c11':   48    // C (GCC 8.1.0)
  };

  // 轮询配置
  var POLL_MAX_ATTEMPTS = 20;
  var POLL_INTERVAL_MS  = 1000;

  /**
   * Judge0 状态码
   * https://ce.judge0.com/statuses
   */
  var STATUS = {
    1:  'In Queue',
    2:  'Processing',
    3:  'Accepted',          // 正常结束
    4:  'Wrong Answer',
    5:  'Time Limit Exceeded',
    6:  'Compilation Error',
    7:  'Runtime Error (SIGSEGV)',
    8:  'Runtime Error (SIGXFSZ)',
    9:  'Runtime Error (SIGFPE)',
    10: 'Runtime Error (SIGABRT)',
    11: 'Runtime Error (NZEC)',
    12: 'Runtime Error (Other)',
    13: 'Internal Error',
    14: 'Exec Format Error'
  };

  /**
   * 编译并运行代码
   *
   * @param {object} params
   * @param {string} params.code           - 源代码
   * @param {string} [params.languageKey='cpp17'] - 语言键名
   * @param {string} [params.stdin='']     - 标准输入
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
  async function compile({ code, languageKey = 'cpp17', stdin = '' }) {
    if (typeof code !== 'string' || code.trim() === '') {
      return _errorResult('代码不能为空');
    }

    var langId = LANGUAGE_IDS[languageKey];
    if (!langId) {
      return _errorResult('未知的语言键: ' + languageKey + '，可用值: ' + Object.keys(LANGUAGE_IDS).join(', '));
    }

    // Step 1: 提交作业（Base64 编码）
    var token;
    try {
      token = await _submit(langId, code, stdin);
    } catch (err) {
      return _errorResult('提交失败: ' + err.message);
    }

    // Step 2: 轮询结果
    var result;
    try {
      result = await _poll(token);
    } catch (err) {
      return _errorResult('轮询失败: ' + err.message);
    }

    return _parseResult(result);
  }

  /**
   * 提交代码到 Judge0，返回 token
   * @private
   */
  async function _submit(languageId, code, stdin) {
    var body = JSON.stringify({
      source_code: _base64Encode(code),
      language_id: languageId,
      stdin:        _base64Encode(stdin || ''),
      // 关闭额外的沙箱限制，提高兼容性
      redirect_stderr_to_stdout: false
    });

    var response = await fetch(BASE_URL + '/submissions?base64_encoded=true&wait=false', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':        'application/json'
      },
      body: body
    });

    if (!response.ok) {
      var errText = '';
      try { errText = await response.text(); } catch (_) {}
      throw new Error('HTTP ' + response.status + (errText ? ': ' + errText.slice(0, 200) : ''));
    }

    var data = await response.json();
    if (!data.token) {
      throw new Error('Judge0 未返回 token，响应: ' + JSON.stringify(data));
    }
    return data.token;
  }

  /**
   * 轮询 Judge0，直到任务完成或超过最大次数
   * @private
   */
  async function _poll(token) {
    for (var attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await _delay(POLL_INTERVAL_MS);

      var response = await fetch(
        BASE_URL + '/submissions/' + token + '?base64_encoded=true&fields=status_id,status,stdout,stderr,compile_output,exit_code,time,memory,message',
        {
          method:  'GET',
          headers: { 'Accept': 'application/json' }
        }
      );

      if (!response.ok) {
        throw new Error('轮询 HTTP ' + response.status);
      }

      var data = await response.json();
      var statusId = data.status && data.status.id ? data.status.id : (data.status_id || 0);

      // 状态 1 (In Queue) 和 2 (Processing) 表示尚未完成
      if (statusId !== 1 && statusId !== 2) {
        return data;
      }
    }

    throw new Error('轮询超时：已等待 ' + (POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS / 1000) + ' 秒');
  }

  /**
   * 将 Judge0 原始结果解析为统一格式
   * @private
   */
  function _parseResult(data) {
    var statusId  = data.status && data.status.id ? data.status.id : (data.status_id || 0);
    var statusMsg = data.status && data.status.description
                      ? data.status.description
                      : (STATUS[statusId] || '未知状态');

    var stdout      = _safeBase64Decode(data.stdout);
    var stderr      = _safeBase64Decode(data.stderr);
    var compileOut  = _safeBase64Decode(data.compile_output);
    var exitCode    = (data.exit_code !== undefined && data.exit_code !== null)
                        ? parseInt(data.exit_code, 10)
                        : null;

    // 状态 3 = Accepted（正常结束）
    var success = statusId === 3;

    // 编译错误时将编译输出放入 compilerMsg，运行时错误放入 stderr
    var compilerMsg = compileOut || '';
    if (!stderr && statusId >= 7 && statusId <= 12) {
      stderr = '运行时错误: ' + statusMsg;
    }

    return {
      success:     success,
      stdout:      stdout,
      stderr:      stderr,
      compilerMsg: compilerMsg,
      status:      statusMsg,
      exitCode:    exitCode,
      signal:      null,  // Judge0 不直接返回信号名
      error:       null
    };
  }

  /**
   * Base64 编码（浏览器环境）
   * 支持 Unicode 字符
   */
  function _base64Encode(str) {
    if (typeof str !== 'string') return '';
    try {
      // 先用 encodeURIComponent 处理 Unicode，再 atob
      return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1) {
        return String.fromCharCode(parseInt(p1, 16));
      }));
    } catch (e) {
      // 降级：直接 btoa（仅 ASCII）
      try { return btoa(str); } catch (_) { return ''; }
    }
  }

  /**
   * Base64 解码（浏览器环境）
   * 支持 Unicode 字符
   */
  function _base64Decode(str) {
    if (!str) return '';
    try {
      return decodeURIComponent(
        atob(str).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join('')
      );
    } catch (e) {
      // 降级：直接 atob
      try { return atob(str); } catch (_) { return ''; }
    }
  }

  /**
   * 安全解码：null/undefined 时返回空字符串
   * @private
   */
  function _safeBase64Decode(val) {
    if (!val) return '';
    return _base64Decode(val);
  }

  /**
   * 延迟工具
   * @param {number} ms
   */
  function _delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * 内部：构造统一错误返回值
   * @private
   */
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

  /**
   * 查询 Judge0 支持的全部语言列表（调试用）
   * @returns {Promise<Array>}
   */
  async function listLanguages() {
    try {
      var response = await fetch(BASE_URL + '/languages', {
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (err) {
      console.warn('[Judge0Compiler] listLanguages 失败:', err.message);
      return [];
    }
  }

  // 公开接口
  var Judge0Compiler = {
    BASE_URL:      BASE_URL,
    LANGUAGE_IDS:  LANGUAGE_IDS,
    STATUS:        STATUS,
    compile:       compile,
    listLanguages: listLanguages,
    // 暴露工具函数，便于外部测试
    _base64Encode: _base64Encode,
    _base64Decode: _base64Decode,
    _delay:        _delay
  };

  return Judge0Compiler;
})();

// 挂载到全局
if (typeof window !== 'undefined') {
  window.Judge0Compiler = Judge0Compiler;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Judge0Compiler;
}

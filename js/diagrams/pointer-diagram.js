/**
 * 指针内存模型动态 SVG
 *
 * 使用纯 SVG + CSS 动画，不依赖任何第三方库。
 * 每个图的 viewBox 为 "0 0 600 300"，响应式。
 *
 * 颜色规范：
 *   栈区背景   #EBF8FF（淡蓝）
 *   堆区背景   #FFFAF0（淡橙）
 *   变量格子   白色，#4A90D9 边框
 *   指针格子   #BEE3F8，#4A90D9 边框
 *   箭头       #3182CE，2px
 *   地址文字   #A0AEC0，9px，monospace
 *   变量名     #4A5568，13px
 */

var PointerDiagram = (function () {
  'use strict';

  // ─────────────────────────────────────────────
  // 样式常量
  // ─────────────────────────────────────────────
  var C = {
    STACK_BG:      '#EBF8FF',
    HEAP_BG:       '#FFFAF0',
    VAR_FILL:      '#FFFFFF',
    PTR_FILL:      '#BEE3F8',
    BORDER:        '#4A90D9',
    ARROW:         '#3182CE',
    ADDR_COLOR:    '#A0AEC0',
    ADDR_SIZE:     9,
    VAR_NAME_COLOR:'#4A5568',
    VAR_NAME_SIZE: 13,
    VAR_VAL_COLOR: '#2D3748',
    VAR_VAL_SIZE:  14,
    NULL_COLOR:    '#E53E3E',
    LABEL_COLOR:   '#2B6CB0',
    LABEL_SIZE:    11
  };

  // SVG 命名空间
  var NS = 'http://www.w3.org/2000/svg';

  // ─────────────────────────────────────────────
  // 工具函数
  // ─────────────────────────────────────────────

  function _getContainer(id) {
    return document.getElementById(id);
  }

  /**
   * 创建并注入 SVG
   */
  function _createSVG(width, height) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('xmlns', NS);
    svg.style.width  = '100%';
    svg.style.maxWidth = width + 'px';
    svg.style.display = 'block';
    return svg;
  }

  /**
   * 注入全局 CSS 动画（只注入一次）
   */
  function _ensureStyles() {
    if (document.getElementById('pointer-diagram-styles')) return;
    var style = document.createElement('style');
    style.id  = 'pointer-diagram-styles';
    style.textContent = [
      '@keyframes drawArrow {',
      '  from { stroke-dashoffset: 200; }',
      '  to   { stroke-dashoffset: 0;   }',
      '}',
      '@keyframes fadeIn {',
      '  from { opacity: 0; }',
      '  to   { opacity: 1; }',
      '}',
      '@keyframes blink {',
      '  0%,100% { opacity: 1; }',
      '  50%     { opacity: 0.3; }',
      '}',
      '.pd-arrow {',
      '  stroke-dasharray: 200;',
      '  stroke-dashoffset: 200;',
      '  animation: drawArrow 0.8s ease forwards;',
      '}',
      '.pd-arrow-delayed {',
      '  stroke-dasharray: 200;',
      '  stroke-dashoffset: 200;',
      '  animation: drawArrow 0.8s ease 0.4s forwards;',
      '}',
      '.pd-fadein {',
      '  opacity: 0;',
      '  animation: fadeIn 0.5s ease 0.2s forwards;',
      '}',
      '.pd-blink {',
      '  animation: blink 1.5s ease infinite;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  // SVG 元素生成器
  function _el(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs) {
      if (attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]);
    }
    return el;
  }

  function _rect(x, y, w, h, fill, stroke, rx) {
    return _el('rect', { x: x, y: y, width: w, height: h, fill: fill,
                          stroke: stroke || C.BORDER, 'stroke-width': 1.5,
                          rx: rx || 3 });
  }

  function _text(x, y, content, color, size, anchor, fontFamily, cssClass) {
    var t = _el('text', {
      x: x, y: y,
      fill: color || '#000',
      'font-size': size || 12,
      'text-anchor': anchor || 'middle',
      'dominant-baseline': 'central',
      'font-family': fontFamily || 'system-ui, sans-serif'
    });
    if (cssClass) t.setAttribute('class', cssClass);
    t.textContent = content;
    return t;
  }

  function _monoText(x, y, content, color, size, anchor) {
    return _text(x, y, content, color || C.ADDR_COLOR, size || C.ADDR_SIZE, anchor || 'middle', 'monospace, Courier New');
  }

  /**
   * defs + arrowhead marker
   */
  function _arrowMarker(svg, id, color) {
    var defs   = _el('defs');
    var marker = _el('marker', {
      id:           id,
      viewBox:      '0 0 10 10',
      refX:         9,
      refY:         5,
      markerWidth:  6,
      markerHeight: 6,
      orient:       'auto-start-reverse'
    });
    var path = _el('path', { d: 'M0,1 L10,5 L0,9 Z', fill: color || C.ARROW });
    marker.appendChild(path);
    defs.appendChild(marker);
    svg.appendChild(defs);
    return id;
  }

  /**
   * 带动画的直线箭头
   * sx,sy -> ex,ey
   */
  function _arrowLine(sx, sy, ex, ey, markerId, cssClass, delay) {
    var line = _el('line', {
      x1: sx, y1: sy, x2: ex, y2: ey,
      stroke:          C.ARROW,
      'stroke-width':  2,
      'marker-end':    'url(#' + markerId + ')'
    });
    line.setAttribute('class', cssClass || 'pd-arrow');
    if (delay) {
      line.style.animationDelay = delay;
    }
    return line;
  }

  /**
   * 弯曲箭头（用 path）
   */
  function _arrowPath(d, markerId, color, cssClass) {
    var p = _el('path', {
      d:              d,
      fill:           'none',
      stroke:         color || C.ARROW,
      'stroke-width': 2,
      'marker-end':   'url(#' + markerId + ')'
    });
    p.setAttribute('class', cssClass || 'pd-arrow');
    return p;
  }

  /**
   * 绘制一个内存格子组（rect + 值文字 + 变量名 + 地址）
   */
  function _memCell(svg, x, y, w, h, label, value, address, fill, labelBelow) {
    svg.appendChild(_rect(x, y, w, h, fill || C.VAR_FILL, C.BORDER));
    // 值
    svg.appendChild(_text(x + w / 2, y + h / 2, value,
                          C.VAR_VAL_COLOR, C.VAR_VAL_SIZE, 'middle', 'monospace, Courier New'));
    // 变量名（上方或左侧）
    if (label) {
      var ly = labelBelow ? (y + h + 14) : (y - 10);
      svg.appendChild(_text(x + w / 2, ly, label,
                            C.VAR_NAME_COLOR, C.VAR_NAME_SIZE, 'middle'));
    }
    // 地址（下方小字）
    if (address) {
      svg.appendChild(_monoText(x + w / 2, y + h + 11, address));
    }
  }

  /**
   * 区域背景标签
   */
  function _regionBg(svg, x, y, w, h, fill, label) {
    svg.appendChild(_rect(x, y, w, h, fill, '#BEE3F8', 6));
    if (label) {
      svg.appendChild(_text(x + w / 2, y + 14, label, C.LABEL_COLOR, C.LABEL_SIZE, 'middle'));
    }
  }

  // ─────────────────────────────────────────────
  // 1. 基本指针
  // ─────────────────────────────────────────────

  /**
   * renderBasic(containerId)
   * 演示：int x = 42;  int* p = &x;
   * 两个栈格子，蓝色箭头带动画
   */
  function renderBasic(containerId) {
    var container = _getContainer(containerId);
    if (!container) return;
    _ensureStyles();

    var svg = _createSVG(600, 300);
    var mid = _arrowMarker(svg, 'basic-arrow', C.ARROW);

    // 栈区背景
    _regionBg(svg, 30, 40, 540, 220, C.STACK_BG, '栈区 (Stack)');

    // x 变量格子：左侧
    var xX = 100, xY = 110, cW = 110, cH = 60;
    _memCell(svg, xX, xY, cW, cH, 'int x', '42', '0x7fff0010', C.VAR_FILL);

    // p 指针格子：右侧
    var pX = 370, pY = 110;
    _memCell(svg, pX, pY, cW, cH, 'int* p', '0x7fff0010', '0x7fff0018', C.PTR_FILL);

    // 箭头：从 p 格子左侧指向 x 格子右侧
    var arrowSX = pX,
        arrowSY = pY + cH / 2,
        arrowEX = xX + cW + 8,
        arrowEY = xY + cH / 2;
    svg.appendChild(_arrowLine(arrowSX, arrowSY, arrowEX, arrowEY, mid, 'pd-arrow'));

    // 代码注释
    svg.appendChild(_text(300, 240, 'p 存储了 x 的地址，*p 可读写 x 的值', C.LABEL_COLOR, 12, 'middle'));

    // 图例
    svg.appendChild(_rect(60, 260, 14, 10, C.PTR_FILL, C.BORDER, 2));
    svg.appendChild(_text(80, 265, '指针变量', C.VAR_NAME_COLOR, 10, 'start'));
    svg.appendChild(_rect(160, 260, 14, 10, C.VAR_FILL, C.BORDER, 2));
    svg.appendChild(_text(180, 265, '普通变量', C.VAR_NAME_COLOR, 10, 'start'));

    container.innerHTML = '';
    container.appendChild(svg);
  }

  // ─────────────────────────────────────────────
  // 2. 空指针
  // ─────────────────────────────────────────────

  /**
   * renderNull(containerId)
   * 演示：int* p = nullptr;
   */
  function renderNull(containerId) {
    var container = _getContainer(containerId);
    if (!container) return;
    _ensureStyles();

    var svg = _createSVG(600, 300);
    _arrowMarker(svg, 'null-arrow', C.NULL_COLOR);

    // 栈区
    _regionBg(svg, 30, 40, 280, 200, C.STACK_BG, '栈区 (Stack)');

    // p 格子
    var pX = 80, pY = 120, cW = 120, cH = 60;
    _memCell(svg, pX, pY, cW, cH, 'int* p', 'nullptr', '0x7fff0010', C.PTR_FILL);

    // 虚线箭头指向 NULL 框
    var arrowSX = pX + cW,
        arrowSY = pY + cH / 2;
    var nullX = 380, nullY = 120, nullW = 100, nullH = 60;

    var dashed = _el('line', {
      x1: arrowSX, y1: arrowSY, x2: nullX, y2: nullY + nullH / 2,
      stroke: C.NULL_COLOR, 'stroke-width': 2,
      'stroke-dasharray': '6,4',
      'marker-end': 'url(#null-arrow)'
    });
    dashed.setAttribute('class', 'pd-arrow');
    svg.appendChild(dashed);

    // NULL 符号框
    svg.appendChild(_rect(nullX, nullY, nullW, nullH, '#FFF5F5', C.NULL_COLOR, 6));
    var xLine1 = _el('line', { x1: nullX+20, y1: nullY+15, x2: nullX+80, y2: nullY+45,
                                stroke: C.NULL_COLOR, 'stroke-width': 3 });
    var xLine2 = _el('line', { x1: nullX+80, y1: nullY+15, x2: nullX+20, y2: nullY+45,
                                stroke: C.NULL_COLOR, 'stroke-width': 3 });
    xLine1.setAttribute('class', 'pd-fadein');
    xLine2.setAttribute('class', 'pd-fadein');
    svg.appendChild(xLine1);
    svg.appendChild(xLine2);
    svg.appendChild(_text(nullX + nullW/2, nullY + nullH + 16, 'NULL (0x0)', C.NULL_COLOR, 10, 'middle'));

    // 警告文字
    svg.appendChild(_text(300, 240, '解引用空指针会导致未定义行为（段错误）', C.NULL_COLOR, 12, 'middle'));

    container.innerHTML = '';
    container.appendChild(svg);
  }

  // ─────────────────────────────────────────────
  // 3. 指针算术
  // ─────────────────────────────────────────────

  /**
   * renderArithmetic(containerId)
   * 演示：int arr[4] = {10,20,30,40};  int* p = arr;  p+1 步进
   */
  function renderArithmetic(containerId) {
    var container = _getContainer(containerId);
    if (!container) return;
    _ensureStyles();

    var svg = _createSVG(600, 300);
    _arrowMarker(svg, 'arith-arrow',   C.ARROW);
    _arrowMarker(svg, 'arith-arrow2',  '#38A169');

    // 栈区
    _regionBg(svg, 20, 30, 560, 160, C.STACK_BG, '栈区 (Stack)');

    // 绘制数组 4 个格子
    var arr    = [10, 20, 30, 40];
    var cellW  = 80, cellH = 55;
    var startX = 60, startY = 80;
    var addrs  = ['0x1000', '0x1004', '0x1008', '0x100C'];

    for (var i = 0; i < arr.length; i++) {
      var cx = startX + i * cellW;
      _memCell(svg, cx, startY, cellW, cellH,
               'arr[' + i + ']', String(arr[i]), addrs[i], C.VAR_FILL);
    }

    // 数组名标签
    svg.appendChild(_text(startX + cellW * 2, startY - 18, 'int arr[4]', C.LABEL_COLOR, 12, 'middle'));

    // p 指向 arr[0]
    var pY = 210;
    svg.appendChild(_rect(startX + 12, pY, 56, 36, C.PTR_FILL, C.BORDER, 3));
    svg.appendChild(_text(startX + 40, pY + 18, 'p', C.VAR_VAL_COLOR, 13, 'middle'));

    // p -> arr[0]
    svg.appendChild(_arrowLine(
      startX + 40, pY,
      startX + 40, startY + cellH,
      'arith-arrow', 'pd-arrow'
    ));

    // p+1 虚线箭头指向 arr[1]
    var p1x = startX + cellW + 40;
    var arithArrow = _el('path', {
      d: 'M' + (startX+40) + ',' + (pY+18) + ' C' + (startX+40) + ',' + (pY+60) + ' ' + p1x + ',' + (pY+60) + ' ' + p1x + ',' + (startY+cellH),
      fill: 'none',
      stroke: '#38A169',
      'stroke-width': 2,
      'stroke-dasharray': '5,3',
      'marker-end': 'url(#arith-arrow2)'
    });
    arithArrow.setAttribute('class', 'pd-arrow-delayed');
    svg.appendChild(arithArrow);

    // 标注
    svg.appendChild(_text(startX + cellW * 0.5 + 10, pY + 60, 'p', C.ARROW, 10, 'middle'));
    svg.appendChild(_text(startX + cellW * 1.5 + 10, pY + 60, 'p+1', '#38A169', 10, 'middle'));

    // 说明
    svg.appendChild(_text(300, 270, 'p+1 跳过 sizeof(int)=4 字节，指向下一个元素', C.LABEL_COLOR, 11, 'middle'));

    container.innerHTML = '';
    container.appendChild(svg);
  }

  // ─────────────────────────────────────────────
  // 4. 堆内存
  // ─────────────────────────────────────────────

  /**
   * renderHeap(containerId)
   * 演示：new / delete 前后对比
   */
  function renderHeap(containerId) {
    var container = _getContainer(containerId);
    if (!container) return;
    _ensureStyles();

    var svg = _createSVG(600, 300);
    _arrowMarker(svg, 'heap-arrow',   C.ARROW);
    _arrowMarker(svg, 'heap-arrow2',  C.NULL_COLOR);

    // 左半：new 之后
    _regionBg(svg, 15, 25, 268, 120, C.STACK_BG, '栈区');
    _regionBg(svg, 15, 155, 268, 120, C.HEAP_BG,  '堆区 (Heap)');

    // 栈上的指针 p
    var pX = 50, pY = 60, cW = 100, cH = 50;
    _memCell(svg, pX, pY, cW, cH, 'int* p', '0x20001000', '0x7fff0010', C.PTR_FILL);

    // 堆上的 int
    var hX = 80, hY = 185;
    _memCell(svg, hX, hY, cW, cH, '*p (heap)', '99', '0x20001000', '#FEFCE8');

    // 箭头：p -> 堆上对象
    svg.appendChild(_arrowLine(pX + cW/2, pY + cH, pX + cW/2, hY, 'heap-arrow', 'pd-arrow'));

    // new 代码
    svg.appendChild(_text(145, 75, 'int* p = new int(99);', '#276749', 10, 'middle', 'monospace'));

    // 右半：delete 之后
    _regionBg(svg, 317, 25, 268, 120, C.STACK_BG, '栈区');
    _regionBg(svg, 317, 155, 268, 120, C.HEAP_BG,  '堆区');

    // p（delete 后值不变，但内存已释放）
    var p2X = 352, p2Y = 60;
    _memCell(svg, p2X, p2Y, cW, cH, 'int* p', '0x20001000', '0x7fff0010', C.PTR_FILL);

    // 堆区已释放标记
    var freeX = 382, freeY = 185;
    svg.appendChild(_rect(freeX, freeY, cW, cH, '#FFF5F5', C.NULL_COLOR, 3));
    svg.appendChild(_text(freeX + cW/2, freeY + cH/2, '(已释放)', C.NULL_COLOR, 12, 'middle'));
    svg.appendChild(_monoText(freeX + cW/2, freeY + cH + 11, '0x20001000'));

    // 悬空指针箭头（红色虚线）
    var dangle = _el('line', {
      x1: p2X + cW/2, y1: p2Y + cH,
      x2: freeX + cW/2, y2: freeY,
      stroke: C.NULL_COLOR, 'stroke-width': 2,
      'stroke-dasharray': '5,4',
      'marker-end': 'url(#heap-arrow2)'
    });
    dangle.setAttribute('class', 'pd-fadein pd-blink');
    svg.appendChild(dangle);

    // delete 代码
    svg.appendChild(_text(452, 75, 'delete p;  // p 成为悬空指针', C.NULL_COLOR, 10, 'middle', 'monospace'));

    // 建议
    svg.appendChild(_text(452, 260, 'delete 后应将 p = nullptr', '#276749', 11, 'middle'));

    // 分隔线
    svg.appendChild(_el('line', { x1: 300, y1: 20, x2: 300, y2: 285,
                                   stroke: '#CBD5E0', 'stroke-width': 1.5,
                                   'stroke-dasharray': '4,4' }));

    container.innerHTML = '';
    container.appendChild(svg);
  }

  // ─────────────────────────────────────────────
  // 公开接口
  // ─────────────────────────────────────────────

  return {
    renderBasic:       renderBasic,
    renderNull:        renderNull,
    renderArithmetic:  renderArithmetic,
    renderHeap:        renderHeap
  };
})();

// 挂载到全局
if (typeof window !== 'undefined') {
  window.PointerDiagram = PointerDiagram;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PointerDiagram;
}

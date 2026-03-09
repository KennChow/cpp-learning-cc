/**
 * 虚表（vtable）结构动态 SVG
 *
 * 使用纯 SVG + CSS 动画，不依赖第三方库。
 * 绘制：
 *   - 左侧：Base 对象（vptr + 数据成员）
 *   - 中间偏左：Base vtable
 *   - 中间偏右：Derived vtable
 *   - 右侧：Derived 对象（vptr + 额外数据成员）
 *   - 连线：vptr -> vtable、vtable 项 -> 函数地址
 *   - 动态分发路径高亮
 */

var VtableDiagram = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  // 颜色
  var C = {
    STACK_BG:   '#EBF8FF',
    VTBL_BG:    '#F0FFF4',
    DERIVED_BG: '#FFFBEB',
    BORDER:     '#4A90D9',
    GREEN:      '#276749',
    GREEN_LIGHT:'#C6F6D5',
    GREEN_BD:   '#38A169',
    ORANGE:     '#C05621',
    ORANGE_LIGHT:'#FEEBC8',
    ORANGE_BD:  '#DD6B20',
    PURPLE:     '#553C9A',
    PURPLE_LIGHT:'#E9D8FD',
    PURPLE_BD:  '#805AD5',
    ARROW:      '#3182CE',
    DISPATCH_ARROW: '#E53E3E',
    ADDR:       '#A0AEC0',
    LABEL:      '#2B6CB0',
    TEXT:       '#2D3748',
    MUTED:      '#718096'
  };

  // ─────────────────────────────────────────────
  // SVG 工具函数
  // ─────────────────────────────────────────────

  function _el(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs) {
      if (attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]);
    }
    return el;
  }

  function _rect(svg, x, y, w, h, fill, stroke, rx) {
    svg.appendChild(_el('rect', {
      x: x, y: y, width: w, height: h,
      fill: fill, stroke: stroke || C.BORDER,
      'stroke-width': 1.5, rx: rx || 3
    }));
  }

  function _text(svg, x, y, content, color, size, anchor, fontFamily, cssClass) {
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
    svg.appendChild(t);
    return t;
  }

  function _mono(svg, x, y, content, color, size, anchor) {
    _text(svg, x, y, content, color || C.ADDR, size || 9, anchor || 'middle',
          'monospace, Courier New');
  }

  function _arrowMarker(svg, id, color) {
    var defs   = svg.querySelector('defs') || _el('defs');
    if (!svg.querySelector('defs')) svg.insertBefore(defs, svg.firstChild);
    var marker = _el('marker', {
      id:           id,
      viewBox:      '0 0 10 10',
      refX:         9, refY: 5,
      markerWidth:  6, markerHeight: 6,
      orient:       'auto-start-reverse'
    });
    marker.appendChild(_el('path', { d: 'M0,1 L10,5 L0,9 Z', fill: color || C.ARROW }));
    defs.appendChild(marker);
  }

  function _line(svg, x1, y1, x2, y2, color, width, dash, markerId, cssClass) {
    var attrs = {
      x1: x1, y1: y1, x2: x2, y2: y2,
      stroke: color || C.ARROW,
      'stroke-width': width || 1.5
    };
    if (dash)     attrs['stroke-dasharray'] = dash;
    if (markerId) attrs['marker-end'] = 'url(#' + markerId + ')';
    var el = _el('line', attrs);
    if (cssClass) el.setAttribute('class', cssClass);
    svg.appendChild(el);
    return el;
  }

  function _path(svg, d, color, width, dash, markerId, cssClass) {
    var attrs = {
      d: d, fill: 'none',
      stroke: color || C.ARROW,
      'stroke-width': width || 1.5
    };
    if (dash)     attrs['stroke-dasharray'] = dash;
    if (markerId) attrs['marker-end'] = 'url(#' + markerId + ')';
    var el = _el('path', attrs);
    if (cssClass) el.setAttribute('class', cssClass);
    svg.appendChild(el);
    return el;
  }

  function _ensureStyles() {
    if (document.getElementById('vtable-diagram-styles')) return;
    var style    = document.createElement('style');
    style.id     = 'vtable-diagram-styles';
    style.textContent = [
      '@keyframes vt-drawLine {',
      '  from { stroke-dashoffset: 400; }',
      '  to   { stroke-dashoffset: 0; }',
      '}',
      '@keyframes vt-fadeIn {',
      '  from { opacity: 0; } to { opacity: 1; }',
      '}',
      '@keyframes vt-pulse {',
      '  0%,100% { stroke-width: 2.5; } 50% { stroke-width: 4; }',
      '}',
      '.vt-arrow {',
      '  stroke-dasharray: 400;',
      '  stroke-dashoffset: 400;',
      '  animation: vt-drawLine 0.7s ease forwards;',
      '}',
      '.vt-arrow-d1 { stroke-dasharray:400; stroke-dashoffset:400;',
      '  animation: vt-drawLine 0.7s ease 0.2s forwards; }',
      '.vt-arrow-d2 { stroke-dasharray:400; stroke-dashoffset:400;',
      '  animation: vt-drawLine 0.7s ease 0.4s forwards; }',
      '.vt-arrow-d3 { stroke-dasharray:400; stroke-dashoffset:400;',
      '  animation: vt-drawLine 0.7s ease 0.6s forwards; }',
      '.vt-arrow-d4 { stroke-dasharray:400; stroke-dashoffset:400;',
      '  animation: vt-drawLine 0.7s ease 0.8s forwards; }',
      '.vt-dispatch {',
      '  stroke-dasharray: 400; stroke-dashoffset: 400;',
      '  animation: vt-drawLine 0.9s ease 1s forwards, vt-pulse 1.5s ease 1.9s infinite;',
      '}',
      '.vt-fadein { opacity:0; animation: vt-fadeIn 0.4s ease 0.1s forwards; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────
  // 布局常量
  // ─────────────────────────────────────────────

  var L = {
    // 对象列宽
    OBJ_W:   110,
    ROW_H:   36,
    // vtable 列宽
    VT_W:    140,
    VT_ROW:  30,
    // X 坐标
    BASE_OBJ_X:  18,
    BASE_VT_X:   168,
    DRV_VT_X:    348,
    DRV_OBJ_X:   518,
    // Y 基准
    OBJ_Y:       80,
    VT_Y:        60
  };

  // ─────────────────────────────────────────────
  // 渲染核心
  // ─────────────────────────────────────────────

  /**
   * render(containerId)
   * 绘制完整的虚表结构图（viewBox 0 0 660 460）
   */
  function render(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    _ensureStyles();

    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 660 460');
    svg.setAttribute('xmlns', NS);
    svg.style.width    = '100%';
    svg.style.maxWidth = '660px';
    svg.style.display  = 'block';

    // defs
    _arrowMarker(svg, 'vt-blue',    C.ARROW);
    _arrowMarker(svg, 'vt-green',   C.GREEN_BD);
    _arrowMarker(svg, 'vt-orange',  C.ORANGE_BD);
    _arrowMarker(svg, 'vt-red',     C.DISPATCH_ARROW);
    _arrowMarker(svg, 'vt-purple',  C.PURPLE_BD);

    // ── Base 对象 ──────────────────────────────
    var bx = L.BASE_OBJ_X, by = L.OBJ_Y, ow = L.OBJ_W, rh = L.ROW_H;

    _rect(svg, bx, by - 20, ow, 20, C.LABEL, C.LABEL, 0);
    _text(svg, bx + ow/2, by - 10, 'Base 对象', '#fff', 11, 'middle');

    // vptr 行
    _rect(svg, bx, by, ow, rh, C.PURPLE_LIGHT, C.PURPLE_BD, 0);
    _text(svg, bx + ow/2, by + rh/2, 'vptr', C.PURPLE, 12, 'middle');

    // 数据成员
    _rect(svg, bx, by + rh, ow, rh, '#fff', C.BORDER, 0);
    _text(svg, bx + ow/2, by + rh + rh/2, 'int data = 10', C.TEXT, 11, 'middle');

    _rect(svg, bx, by + rh*2, ow, rh, '#fff', C.BORDER, 0);
    _text(svg, bx + ow/2, by + rh*2 + rh/2, '...', C.MUTED, 11, 'middle');

    // ── Base vtable ────────────────────────────
    var bvx = L.BASE_VT_X, bvy = L.VT_Y, vtw = L.VT_W, vtr = L.VT_ROW;

    _rect(svg, bvx, bvy - 20, vtw, 20, C.GREEN_BD, C.GREEN_BD, 0);
    _text(svg, bvx + vtw/2, bvy - 10, 'Base vtable', '#fff', 11, 'middle');

    var baseVtRows = [
      { label: 'type_info*',     color: '#E2E8F0', bc: C.MUTED },
      { label: '&Base::foo()',    color: C.GREEN_LIGHT, bc: C.GREEN_BD },
      { label: '&Base::bar()',    color: C.GREEN_LIGHT, bc: C.GREEN_BD },
      { label: '~Base() [dtor]',  color: '#E2E8F0', bc: C.MUTED }
    ];

    for (var i = 0; i < baseVtRows.length; i++) {
      var row = baseVtRows[i];
      _rect(svg, bvx, bvy + i*vtr, vtw, vtr, row.color, row.bc, 0);
      _text(svg, bvx + vtw/2, bvy + i*vtr + vtr/2, row.label, C.TEXT, 10.5, 'middle', 'monospace');
    }

    // ── Derived vtable ─────────────────────────
    var dvx = L.DRV_VT_X, dvy = L.VT_Y;

    _rect(svg, dvx, dvy - 20, vtw, 20, C.ORANGE_BD, C.ORANGE_BD, 0);
    _text(svg, dvx + vtw/2, dvy - 10, 'Derived vtable', '#fff', 11, 'middle');

    var drvVtRows = [
      { label: 'type_info*',          color: '#E2E8F0', bc: C.MUTED },
      { label: '&Derived::foo()',      color: C.ORANGE_LIGHT, bc: C.ORANGE_BD },
      { label: '&Base::bar()  [继承]', color: C.GREEN_LIGHT,  bc: C.GREEN_BD },
      { label: '~Derived() [dtor]',    color: '#E2E8F0', bc: C.MUTED }
    ];

    for (var j = 0; j < drvVtRows.length; j++) {
      var drow = drvVtRows[j];
      _rect(svg, dvx, dvy + j*vtr, vtw, vtr, drow.color, drow.bc, 0);
      _text(svg, dvx + vtw/2, dvy + j*vtr + vtr/2, drow.label, C.TEXT, 10.5, 'middle', 'monospace');
    }

    // ── Derived 对象 ───────────────────────────
    var dx = L.DRV_OBJ_X, dy = L.OBJ_Y;

    _rect(svg, dx, dy - 20, ow, 20, C.ORANGE_BD, C.ORANGE_BD, 0);
    _text(svg, dx + ow/2, dy - 10, 'Derived 对象', '#fff', 11, 'middle');

    _rect(svg, dx, dy, ow, rh, C.PURPLE_LIGHT, C.PURPLE_BD, 0);
    _text(svg, dx + ow/2, dy + rh/2, 'vptr', C.PURPLE, 12, 'middle');

    _rect(svg, dx, dy + rh, ow, rh, '#fff', C.BORDER, 0);
    _text(svg, dx + ow/2, dy + rh + rh/2, 'int data = 10', C.TEXT, 11, 'middle');

    _rect(svg, dx, dy + rh*2, ow, rh, '#fff', C.ORANGE_BD, 0);
    _text(svg, dx + ow/2, dy + rh*2 + rh/2, 'int extra = 20', C.TEXT, 11, 'middle');

    _rect(svg, dx, dy + rh*3, ow, rh, '#fff', C.BORDER, 0);
    _text(svg, dx + ow/2, dy + rh*3 + rh/2, '...', C.MUTED, 11, 'middle');

    // ── 连线：vptr -> vtable ───────────────────

    // Base::vptr -> Base vtable
    _path(svg,
      'M' + (bx + ow) + ',' + (by + rh/2) + ' L' + bvx + ',' + (bvy + vtr/2),
      C.PURPLE_BD, 2, null, 'vt-purple', 'vt-arrow');

    // Derived::vptr -> Derived vtable
    _path(svg,
      'M' + dx + ',' + (dy + rh/2) + ' L' + (dvx + vtw) + ',' + (dvy + vtr/2),
      C.PURPLE_BD, 2, null, 'vt-purple', 'vt-arrow-d1');

    // ── 虚函数地址指向（右侧函数文字标注）───────

    var fnX = 155, fnBaseY = 270;

    // Base vtable 中 foo -> Base::foo 实现
    _drawFuncRef(svg,
      bvx + vtw, bvy + vtr*1 + vtr/2,      // vtable 行终点
      fnX, fnBaseY,                          // 函数标注起点
      '0xffff_1000  Base::foo() { … }',
      C.GREEN_BD, 'vt-green', 'vt-arrow-d2'
    );

    // Base vtable 中 bar -> Base::bar 实现
    _drawFuncRef(svg,
      bvx + vtw, bvy + vtr*2 + vtr/2,
      fnX, fnBaseY + 30,
      '0xffff_1040  Base::bar() { … }',
      C.MUTED, 'vt-blue', 'vt-arrow-d3'
    );

    // Derived vtable 中 foo -> Derived::foo 覆盖
    _drawFuncRef(svg,
      dvx, dvy + vtr*1 + vtr/2,
      fnX + 310, fnBaseY,
      'Derived::foo() { … }  0xffff_2000',
      C.ORANGE_BD, 'vt-orange', 'vt-arrow-d3',
      true /* rtl */
    );

    // Derived vtable 中 bar -> 指向同一 Base::bar（虚线）
    _path(svg,
      'M' + dvx + ',' + (dvy + vtr*2 + vtr/2) + ' Q' + (bvx + vtw + 60) + ',' + (bvy + vtr*2 + vtr/2) + ' ' + (bvx + vtw) + ',' + (bvy + vtr*2 + vtr/2),
      C.GREEN_BD, 1.5, '5,3', 'vt-green', 'vt-arrow-d4'
    );
    _text(svg, bvx + vtw + 30, bvy + vtr*2 - 6, '继承', C.GREEN_BD, 9, 'middle');

    // ── 动态分发路径演示 ───────────────────────

    var dispY = 350;
    _rect(svg, 15, dispY - 10, 630, 90, '#FFF5F5', C.DISPATCH_ARROW, 6);
    _text(svg, 330, dispY + 6, '动态分发路径演示：Base* b = new Derived();  b->foo();', C.DISPATCH_ARROW, 11, 'middle');

    // 步骤标注
    var steps = [
      { x: 80,  label: '① b (Base*)' },
      { x: 210, label: '② 查 vptr' },
      { x: 360, label: '③ Derived vtable[foo]' },
      { x: 510, label: '④ Derived::foo()' }
    ];
    for (var s = 0; s < steps.length; s++) {
      _text(svg, steps[s].x, dispY + 35, steps[s].label, C.DISPATCH_ARROW, 10, 'middle');
      if (s < steps.length - 1) {
        _line(svg, steps[s].x + 50, dispY + 35, steps[s+1].x - 35, dispY + 35,
              C.DISPATCH_ARROW, 2, null, 'vt-red', 'vt-dispatch');
      }
    }

    _text(svg, 330, dispY + 65, '运行时根据对象实际类型决定调用哪个函数 — 这就是多态', C.MUTED, 10, 'middle');

    // ── 图例 ──────────────────────────────────

    _text(svg, 330, 440, '紫色=vptr   绿色=Base 函数   橙色=Derived 覆盖   红色=分发路径', C.MUTED, 10, 'middle');

    container.innerHTML = '';
    container.appendChild(svg);
  }

  /**
   * 绘制 vtable 行 -> 函数地址 的箭头 + 标注
   * @private
   */
  function _drawFuncRef(svg, fromX, fromY, toX, toY, label, color, markerId, cssClass, rtl) {
    var midX = rtl ? (toX + fromX) / 2 + 30 : (fromX + toX) / 2;
    _path(svg,
      'M' + fromX + ',' + fromY + ' C' + midX + ',' + fromY + ' ' + midX + ',' + toY + ' ' + toX + ',' + toY,
      color, 1.5, null, markerId, cssClass
    );
    _text(svg, toX + (rtl ? -5 : 5), toY, label, color, 9.5, rtl ? 'end' : 'start', 'monospace');
  }

  // ─────────────────────────────────────────────
  // 公开接口
  // ─────────────────────────────────────────────

  return {
    render: render
  };
})();

// 挂载到全局
if (typeof window !== 'undefined') {
  window.VtableDiagram = VtableDiagram;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VtableDiagram;
}

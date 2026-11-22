/* Lavish Media page runtime: renders each page's template and keeps it in sync with its state. */
(function () {
  'use strict';
  var BX = window.__BX || {};
  function fixBlob(s) {
    return typeof s === 'string' && s.indexOf('/_blob/') !== -1
      ? s.replace(/\/_blob\/([0-9a-f]{32})(?!\.)/g, function (m, id) { return 'assets/' + id + '.' + (BX[id] || 'jpg'); })
      : s;
  }

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (part, cb) {
    var p = typeof part === 'function' ? part(this.state, this.props) : part;
    this.state = Object.assign({}, this.state, p || {});
    if (this.__schedule) this.__schedule();
    if (cb) Promise.resolve().then(cb);
  };
  window.DCLogic = DCLogic;

  var EXPR = /\{\{\s*([^}]*?)\s*\}\}/g;
  var BOOL = { autoplay: 1, muted: 1, loop: 1, playsinline: 1, disabled: 1, checked: 1, selected: 1, required: 1, hidden: 1, open: 1, multiple: 1, readonly: 1 };

  function look(expr, scope) {
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    var parts = expr.split('.'), v;
    for (var i = scope.length - 1; i >= 0; i--) {
      if (scope[i] && Object.prototype.hasOwnProperty.call(scope[i], parts[0])) { v = scope[i][parts[0]]; break; }
    }
    for (var j = 1; j < parts.length; j++) v = v == null ? undefined : v[parts[j]];
    return v;
  }
  function val(str, scope) {
    var m = /^\{\{\s*([^}]*?)\s*\}\}$/.exec(str);
    if (m) return look(m[1], scope);
    if (str.indexOf('{{') === -1) return str;
    return str.replace(EXPR, function (_, e) { var v = look(e, scope); return v == null ? '' : String(v); });
  }

  // AST node: string (text) or [tag, attrs, children]
  function build(nodes, scope, out) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (typeof n === 'string') { out.push({ t: 'x', text: fixBlob(String(val(n, scope))) }); continue; }
      var tag = n[0], a = n[1], kids = n[2];
      if (tag === 'sc-for') {
        var list = val(a.list || '', scope) || [], as = a.as || 'item', g = { t: 'g', kids: [] };
        for (var k = 0; k < list.length; k++) { var s = {}; s[as] = list[k]; build(kids, scope.concat([s]), g.kids); }
        out.push(g); continue;
      }
      if (tag === 'sc-if') {
        var gi = { t: 'g', kids: [] };
        if (val(a.value || '', scope)) build(kids, scope, gi.kids);
        out.push(gi); continue;
      }
      var el = { t: 'e', tag: tag, attrs: {}, on: {}, ref: null, kids: [] };
      for (var name in a) {
        if (name.indexOf('hint-') === 0) continue;
        var v = val(a[name], scope);
        if (name === 'ref') { el.ref = v; continue; }
        if (/^on[a-z]/.test(name)) { el.on[name.slice(2)] = v; continue; }
        el.attrs[name] = typeof v === 'string' ? fixBlob(v) : v;
      }
      build(kids, scope, el.kids);
      out.push(el);
    }
    return out;
  }

  function setAttr(dom, name, v, old) {
    if (BOOL[name]) {
      if (v) dom.setAttribute(name, ''); else dom.removeAttribute(name);
      if (name === 'muted') { dom.muted = !!v; dom.defaultMuted = !!v; }
      else if (name === 'playsinline') dom.playsInline = !!v;
      else if (name in dom && typeof dom[name] === 'boolean') dom[name] = !!v;
      return;
    }
    if (name === 'value' && ('value' in dom)) { if (dom.value !== String(v == null ? '' : v)) dom.value = v == null ? '' : v; return; }
    if (v == null || v === false) dom.removeAttribute(name);
    else dom.setAttribute(name, v === true ? '' : String(v));
  }

  var refQueue = [];
  function create(v) {
    if (v.t === 'x') { v.dom = document.createTextNode(v.text); return [v.dom]; }
    if (v.t === 'g') {
      var nodes = [];
      v.kids.forEach(function (k) { nodes = nodes.concat(create(k)); });
      v.end = document.createComment('');
      nodes.push(v.end);
      return nodes;
    }
    var svg = v.tag === 'svg' || v.inSvg;
    var dom = svg ? document.createElementNS('http://www.w3.org/2000/svg', v.tag) : document.createElement(v.tag);
    v.dom = dom;
    for (var n in v.attrs) setAttr(dom, n, v.attrs[n]);
    bindEvents(dom, v.on);
    v.kids.forEach(function (k) {
      if (svg) markSvg(k);
      create(k).forEach(function (d) { dom.appendChild(d); });
    });
    // select value must be set after options exist
    if (v.tag === 'select' && 'value' in v.attrs) dom.value = v.attrs.value == null ? '' : v.attrs.value;
    if (typeof v.ref === 'function') refQueue.push([v.ref, dom]);
    return [dom];
  }
  function markSvg(k) { if (k.t === 'e') { k.inSvg = true; } else if (k.t === 'g') k.kids.forEach(markSvg); }
  function bindEvents(dom, on) {
    dom.__h = dom.__h || {};
    for (var ev in on) {
      if (!(ev in dom.__h)) (function (ev) { dom.addEventListener(ev, function (e) { var f = dom.__h[ev]; if (typeof f === 'function') f(e); }); })(ev);
      dom.__h[ev] = on[ev];
    }
    for (var o in dom.__h) if (!(o in on)) dom.__h[o] = null;
  }
  function first(v) {
    if (v.t !== 'g') return v.dom;
    for (var i = 0; i < v.kids.length; i++) { var d = first(v.kids[i]); if (d) return d; }
    return v.end;
  }
  function remove(v) {
    if (v.t === 'g') { v.kids.forEach(remove); if (v.end && v.end.parentNode) v.end.parentNode.removeChild(v.end); return; }
    if (v.t === 'e') {
      (function unref(x) { if (x.t === 'e' && typeof x.ref === 'function') x.ref(null); if (x.kids) x.kids.forEach(unref); })(v);
    }
    if (v.dom && v.dom.parentNode) v.dom.parentNode.removeChild(v.dom);
  }
  function same(a, b) { return a.t === b.t && (a.t !== 'e' || a.tag === b.tag); }

  function patch(parent, o, n) {
    if (n.t === 'x') { n.dom = o.dom; if (o.text !== n.text) n.dom.nodeValue = n.text; return; }
    if (n.t === 'g') { n.end = o.end; patchKids(parent, o.kids, n.kids, n.end); return; }
    var dom = n.dom = o.dom;
    n.inSvg = o.inSvg;
    for (var k in n.attrs) if (n.attrs[k] !== o.attrs[k]) setAttr(dom, k, n.attrs[k]);
    for (var r in o.attrs) if (!(r in n.attrs)) setAttr(dom, r, null);
    bindEvents(dom, n.on);
    if (n.ref !== o.ref && typeof n.ref === 'function') refQueue.push([n.ref, dom]);
    if (n.inSvg || n.tag === 'svg') n.kids.forEach(markSvg);
    patchKids(dom, o.kids, n.kids, null);
    if (n.tag === 'select' && 'value' in n.attrs && dom.value !== n.attrs.value) dom.value = n.attrs.value == null ? '' : n.attrs.value;
  }
  function patchKids(parent, olds, news, end) {
    var i, len = Math.max(olds.length, news.length);
    for (i = 0; i < len; i++) {
      var o = olds[i], n = news[i];
      if (o && n && same(o, n)) { patch(parent, o, n); continue; }
      if (n) {
        var before = o ? first(o) : nextAnchor(olds, i + 1, end);
        create(n).forEach(function (d) { parent.insertBefore(d, before); });
      }
      if (o) remove(o);
    }
  }
  function nextAnchor(olds, from, end) {
    for (var i = from; i < olds.length; i++) { var d = first(olds[i]); if (d) return d; }
    return end;
  }

  function mount() {
    var tplEl = document.getElementById('lm-tpl');
    var scriptEl = document.getElementById('lm-script');
    var app = document.getElementById('app');
    var ast = JSON.parse(tplEl.textContent);
    var defs = {};
    try { defs = JSON.parse(scriptEl.getAttribute('data-props') || '{}'); } catch (e) {}
    var props = {};
    for (var key in defs) if (key.charAt(0) !== '$' && defs[key] && 'default' in defs[key]) props[key] = defs[key].default;
    var Component = new Function('DCLogic', scriptEl.textContent + '\n;return Component;')(DCLogic);
    var comp = new Component(props);
    comp.props = props;
    if (!comp.state) comp.state = {};
    var tree = null, queued = false;
    function render() {
      queued = false;
      var vals = comp.renderVals();
      var next = { t: 'g', kids: build(ast, [vals], []) };
      if (!tree) {
        next.end = document.createComment('');
        next.kids.forEach(function (k) { create(k).forEach(function (d) { app.appendChild(d); }); });
        app.appendChild(next.end);
      } else {
        patchKids(app, tree.kids, next.kids, tree.end);
        next.end = tree.end;
      }
      tree = next;
      var q = refQueue; refQueue = [];
      q.forEach(function (r) { try { r[0](r[1]); } catch (e) { console.error(e); } });
    }
    comp.__schedule = function () { if (!queued) { queued = true; Promise.resolve().then(render); } };
    render();
    if (comp.componentDidMount) comp.componentDidMount();
    if (location.hash) {
      var t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (t) setTimeout(function () { t.scrollIntoView(); }, 50);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();

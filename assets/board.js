/*
 * The live circuit board behind the page.
 *
 * A procedurally routed PCB is built once in "world" units (24-unit grid,
 * 45° traces). A camera maps world → screen: at the top of the page it sits
 * close in on the main chip; as you scroll it zooms out and the signal colour
 * shifts layer by layer (copper → amber → blue → mint). Pulses of current run
 * along traces on their own, follow the cursor, and stream down a chip's bus
 * when you hover its navigation node.
 */
(function () {
  'use strict';

  var canvas = document.getElementById('board');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var root = document.documentElement;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- World + deterministic RNG ----------
  var G = 24, HX = 2880, HY = 1920;
  var COLS = HX * 2 / G, ROWS = HY * 2 / G;
  var grid = new Int32Array(COLS * ROWS); // 0 free, -1 keep-out, >0 trace id + 1

  var seed = 20170501;
  function rnd() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  function inGrid(cx, cy) { return cx > -COLS / 2 && cx < COLS / 2 - 1 && cy > -ROWS / 2 && cy < ROWS / 2 - 1; }
  function gi(cx, cy) { return (cy + ROWS / 2) * COLS + (cx + COLS / 2); }
  function keepOut(x0, y0, x1, y1) {
    for (var cy = Math.floor(y0 / G); cy <= Math.ceil(y1 / G); cy++)
      for (var cx = Math.floor(x0 / G); cx <= Math.ceil(x1 / G); cx++)
        if (inGrid(cx, cy)) grid[gi(cx, cy)] = -1;
  }

  var traces = [];   // { pts, cum, len, w, bus }
  var vias = [];     // [x, y]
  var pads = [];     // [x, y]
  var parts = [];    // small SMD parts [x, y, horizontal]
  var ics = [];      // { x, y, hw, hh, label, ref, id, pins: [[x, y, side]] }

  function addTrace(pts, w, bus) {
    var cum = [0], len = 0;
    for (var i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      cum.push(len);
    }
    traces.push({ pts: pts, cum: cum, len: len, w: w, bus: bus || null });
    return traces.length - 1;
  }
  function markPath(pts, id) {
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (G / 2));
      for (var k = 0; k <= n; k++) {
        var cx = Math.round((a[0] + (b[0] - a[0]) * k / n) / G);
        var cy = Math.round((a[1] + (b[1] - a[1]) * k / n) / G);
        if (inGrid(cx, cy) && grid[gi(cx, cy)] === 0) grid[gi(cx, cy)] = id + 1;
      }
    }
  }

  // ---------- Chips ----------
  var MAIN = { x: 0, y: 0, hw: 108, hh: 108, main: true, pins: [] };
  var PIN_OFFS = [-72, -48, -24, 0, 24, 48, 72];
  PIN_OFFS.forEach(function (o) {
    MAIN.pins.push([o, -120, 't'], [o, 120, 'b'], [-120, o, 'l'], [120, o, 'r']);
  });
  ics.push(MAIN);
  keepOut(-132, -132, 132, 132);

  var NODES = [
    { id: 'journey',  ref: 'U2', label: 'JOURNEY',  x: -336, y: -264 },
    { id: 'projects', ref: 'U3', label: 'PROJECTS', x: 336,  y: -264 },
    { id: 'stack',    ref: 'U4', label: 'STACK',    x: -360, y: 168 },
    { id: 'lab',      ref: 'U5', label: 'LAB',      x: 360,  y: 168 },
    { id: 'contact',  ref: 'U6', label: 'CONTACT',  x: 0,    y: 312 }
  ];
  NODES.forEach(function (n) {
    n.hw = 72; n.hh = 24; n.pins = [];
    [-48, -24, 0, 24, 48].forEach(function (o) { n.pins.push([n.x + o, n.y - 36, 't'], [n.x + o, n.y + 36, 'b']); });
    ics.push(n);
    keepOut(n.x - n.hw - 24, n.y - n.hh - 36, n.x + n.hw + 24, n.y + n.hh + 36);
  });

  // Hand-routed buses from the main chip to each node (3 parallel traces each).
  var busRoutes = { journey: [], projects: [], stack: [], lab: [], contact: [] };
  var usedMainPins = {};
  [0, 1, 2].forEach(function (k) {
    // Journey / Projects: out the top, along, then 45° up into the node's bottom pins.
    var px = [-72, -48, -24][k], stub = [24, 48, 72][k], tx = [-360, -336, -312][k];
    var y1 = -120 - stub, dy = Math.abs(-204 - y1);
    var j = [[px, -120], [px, y1], [tx + dy, y1], [tx, -204], [tx, -228]];
    busRoutes.journey.push(j);
    busRoutes.projects.push(j.map(function (p) { return [-p[0], p[1]]; }));
    usedMainPins['t' + px] = usedMainPins['t' + (-px)] = 1;

    // Stack / Lab: out the side, along, then 45° down into the node's top pins.
    var py = [24, 48, 72][k], sx = [-384, -360, -336][k];
    var s = [[-120, py], [-144, py], [-300, py], [sx, 108], [sx, 132]];
    busRoutes.stack.push(s);
    busRoutes.lab.push(s.map(function (p) { return [-p[0], p[1]]; }));
    usedMainPins['l' + py] = usedMainPins['r' + py] = 1;

    // Contact: straight down.
    var cx = [-24, 0, 24][k];
    busRoutes.contact.push([[cx, 120], [cx, 276]]);
    usedMainPins['b' + cx] = 1;
  });
  Object.keys(busRoutes).forEach(function (id) {
    busRoutes[id] = busRoutes[id].map(function (pts) {
      var t = addTrace(pts, 2.6, id);
      markPath(pts, t);
      return t;
    });
  });

  // ---------- Scatter other ICs and passives across the board ----------
  function areaFree(x0, y0, x1, y1) {
    for (var cy = Math.floor(y0 / G); cy <= Math.ceil(y1 / G); cy++)
      for (var cx = Math.floor(x0 / G); cx <= Math.ceil(x1 / G); cx++)
        if (!inGrid(cx, cy) || grid[gi(cx, cy)] !== 0) return false;
    return true;
  }
  var refN = 7;
  for (var tries = 0; tries < 400 && ics.length < 34; tries++) {
    var x = Math.round((rnd() * 2 - 1) * (HX - 200) / G) * G;
    var y = Math.round((rnd() * 2 - 1) * (HY - 200) / G) * G;
    if (Math.hypot(x, y * 1.4) < 720) continue;
    var hw = G * (2 + (rnd() * 3 | 0)), hh = G * (1 + (rnd() * 3 | 0));
    if (!areaFree(x - hw - 48, y - hh - 60, x + hw + 48, y + hh + 60)) continue;
    var ic = { x: x, y: y, hw: hw, hh: hh, ref: 'U' + (refN++), pins: [] };
    for (var o = -hw + G; o <= hw - G; o += G) ic.pins.push([x + o, y - hh - 12, 't'], [x + o, y + hh + 12, 'b']);
    if (hh >= 2 * G) for (var q = -hh + G; q <= hh - G; q += G) ic.pins.push([x - hw - 12, y + q, 'l'], [x + hw + 12, y + q, 'r']);
    ics.push(ic);
    keepOut(ic.x - hw - 12, ic.y - hh - 12, ic.x + hw + 12, ic.y + hh + 12);
  }
  for (var p = 0; p < 900 && parts.length < 180; p++) {
    var px2 = Math.round((rnd() * 2 - 1) * HX / G), py2 = Math.round((rnd() * 2 - 1) * HY / G);
    if (Math.hypot(px2 * G, py2 * G) < 300) continue;
    var horiz = rnd() < 0.5;
    if (!areaFree(px2 * G - 24, py2 * G - 24, px2 * G + 24, py2 * G + 24)) continue;
    parts.push([px2 * G, py2 * G, horiz]);
    keepOut(px2 * G - 12, py2 * G - 12, px2 * G + 12, py2 * G + 12);
  }

  // ---------- Random-walk routing ----------
  var DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var SIDE_DIR = { t: 6, b: 2, l: 4, r: 0 };
  function walk(sx, sy, dir, forced, maxSegs, startPad) {
    var cx = Math.round(sx / G), cy = Math.round(sy / G);
    var pts = [[sx, sy]], id = traces.length, steps = 0, segs = 0, ok = true;
    if (sx !== cx * G || sy !== cy * G) pts.push([cx * G, cy * G]);
    while (segs < maxSegs && ok) {
      var len = (segs === 0 && forced) ? forced + 1 + (rnd() * 3 | 0) : 2 + (rnd() * 7 | 0), moved = 0;
      for (var i = 0; i < len; i++) {
        var d = DIRS[dir], nx = cx + d[0], ny = cy + d[1];
        if (!inGrid(nx, ny)) { ok = false; break; }
        var free = grid[gi(nx, ny)] === 0;
        if (steps >= forced && !free) { ok = false; break; }
        if (d[0] && d[1] && steps >= forced) {
          var a = grid[gi(cx + d[0], cy)], b = grid[gi(cx, cy + d[1])];
          if (a > 0 && a === b) { ok = false; break; }
        }
        cx = nx; cy = ny; steps++; moved++;
        if (free) grid[gi(cx, cy)] = id + 1;
      }
      if (moved) { pts.push([cx * G, cy * G]); segs++; }
      var r = rnd();
      dir = (dir + (r < 0.42 ? 1 : r < 0.84 ? 7 : 0)) % 8;
    }
    if (steps < 3) return;
    addTrace(pts, rnd() < 0.12 ? 3.2 : 1.8);
    var end = pts[pts.length - 1];
    vias.push(end);
    if (startPad) pads.push(pts[0]);
  }

  // Fan-out from the main chip's free pins
  MAIN.pins.forEach(function (pin) {
    var off = pin[2] === 't' || pin[2] === 'b' ? pin[0] : pin[1];
    if (usedMainPins[pin[2] + off]) return;
    walk(pin[0], pin[1], SIDE_DIR[pin[2]], 3, 3 + (rnd() * 5 | 0), false);
  });
  // Fan-out from the other ICs
  ics.forEach(function (ic) {
    if (ic.main || NODES.indexOf(ic) >= 0) return;
    ic.pins.forEach(function (pin) {
      if (rnd() < 0.55) walk(pin[0], pin[1], SIDE_DIR[pin[2]], 1, 2 + (rnd() * 6 | 0), false);
    });
  });
  // Free-standing traces to fill the board
  for (var w = 0; w < 1500; w++) {
    var wx = Math.round((rnd() * 2 - 1) * (COLS / 2 - 2)), wy = Math.round((rnd() * 2 - 1) * (ROWS / 2 - 2));
    if (grid[gi(wx, wy)] !== 0) continue;
    walk(wx * G, wy * G, rnd() * 8 | 0, 0, 2 + (rnd() * 7 | 0), true);
  }

  // ---------- Pre-built paths (world coords) ----------
  function tracePath(filter) {
    var p = new Path2D();
    traces.forEach(function (t) {
      if (!filter(t)) return;
      p.moveTo(t.pts[0][0], t.pts[0][1]);
      for (var i = 1; i < t.pts.length; i++) p.lineTo(t.pts[i][0], t.pts[i][1]);
    });
    return p;
  }
  var pathThin = tracePath(function (t) { return !t.bus && t.w < 3; });
  var pathThick = tracePath(function (t) { return !t.bus && t.w >= 3; });
  var pathBus = tracePath(function (t) { return !!t.bus; });
  var pathVias = new Path2D();
  vias.forEach(function (v) { pathVias.moveTo(v[0] + 5, v[1]); pathVias.arc(v[0], v[1], 5, 0, Math.PI * 2); });
  var pathPads = new Path2D();
  pads.forEach(function (v) { pathPads.rect(v[0] - 5, v[1] - 5, 10, 10); });
  var pathPartBody = new Path2D(), pathPartPads = new Path2D();
  parts.forEach(function (s) {
    if (s[2]) { pathPartBody.rect(s[0] - 9, s[1] - 5, 18, 10); pathPartPads.rect(s[0] - 13, s[1] - 5, 5, 10); pathPartPads.rect(s[0] + 8, s[1] - 5, 5, 10); }
    else { pathPartBody.rect(s[0] - 5, s[1] - 9, 10, 18); pathPartPads.rect(s[0] - 5, s[1] - 13, 10, 5); pathPartPads.rect(s[0] - 5, s[1] + 8, 10, 5); }
  });
  var pathPins = new Path2D(), pathBodies = new Path2D();
  ics.forEach(function (ic) {
    pathBodies.roundRect ? pathBodies.roundRect(ic.x - ic.hw, ic.y - ic.hh, ic.hw * 2, ic.hh * 2, ic.main ? 8 : 4)
                         : pathBodies.rect(ic.x - ic.hw, ic.y - ic.hh, ic.hw * 2, ic.hh * 2);
    ic.pins.forEach(function (pin) {
      var s = pin[2];
      if (s === 't') pathPins.rect(pin[0] - 3.5, pin[1], 7, 12);
      else if (s === 'b') pathPins.rect(pin[0] - 3.5, pin[1] - 12, 7, 12);
      else if (s === 'l') pathPins.rect(pin[0], pin[1] - 3.5, 12, 7);
      else pathPins.rect(pin[0] - 12, pin[1] - 3.5, 12, 7);
    });
  });

  // ---------- Colour by layer ----------
  var STOPS = [[236, 140, 78], [245, 196, 84], [96, 162, 255], [70, 226, 162]];
  var layers = [].slice.call(document.querySelectorAll('[data-layer]'));
  var layerTops = [];
  function measure() {
    layerTops = layers.map(function (el) { return el.getBoundingClientRect().top + scrollY; });
  }
  function signalAt(y) {
    if (!layerTops.length) return STOPS[0];
    if (y <= layerTops[0]) return STOPS[0];
    for (var i = 1; i < layerTops.length; i++) {
      if (y < layerTops[i]) {
        var t = (y - layerTops[i - 1]) / (layerTops[i] - layerTops[i - 1]);
        t = Math.max(0, Math.min(1, (t - 0.55) / 0.45)); // hold the colour, then blend late
        var a = STOPS[i - 1], b = STOPS[i];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
    }
    return STOPS[STOPS.length - 1];
  }
  var C = STOPS[0];
  function col(a) { return 'rgba(' + (C[0] | 0) + ',' + (C[1] | 0) + ',' + (C[2] | 0) + ',' + a + ')'; }

  // ---------- Camera ----------
  var dpr = 1, vw = 0, vh = 0, S = 1, OX = 0, OY = 0, zoomT = 0, wide = true;
  var tmp = document.createElement('canvas'), tctx = tmp.getContext('2d');
  var LIGHT_R = 190;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = innerWidth; vh = innerHeight;
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    tmp.width = tmp.height = Math.ceil(LIGHT_R * 2 * dpr);
    wide = vw >= 1180;
    measure();
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function updateCamera() {
    var endY = layerTops.length ? layerTops[layerTops.length - 1] : vh * 4;
    var z = reduce ? 0 : smooth(Math.max(0, Math.min(1, scrollY / Math.max(1, endY))));
    var s0 = wide ? Math.max(0.72, Math.min(1, vw / 1600)) : Math.max(0.34, Math.min(0.62, vw / 1000));
    var sMin = Math.max(s0 * 0.36, vh / (2 * HY) * 1.2, vw / (2 * HX) * 1.2);
    S = s0 + (sMin - s0) * z;
    var cx0 = wide ? vw * 0.7 : vw * 0.5, cy0 = wide ? vh * 0.5 : vh * 0.23;
    OX = cx0 + (vw * 0.5 - cx0) * z;
    OY = cy0 + (vh * 0.5 - cy0) * z - Math.min(scrollY * 0.06, 260) * S;
    zoomT = z;
    C = signalAt(scrollY + vh * 0.5);
  }
  function setWorld(c, extraX, extraY) {
    c.setTransform(dpr * S, 0, 0, dpr * S, dpr * (OX + (extraX || 0)), dpr * (OY + (extraY || 0)));
  }

  // ---------- Nav nodes (DOM links placed over the node chips) ----------
  var nodesEl = document.querySelector('.nodes');
  var nodeLinks = {};
  [].forEach.call(document.querySelectorAll('.node'), function (a) {
    nodeLinks[a.dataset.node] = a;
    a.addEventListener('mouseenter', function () { hovered = a.dataset.node; });
    a.addEventListener('focus', function () { hovered = a.dataset.node; });
    a.addEventListener('mouseleave', function () { if (hovered === a.dataset.node) hovered = null; });
    a.addEventListener('blur', function () { if (hovered === a.dataset.node) hovered = null; });
  });
  var hovered = null, nodesAlpha = 1;
  function placeNodes() {
    nodesAlpha = Math.max(0, 1 - zoomT * 9);
    var show = nodesAlpha > 0.4 && vw >= 700;
    nodesEl.classList.toggle('off', !show);
    NODES.forEach(function (n) {
      var a = nodeLinks[n.id];
      if (!a) return;
      a.style.transform = 'translate(' + (OX + (n.x - n.hw - 14) * S) + 'px,' + (OY + (n.y - n.hh - 14) * S) + 'px)';
      a.style.width = (n.hw * 2 + 28) * S + 'px';
      a.style.height = (n.hh * 2 + 28) * S + 'px';
      a.tabIndex = show ? 0 : -1;
    });
  }

  // ---------- Pulses ----------
  var pulses = [], flashes = [];
  function pointAt(t, s) {
    var i = 1;
    while (i < t.cum.length - 1 && t.cum[i] < s) i++;
    var a = t.pts[i - 1], b = t.pts[i], seg = t.cum[i] - t.cum[i - 1] || 1;
    var k = Math.max(0, Math.min(1, (s - t.cum[i - 1]) / seg));
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  function spawn(id, rev, speed, from) {
    if (pulses.length > 110) return;
    pulses.push({ t: traces[id], rev: !!rev, v: speed || 240 + rnd() * 200, d: from || 0, done: false });
  }
  var walkIds = [];
  traces.forEach(function (t, i) { if (!t.bus && t.len > 140) walkIds.push(i); });

  function drawPulse(p) {
    var t = p.t, tail = Math.min(90, t.len * 0.6);
    var a = Math.max(0, p.d - tail), b = Math.min(t.len, p.d);
    if (b <= a) return;
    var s0 = p.rev ? t.len - b : a, s1 = p.rev ? t.len - a : b;
    var path = new Path2D(), st = pointAt(t, s0);
    path.moveTo(st[0], st[1]);
    for (var i = 1; i < t.pts.length - 1; i++) if (t.cum[i] > s0 && t.cum[i] < s1) path.lineTo(t.pts[i][0], t.pts[i][1]);
    var en = pointAt(t, s1);
    path.lineTo(en[0], en[1]);
    var fade = p.d > t.len ? Math.max(0, 1 - (p.d - t.len) / tail) : 1;
    ctx.lineWidth = Math.max(t.w * 3.4, 3 / S);
    ctx.strokeStyle = col(0.22 * fade);
    ctx.stroke(path);
    ctx.lineWidth = Math.max(t.w * 1.1, 1.3 / S);
    ctx.strokeStyle = col(0.95 * fade);
    ctx.stroke(path);
    if (p.d <= t.len) {
      var h = p.rev ? pointAt(t, t.len - p.d) : pointAt(t, p.d);
      ctx.fillStyle = 'rgba(255,255,255,' + 0.95 * fade + ')';
      ctx.beginPath(); ctx.arc(h[0], h[1], Math.max(2.4, 2 / S), 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------- Pointer ----------
  var mouse = { x: -9999, y: -9999, on: false, moved: 0 };
  addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true; mouse.moved = performance.now();
  }, { passive: true });
  document.addEventListener('pointerleave', function () { mouse.on = false; });
  var lastProbe = 0;
  function probeCursor(now) {
    if (!mouse.on || now - mouse.moved > 600 || now - lastProbe < 55) return;
    lastProbe = now;
    var wx = (mouse.x - OX) / S, wy = (mouse.y - OY) / S;
    var cx = Math.round(wx / G), cy = Math.round(wy / G), R = Math.max(2, Math.round(2 / S));
    var best = -1;
    for (var n = 0; n < 6 && best < 0; n++) {
      var x = cx + ((rnd() * 2 - 1) * R | 0), y = cy + ((rnd() * 2 - 1) * R | 0);
      if (inGrid(x, y) && grid[gi(x, y)] > 0) best = grid[gi(x, y)] - 1;
    }
    if (best < 0 || !traces[best]) return;
    var t = traces[best], nearest = 0, nd = Infinity;
    for (var i = 0; i < t.pts.length; i++) {
      var d = Math.hypot(t.pts[i][0] - wx, t.pts[i][1] - wy);
      if (d < nd) { nd = d; nearest = i; }
    }
    var rev = rnd() < 0.5;
    spawn(best, rev, 320 + rnd() * 180, rev ? t.len - t.cum[nearest] : t.cum[nearest]);
  }

  // ---------- HUD ----------
  var hudZ = document.getElementById('hud-zoom'), hudX = document.getElementById('hud-x'), hudY = document.getElementById('hud-y');
  function fmt(n) { n = Math.round(n); return (n < 0 ? '-' : '+') + ('0000' + Math.abs(n)).slice(-4); }
  var hudLast = 0;
  function hud(now) {
    if (!hudZ || now - hudLast < 80) return;
    hudLast = now;
    hudZ.textContent = S.toFixed(2);
    if (mouse.on) { hudX.textContent = fmt((mouse.x - OX) / S); hudY.textContent = fmt(-(mouse.y - OY) / S); }
  }

  // ---------- Render ----------
  function drawBoard(c, lit) {
    var min = 1 / S;
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = lit ? col(0.9) : col(0.13 + zoomT * 0.09);
    c.lineWidth = Math.max(1.8, min * 0.9); c.stroke(pathThin);
    c.lineWidth = Math.max(3.2, min); c.stroke(pathThick);
    c.strokeStyle = lit ? col(1) : col(0.3);
    c.lineWidth = Math.max(2.6, min * 1.2); c.stroke(pathBus);
    c.lineWidth = Math.max(1.6, min * 0.8);
    c.strokeStyle = lit ? col(0.9) : col(0.22); c.stroke(pathVias);
    c.fillStyle = lit ? col(0.8) : col(0.14); c.fill(pathPads); c.fill(pathPartPads);
    if (!lit) { c.fillStyle = 'rgba(20,24,31,.95)'; c.fill(pathPartBody); }
    c.fillStyle = lit ? col(0.9) : col(0.35); c.fill(pathPins);
  }

  function drawChips() {
    ctx.fillStyle = '#0b0e13';
    ctx.fill(pathBodies);
    ctx.lineWidth = Math.max(1.2, 1 / S);
    ctx.strokeStyle = 'rgba(255,255,255,.09)';
    ctx.stroke(pathBodies);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Main chip: die + markings
    var g = ctx.createLinearGradient(-70, -70, 70, 70);
    g.addColorStop(0, col(0.2)); g.addColorStop(0.5, 'rgba(18,22,29,1)'); g.addColorStop(1, col(0.12));
    ctx.fillStyle = g;
    ctx.fillRect(-72, -72, 144, 144);
    ctx.strokeStyle = col(0.55); ctx.lineWidth = Math.max(1, 1 / S);
    ctx.strokeRect(-72, -72, 144, 144);
    ctx.beginPath(); ctx.arc(-92, -92, 5, 0, Math.PI * 2); ctx.fillStyle = col(0.5); ctx.fill();
    ctx.fillStyle = col(1);
    ctx.font = '600 30px "Space Grotesk", sans-serif';
    ctx.fillText('JN-01', 0, -8);
    ctx.fillStyle = 'rgba(236,234,230,.55)';
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.fillText('SILICON → CLOUD', 0, 20);
    ctx.fillText('REV 2026', 0, 36);

    // Node chips
    NODES.forEach(function (n) {
      var on = hovered === n.id;
      ctx.lineWidth = Math.max(1.2, 1 / S);
      ctx.strokeStyle = on ? col(1) : col(0.35 * Math.max(nodesAlpha, 0.4));
      ctx.strokeRect(n.x - n.hw, n.y - n.hh, n.hw * 2, n.hh * 2);
      if (on) { ctx.fillStyle = col(0.12); ctx.fillRect(n.x - n.hw, n.y - n.hh, n.hw * 2, n.hh * 2); }
      ctx.fillStyle = on ? col(1) : 'rgba(236,234,230,' + (0.85 * Math.max(nodesAlpha, 0.35)) + ')';
      ctx.font = '600 15px "JetBrains Mono", monospace';
      ctx.fillText(n.label, n.x + 8, n.y + 1);
      ctx.fillStyle = col(on ? 1 : 0.6);
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(n.ref, n.x - n.hw + 8, n.y + 1);
      ctx.textAlign = 'center';
    });

    // Reference designators on other ICs
    ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(236,234,230,.28)';
    ics.forEach(function (ic) {
      if (ic.main || NODES.indexOf(ic) >= 0) return;
      ctx.fillText(ic.ref, ic.x, ic.y);
    });
  }

  function render(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    setWorld(ctx);
    drawBoard(ctx, false);

    // Cursor light: a bright copy of the board masked to a soft circle
    if (mouse.on) {
      var R = LIGHT_R, size = tmp.width;
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.globalCompositeOperation = 'source-over';
      tctx.clearRect(0, 0, size, size);
      setWorld(tctx, R - mouse.x, R - mouse.y);
      drawBoard(tctx, true);
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.globalCompositeOperation = 'destination-in';
      var rg = tctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(0.45, 'rgba(0,0,0,.55)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      tctx.fillStyle = rg; tctx.fillRect(0, 0, size, size);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(tmp, (mouse.x - R) * dpr, (mouse.y - R) * dpr);
      ctx.globalCompositeOperation = 'source-over';
    }

    setWorld(ctx);
    drawChips();

    // Pulses + via flashes
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    pulses.forEach(drawPulse);
    flashes.forEach(function (f) {
      ctx.strokeStyle = col(f.life);
      ctx.lineWidth = Math.max(1.5, 1 / S);
      ctx.beginPath(); ctx.arc(f.x, f.y, 5 + (1 - f.life) * 14, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Loop ----------
  var last = performance.now(), lastAmbient = 0, lastBus = 0, lastHoverBus = 0, lastSig = '';
  function tick(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    updateCamera();
    placeNodes();

    var sig = (C[0] | 0) + ' ' + (C[1] | 0) + ' ' + (C[2] | 0);
    if (sig !== lastSig) { root.style.setProperty('--signal', sig); lastSig = sig; }

    if (!reduce) {
      if (now - lastAmbient > 70 && walkIds.length) {
        lastAmbient = now;
        spawn(walkIds[rnd() * walkIds.length | 0], rnd() < 0.5);
      }
      if (now - lastBus > 900) {
        lastBus = now;
        var ids = busRoutes[NODES[rnd() * NODES.length | 0].id];
        spawn(ids[rnd() * ids.length | 0], false, 420);
      }
      if (hovered && now - lastHoverBus > 130) {
        lastHoverBus = now;
        busRoutes[hovered].forEach(function (id, k) { spawn(id, false, 520 + k * 30); });
      }
      probeCursor(now);

      for (var i = pulses.length - 1; i >= 0; i--) {
        var p = pulses[i];
        p.d += p.v * dt;
        if (!p.done && p.d >= p.t.len) {
          p.done = true;
          var e = p.rev ? p.t.pts[0] : p.t.pts[p.t.pts.length - 1];
          if (flashes.length < 40) flashes.push({ x: e[0], y: e[1], life: 1 });
        }
        if (p.d > p.t.len + 100) pulses.splice(i, 1);
      }
      for (var f = flashes.length - 1; f >= 0; f--) {
        flashes[f].life -= dt * 1.8;
        if (flashes[f].life <= 0) flashes.splice(f, 1);
      }
    }

    render(now);
    hud(now);
    requestAnimationFrame(tick);
  }

  resize();
  addEventListener('resize', resize);
  addEventListener('load', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  requestAnimationFrame(tick);
})();

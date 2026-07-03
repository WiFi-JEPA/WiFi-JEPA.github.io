// WiFi-JEPA interactive 3D pose viewer (vanilla Canvas 2D, no dependencies).
// Static panels: window.POSE_RESULTS = [{name, count, mpjpe, persons:[{gt[14][3], pred[14][3], err[14]}]}]
// Motion clips:  window.POSE_VIDEOS  = [{name, count, mean_mpjpe, frames:[{mpjpe, persons:[...]}]}]
// Raw P3D coords are x/y horizontal, z pointing DOWN (floor at z≈4.1) → view space flips z up.
(function () {
  'use strict';

  var JOINT_NAMES = [
    'Neck', 'Head',
    'L.Shoulder', 'R.Shoulder',
    'L.Elbow', 'L.Hip',
    'R.Elbow', 'R.Hip',
    'L.Wrist', 'L.Knee',
    'R.Wrist', 'R.Knee',
    'L.Ankle', 'R.Ankle'
  ];
  var EDGES = [
    [0, 1], [0, 2], [0, 3],
    [2, 4], [4, 8],
    [3, 6], [6, 10],
    [0, 5], [0, 7], [5, 7],
    [5, 9], [9, 12],
    [7, 11], [11, 13]
  ];
  var GT_COLOR = '#e11d48';    // red — ground truth
  var PRED_COLOR = '#2563eb';  // blue — prediction
  var FLOOR_FILL = '#f5f6f8', FLOOR_LINE = '#dfe3e8';   // front (floor) pane — light gray
  var WALL_FILL = '#eceef1', WALL_LINE = '#d5d9de';     // back wall panes — slightly darker
  var CLIP_FPS = 12;

  // raw (x, y, z) → view (X right, Y up, Z depth)
  function toView(p) { return [p[0], -p[2], p[1]]; }

  function PoseViewer(container, panel, capEl) {
    var canvas = document.createElement('canvas');
    canvas.className = 'pv-canvas';
    container.appendChild(canvas);
    var tip = document.createElement('div');
    tip.className = 'pv-tip';
    container.appendChild(tip);

    var ctx = canvas.getContext('2d');
    var rawFrames = panel.frames || [{ mpjpe: panel.mpjpe, persons: panel.persons }];
    var isVideo = rawFrames.length > 1;
    var frames = rawFrames.map(function (fr) {
      return {
        mpjpe: fr.mpjpe,
        persons: fr.persons.map(function (pe) {
          return { gt: pe.gt.map(toView), pred: pe.pred.map(toView), err: pe.err };
        })
      };
    });

    // scene bounds over ALL frames (stable camera while people move)
    var mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    frames.forEach(function (fr) {
      fr.persons.forEach(function (pe) {
        pe.gt.concat(pe.pred).forEach(function (p) {
          for (var i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
        });
      });
    });
    var center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    var radius = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2 || 1;
    var floorY = mn[1] - 0.02;
    var topY = mx[1] + 0.3 * radius;
    var ext = radius * 1.3;

    var DEF = { yaw: -0.6, pitch: 0.32, zoom: 1 };
    var yaw = DEF.yaw, pitch = DEF.pitch, zoom = DEF.zoom;
    var fi = 0;               // current frame
    var hover = null;         // {pi, ji}
    var projected = [];       // [{x, y, pi, ji}]
    var lastMouse = null;
    var W = 0, H = 0, dpr = 1;

    function resize() {
      var r = container.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      W = Math.max(120, r.width);
      H = W;                              // square panel
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      render();
    }

    function rotDepth(p) {
      var x = p[0] - center[0], y = p[1] - center[1], z = p[2] - center[2];
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      var z1 = -x * sy + z * cy;
      return -y * Math.sin(pitch) + z1 * Math.cos(pitch);
    }

    function project(p) {
      var x = p[0] - center[0], y = p[1] - center[1], z = p[2] - center[2];
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      var x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      var cp = Math.cos(pitch), sp = Math.sin(pitch);
      var y2 = y * cp + z1 * sp, z2 = -y * sp + z1 * cp;   // pitch>0 → camera above
      var f = radius * 4;
      var s = f / (f + z2 + radius * 2);
      var k = (W * 0.42 / radius) * zoom * s;
      return { x: W / 2 + x1 * k, y: H / 2 - y2 * k, s: s };
    }

    function lerp3(a, b, t) {
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }

    function paneCenter(c) {
      return [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2, (c[0][2] + c[2][2]) / 2];
    }

    function line(a, b, colorStr, w) {
      ctx.strokeStyle = colorStr;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    function drawPane(corners, fill, lineCol) {
      var q = corners.map(project);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      for (var i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
      ctx.closePath();
      ctx.fill();
      var G = 6;
      for (var i = 0; i <= G; i++) {
        var t = i / G;
        line(project(lerp3(corners[0], corners[1], t)),
             project(lerp3(corners[3], corners[2], t)), lineCol, 1);
        line(project(lerp3(corners[0], corners[3], t)),
             project(lerp3(corners[1], corners[2], t)), lineCol, 1);
      }
    }

    function render() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // room-corner panes (matplotlib-style): floor + the two walls currently facing away
      var x0 = center[0] - ext, x1 = center[0] + ext;
      var z0 = center[2] - ext, z1 = center[2] + ext;
      var floorPane = [[x0, floorY, z0], [x1, floorY, z0], [x1, floorY, z1], [x0, floorY, z1]];
      var topPane   = [[x0, topY, z0], [x1, topY, z0], [x1, topY, z1], [x0, topY, z1]];
      var wallXa = [[x0, floorY, z0], [x0, floorY, z1], [x0, topY, z1], [x0, topY, z0]];
      var wallXb = [[x1, floorY, z0], [x1, floorY, z1], [x1, topY, z1], [x1, topY, z0]];
      var wallZa = [[x0, floorY, z0], [x1, floorY, z0], [x1, topY, z0], [x0, topY, z0]];
      var wallZb = [[x0, floorY, z1], [x1, floorY, z1], [x1, topY, z1], [x0, topY, z1]];
      var hor = rotDepth(paneCenter(floorPane)) > rotDepth(paneCenter(topPane)) ? floorPane : topPane;
      var wallX = rotDepth(paneCenter(wallXa)) > rotDepth(paneCenter(wallXb)) ? wallXa : wallXb;
      var wallZ = rotDepth(paneCenter(wallZa)) > rotDepth(paneCenter(wallZb)) ? wallZa : wallZb;
      var panes = [
        { c: hor, fill: FLOOR_FILL, lineCol: FLOOR_LINE },
        { c: wallX, fill: WALL_FILL, lineCol: WALL_LINE },
        { c: wallZ, fill: WALL_FILL, lineCol: WALL_LINE }
      ].sort(function (a, b) { return rotDepth(paneCenter(b.c)) - rotDepth(paneCenter(a.c)); });
      panes.forEach(function (pn) { drawPane(pn.c, pn.fill, pn.lineCol); });

      projected = [];
      var persons = frames[fi].persons;
      persons.forEach(function (pe, pi) {
        [['gt', GT_COLOR, 2], ['pred', PRED_COLOR, 2.5]].forEach(function (spec) {
          var kind = spec[0], colorStr = spec[1], lw = spec[2];
          var P2 = pe[kind].map(project);
          EDGES.forEach(function (e) { line(P2[e[0]], P2[e[1]], colorStr, lw); });
          P2.forEach(function (q, ji) {
            var hv = hover && hover.pi === pi && hover.ji === ji;
            ctx.fillStyle = colorStr;
            ctx.beginPath();
            ctx.arc(q.x, q.y, hv ? 5 : 3, 0, 6.2832);
            ctx.fill();
            projected.push({ x: q.x, y: q.y, pi: pi, ji: ji });
          });
        });
        if (hover && hover.pi === pi) {   // dashed GT↔pred error segment
          var a = project(pe.gt[hover.ji]), b = project(pe.pred[hover.ji]);
          ctx.setLineDash([4, 3]);
          line(a, b, '#64748b', 1.3);
          ctx.setLineDash([]);
        }
      });
    }

    function pickJoint(mx2, my2) {
      var best = null, bd = 12 * 12;
      projected.forEach(function (q) {
        var d = (q.x - mx2) * (q.x - mx2) + (q.y - my2) * (q.y - my2);
        if (d < bd) { bd = d; best = q; }
      });
      return best;
    }

    function showTip(q) {
      var persons = frames[fi].persons;
      var pe = persons[q.pi];
      if (!pe) { tip.style.display = 'none'; return; }
      var label = (persons.length > 1 ? 'P' + (q.pi + 1) + ' · ' : '') +
        JOINT_NAMES[q.ji] + ' · ' + pe.err[q.ji].toFixed(1) + ' mm';
      tip.textContent = label;
      tip.style.display = 'block';
      var tx = Math.min(Math.max(q.x, 40), W - 40);
      tip.style.left = tx + 'px';
      tip.style.top = Math.max(q.y - 14, 10) + 'px';
    }

    function refreshHover() {
      if (!lastMouse) return;
      var q = pickJoint(lastMouse.x, lastMouse.y);
      hover = q ? { pi: q.pi, ji: q.ji } : null;
      if (q) showTip(q); else tip.style.display = 'none';
    }

    // ---------- animation ----------
    var playing = isVideo, userPaused = false, visible = true;
    var rafId = null, lastT = 0, acc = 0;
    var playBtn = null, progFill = null;

    function updateCap() {
      if (!capEl) return;
      var t = 'MPJPE ' + frames[fi].mpjpe.toFixed(1) + ' mm';
      if (isVideo) t += ' · ' + (fi + 1) + '/' + frames.length;
      capEl.textContent = t;
    }

    function updateProgress() {
      if (progFill) progFill.style.width = ((fi + 1) / frames.length * 100) + '%';
    }

    function setFrame(i) {
      fi = ((i % frames.length) + frames.length) % frames.length;
      if (hover) refreshHover();
      updateCap();
      updateProgress();
      render();
    }

    function tick(t) {
      rafId = null;
      if (!playing || !visible) { lastT = 0; return; }
      if (lastT) acc += t - lastT;
      lastT = t;
      var step = 1000 / CLIP_FPS;
      if (acc >= step) {
        var adv = Math.floor(acc / step);
        acc -= adv * step;
        setFrame(fi + adv);
      }
      rafId = requestAnimationFrame(tick);
    }

    function ensureLoop() {
      if (playing && visible && !rafId) { lastT = 0; acc = 0; rafId = requestAnimationFrame(tick); }
    }

    function syncPlayBtn() {
      if (!playBtn) return;
      playBtn.innerHTML = playing
        ? '<svg viewBox="0 0 24 24" width="11" height="11"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M8 5 L19 12 L8 19 Z" fill="currentColor"/></svg>';
      playBtn.title = playing ? 'Pause' : 'Play';
    }

    if (isVideo) {
      playBtn = document.createElement('button');
      playBtn.className = 'pv-play';
      playBtn.setAttribute('aria-label', 'Play or pause');
      playBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        playing = !playing;
        userPaused = !playing;
        syncPlayBtn();
        ensureLoop();
      });
      container.appendChild(playBtn);
      syncPlayBtn();

      var prog = document.createElement('div');
      prog.className = 'pv-progress';
      progFill = document.createElement('div');
      progFill.className = 'pv-progress-fill';
      prog.appendChild(progFill);
      prog.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        var r = prog.getBoundingClientRect();
        setFrame(Math.floor((e.clientX - r.left) / r.width * frames.length));
      });
      container.appendChild(prog);

      if (window.IntersectionObserver) {
        new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
          ensureLoop();
        }, { threshold: 0.12 }).observe(container);
      }
      ensureLoop();
    }

    // ---------- interaction: drag rotate, wheel zoom, pinch, dblclick reset, hover ----------
    var pointers = {}, dragging = false, lastX = 0, lastY = 0, pinchD = 0;

    canvas.addEventListener('pointerdown', function (ev) {
      pointers[ev.pointerId] = ev;
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic events */ }
      var ids = Object.keys(pointers);
      if (ids.length === 1) { dragging = true; lastX = ev.clientX; lastY = ev.clientY; }
      else if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinchD = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        dragging = false;
      }
      container.classList.add('pv-grabbing');
    });

    canvas.addEventListener('pointermove', function (ev) {
      if (pointers[ev.pointerId]) pointers[ev.pointerId] = ev;
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinchD > 0) {
          zoom = Math.min(5, Math.max(0.4, zoom * d / pinchD));
          pinchD = d;
          render();
        }
        return;
      }
      if (dragging) {
        yaw += (ev.clientX - lastX) * 0.011;
        pitch = Math.min(1.45, Math.max(-1.45, pitch + (ev.clientY - lastY) * 0.011));
        lastX = ev.clientX; lastY = ev.clientY;
        if (hover) { hover = null; tip.style.display = 'none'; }
        render();
        return;
      }
      // hover (mouse only)
      var rct = canvas.getBoundingClientRect();
      lastMouse = { x: ev.clientX - rct.left, y: ev.clientY - rct.top };
      var q = pickJoint(lastMouse.x, lastMouse.y);
      var changed = (q === null) !== (hover === null) ||
        (q && hover && (q.pi !== hover.pi || q.ji !== hover.ji));
      hover = q ? { pi: q.pi, ji: q.ji } : null;
      if (q) showTip(q); else tip.style.display = 'none';
      canvas.style.cursor = q ? 'pointer' : 'grab';
      if (changed) render();
    });

    function endPointer(ev) {
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length === 0) {
        dragging = false;
        container.classList.remove('pv-grabbing');
      }
      pinchD = 0;
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', function () {
      lastMouse = null;
      if (!dragging) { hover = null; tip.style.display = 'none'; render(); }
    });

    canvas.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      zoom = Math.min(5, Math.max(0.4, zoom * Math.exp(-ev.deltaY * 0.0012)));
      render();
    }, { passive: false });

    canvas.addEventListener('dblclick', function () {
      yaw = DEF.yaw; pitch = DEF.pitch; zoom = DEF.zoom;
      render();
    });

    if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
    else window.addEventListener('resize', resize);
    updateCap();
    updateProgress();
    resize();

    return {
      render: render,
      canvas: canvas,
      seek: setFrame,
      frame: function () { return fi; },
      setPlaying: function (p) { playing = !!p; syncPlayBtn(); ensureLoop(); }
    };
  }

  var MAGNIFIER_SVG =
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<line x1="10" y1="7.5" x2="10" y2="12.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<line x1="7.5" y1="10" x2="12.5" y2="10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<line x1="15.2" y1="15.2" x2="20" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>';

  function openModal(panel) {
    var ov = document.createElement('div');
    ov.className = 'pv-modal';
    ov.innerHTML =
      '<div class="pv-modal-card">' +
      '<button class="pv-modal-close" aria-label="Close">&times;</button>' +
      '<div class="pv-modal-holder"></div>' +
      '<div class="pv-mpjpe has-text-centered"></div>' +
      '</div>';
    document.body.appendChild(ov);
    document.body.classList.add('pv-noscroll');
    PoseViewer(ov.querySelector('.pv-modal-holder'), panel, ov.querySelector('.pv-mpjpe'));
    function close() {
      document.body.classList.remove('pv-noscroll');
      document.removeEventListener('keydown', onKey);
      ov.remove();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.pv-modal-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
  }

  function buildGrid(root, items, label) {
    if (!items.length) return;
    var lab = document.createElement('div');
    lab.className = 'pv-rowlabel';
    lab.textContent = label;
    root.appendChild(lab);
    var grid = document.createElement('div');
    grid.className = 'pv-grid';
    root.appendChild(grid);
    items.forEach(function (panel) {
      var cell = document.createElement('div');
      cell.className = 'pv-cell';
      var holder = document.createElement('div');
      holder.className = 'pv-holder';
      cell.appendChild(holder);
      var btn = document.createElement('button');
      btn.className = 'pv-expand';
      btn.title = 'Enlarge';
      btn.setAttribute('aria-label', 'Enlarge this result');
      btn.innerHTML = MAGNIFIER_SVG;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openModal(panel);
      });
      holder.appendChild(btn);
      var cap = document.createElement('div');
      cap.className = 'pv-mpjpe';
      cell.appendChild(cap);
      grid.appendChild(cell);
      window.__poseViewers.push(PoseViewer(holder, panel, cap));
    });
  }

  function init() {
    var root = document.getElementById('pose-viewer-root');
    if (!root) return;
    var data = window.POSE_RESULTS || [];
    var vids = window.POSE_VIDEOS || [];
    if (!data.length && !vids.length) return;
    window.__poseViewers = [];
    [[1, 'Single-person'], [2, 'Two-person'], [3, 'Three-person']].forEach(function (grp) {
      buildGrid(root, data.filter(function (p) { return p.count === grp[0]; }), grp[1]);
    });
    buildGrid(root, vids, 'Motion Clips');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

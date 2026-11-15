import { feature, geoDistance, geoGraticule, geoOrthographic, geoPath } from './vendor/atlas-geo.js';

const initialCenter = [-24, 26];
const maxZoom = 12;
const radians = Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export async function setupGlobe(canvas, svg, shapes, { updateZoom, describe, inspect }) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas is unavailable');
  const response = await fetch('./vendor/atlas-land-110m.json', { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('The globe basemap is unavailable');
  const topology = await response.json();
  const land = feature(topology, topology.objects.land);
  const grid = geoGraticule().step([15, 15])();
  const projection = geoOrthographic().clipAngle(90).precision(0.65);
  const path = geoPath(projection, context);
  const pointers = new Map();
  let center = initialCenter;
  let zoom = 1;
  let active = false;
  let queued = false;
  let dirty = true;
  let moving = false;
  let scene = [];
  let markerHitRegions = [];
  let scale = 1;
  let ratio = 1;

  function queueRender() {
    if (queued || !active) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (active) draw();
    });
  }

  function refreshScene() {
    scene = [];
    for (const element of svg.querySelectorAll('[data-atlas-shape]')) {
      if (element.closest('[hidden]')) continue;
      const shape = shapes.get(element);
      if (!shape) continue;
      const point = shape.type === 'Point';
      const style = getComputedStyle(point ? element.querySelector('circle') : element);
      const interactive = element.hasAttribute('data-map-action');
      if (point) {
        scene.push({ shape, element, interactive, fill: style.fill, stroke: style.stroke });
        continue;
      }
      const dash = style.strokeDasharray.match(/[\d.]+/g)?.map(Number) ?? [];
      const previous = scene.at(-1);
      const key = [style.stroke, style.strokeWidth, style.strokeDasharray, style.opacity].join('|');
      if (previous?.key === key) {
        previous.shape.coordinates.push(...shape.coordinates);
        if (interactive) previous.hits.push({ shape, element });
      } else {
        scene.push({
          key, shape: { ...shape, coordinates: [...shape.coordinates] }, dash, stroke: style.stroke,
          width: parseFloat(style.strokeWidth) || 1, opacity: Number(style.opacity),
          hits: interactive ? [{ shape, element }] : [],
        });
      }
    }
    dirty = false;
  }

  function drawMarker(item, w, h) {
    const { shape, element, interactive, fill, stroke } = item;
    if (geoDistance(center, shape.coordinates) > Math.PI / 2) return;
    let [x, y] = projection(shape.coordinates);
    const [dx, dy] = shape.offset ?? [0, 0];
    x += dx;
    y += dy;
    if (x < -10 || x > w + 10 || y < -10 || y > h + 10) return;
    const r = Math.max(3, shape.radius * 0.85);
    const selected = element.classList.contains('is-active');
    context.beginPath();
    context.arc(x, y, r, 0, 2 * Math.PI);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = selected ? '#fff' : stroke;
    context.lineWidth = selected ? 2 : 1.4;
    context.stroke();

    if (shape.label) {
      context.fillStyle = '#1a1720';
      context.font = '700 9px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(shape.label, x, y + 0.5);
    } else if (zoom >= 2.4 || interactive) {
      const left = x > w * 0.78;
      context.font = '650 11px system-ui, sans-serif';
      context.textAlign = left ? 'right' : 'left';
      context.textBaseline = 'middle';
      context.strokeStyle = '#10171d';
      context.lineWidth = 3;
      context.fillStyle = '#e2ecef';
      const labelX = x + (left ? -(r + 4) : r + 4);
      context.strokeText(shape.name, labelX, y - 5);
      context.fillText(shape.name, labelX, y - 5);
    }
    markerHitRegions.push({ x, y, name: shape.name, element: interactive ? element : null, radius: r + 6 });
  }

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pxWidth = Math.round(w * ratio);
    const pxHeight = Math.round(h * ratio);
    if (canvas.width !== pxWidth || canvas.height !== pxHeight) {
      canvas.width = pxWidth;
      canvas.height = pxHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineJoin = 'round';
    context.lineCap = 'round';
    const inset = Math.min(w, h) < 450 ? 16 : 34;
    scale = Math.max(10, Math.min(w, h) / 2 - inset) * zoom;
    const x = w / 2;
    const y = h / 2;
    projection.translate([x, y]).scale(scale).rotate([-center[0], -center[1]])
      .clipExtent([[-8, -8], [w + 8, h + 8]]);

    context.fillStyle = '#0b121a';
    context.fillRect(0, 0, w, h);
    const ocean = context.createRadialGradient(x - scale * 0.26, y - scale * 0.28, 0, x, y, scale);
    ocean.addColorStop(0, '#193d4b');
    ocean.addColorStop(0.75, '#102c3a');
    ocean.addColorStop(1, '#102331');
    context.fillStyle = ocean;
    context.beginPath();
    context.arc(x, y, scale, 0, 2 * Math.PI);
    context.fill();
    context.strokeStyle = '#365566';
    context.lineWidth = 1;
    context.stroke();

    context.beginPath();
    path(land);
    context.fillStyle = '#294d52';
    context.fill();
    context.lineWidth = 0.7;
    context.strokeStyle = '#527675';
    // Clip the land stroke to the sphere at the horizon.
    context.save();
    const rim = new Path2D();
    rim.arc(x, y, scale, 0, 2 * Math.PI);
    context.clip(rim);
    context.stroke();

    context.beginPath();
    path(grid);
    context.lineWidth = 0.65;
    context.strokeStyle = '#a3c7cc36';
    context.stroke();
    context.restore();

    if (dirty) refreshScene();
    markerHitRegions = [];
    for (const item of scene) {
      if (item.shape.type === 'Point') {
        drawMarker(item, w, h);
        continue;
      }
      context.beginPath();
      path(item.shape);
      context.strokeStyle = item.stroke;
      context.lineWidth = item.width;
      context.globalAlpha = item.opacity;
      context.setLineDash(item.dash);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
    }
    const moved = zoom > 1 || center[0] !== initialCenter[0] || center[1] !== initialCenter[1];
    updateZoom(zoom, moved);
    describe(svg.getAttribute('aria-label'));
  }

  function focus(coords, zoomLevel = zoom) {
    center = [coords[0], clamp(coords[1], -89.9, 89.9)];
    zoom = clamp(zoomLevel, 1, maxZoom);
    queueRender();
  }

  function reset() {
    focus(initialCenter, 1);
  }

  function zoomBy(factor) {
    zoom = clamp(zoom * factor, 1, maxZoom);
    queueRender();
  }

  function rotate(dx, dy) {
    const lon = center[0] - dx;
    center = [((lon + 180) % 360 + 360) % 360 - 180, clamp(center[1] + dy, -89.9, 89.9)];
    queueRender();
  }

  function markerAt(x, y) {
    return markerHitRegions.findLast((item) => Math.hypot(item.x - x, item.y - y) <= item.radius);
  }

  function pick(x, y) {
    const dot = markerAt(x, y);
    if (dot?.element) return dot.element;
    context.lineWidth = 10;
    for (let i = scene.length - 1; i >= 0; i--) {
      const hits = scene[i].hits;
      if (!hits?.length) continue;
      for (let j = hits.length - 1; j >= 0; j--) {
        const item = hits[j];
        context.beginPath();
        path(item.shape);
        if (context.isPointInStroke(x * ratio, y * ratio)) return item.element;
      }
    }
    return null;
  }

  function position(event) {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function gap() {
    const [a, b] = pointers.values();
    return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointers.size >= 2) return;
    if (!pointers.size) moving = false;
    if (pointers.size) moving = true;
    const [x, y] = position(event);
    pointers.set(event.pointerId, { x, y, startX: x, startY: y });
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    const [x, y] = position(event);
    const pointer = pointers.get(event.pointerId);
    if (!pointer) {
      canvas.title = markerAt(x, y)?.name ?? '';
      return;
    }
    if (!moving && Math.hypot(x - pointer.startX, y - pointer.startY) < 5) return;
    moving = true;
    canvas.classList.add('is-dragging');
    const before = gap();
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    Object.assign(pointer, { x, y });
    const after = gap();
    if (before && after) zoomBy(after / before);
    else rotate(dx / scale / radians, dy / scale / radians);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (pointers.has(event.pointerId) && !moving) {
      const choice = pick(...position(event));
      if (choice) {
        inspect();
        choice.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, (event) => {
      pointers.delete(event.pointerId);
      if (!pointers.size) canvas.classList.remove('is-dragging');
    });
  }
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomBy(Math.exp(-clamp(event.deltaY, -140, 140) * 0.007));
  }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[event.key]) rotate(...directions[event.key].map((value) => value * 12 / zoom));
    else if (event.key === '+' || event.key === '=') zoomBy(1.5);
    else if (event.key === '-') zoomBy(1 / 1.5);
    else if (event.key === '0' || event.key === 'Home') reset();
    else return;
    event.preventDefault();
  });

  new ResizeObserver(queueRender).observe(canvas);
  new MutationObserver(() => {
    dirty = true;
    queueRender();
  }).observe(svg, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'd', 'hidden', 'data-atlas-shape', 'aria-label'] });

  return {
    focus, reset, zoomBy,
    setActive(value) {
      active = value;
      if (active) queueRender();
    },
  };
}

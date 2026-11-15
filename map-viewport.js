const width = 900;
const height = 450;
const maxZoom = 64;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function setupMapViewport(svg, controls) {
  let zoom = 1;
  let cx = width / 2;
  let cy = height / 2;
  let frameWidth = width;
  let frameHeight = height;
  let active = true;
  let detailReady = false;
  const pointers = new Map();
  const overview = svg.querySelector('#route-basemap');
  const detail = svg.querySelector('#route-basemap-detail');
  detail.addEventListener('load', () => {
    detailReady = true;
    render();
  });

  function render() {
    const w = frameWidth / zoom;
    const h = frameHeight / zoom;
    cx = w >= width ? width / 2 : clamp(cx, w / 2, width - w / 2);
    cy = h >= height ? height / 2 : clamp(cy, h / 2, height - h / 2);
    svg.setAttribute('viewBox', [cx - w / 2, cy - h / 2, w, h].join(' '));
    svg.style.setProperty('--marker-scale', 1 / zoom);
    svg.classList.toggle('map-close', zoom >= 3);
    if (zoom >= 3 && !detail.hasAttribute('href')) detail.setAttribute('href', './route-land-detail.svg?v=1');
    overview.toggleAttribute('hidden', zoom >= 3 && detailReady);
    detail.toggleAttribute('hidden', zoom < 3);
    if (!active) return;
    controls.value.textContent = number.format(zoom) + '×';
    controls.in.disabled = zoom >= maxZoom;
    controls.out.disabled = zoom <= 1;
    controls.reset.disabled = zoom <= 1;
  }

  function resize() {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    frameWidth = Math.max(width, height * rect.width / rect.height);
    frameHeight = Math.max(height, width * rect.height / rect.width);
    render();
  }

  function reset() {
    zoom = 1;
    cx = width / 2;
    cy = height / 2;
    render();
  }

  function transform(factor, [fromX, fromY] = [0.5, 0.5], [toX, toY] = [fromX, fromY]) {
    const next = clamp(zoom * factor, 1, maxZoom);
    cx += (fromX - 0.5) * frameWidth / zoom - (toX - 0.5) * frameWidth / next;
    cy += (fromY - 0.5) * frameHeight / zoom - (toY - 0.5) * frameHeight / next;
    zoom = next;
    render();
  }

  function fraction(clientX, clientY) {
    const box = svg.getBoundingClientRect();
    return [(clientX - box.left) / box.width, (clientY - box.top) / box.height];
  }

  function gesture() {
    const [a, b] = pointers.values();
    if (!b) return { center: a, distance: 0 };
    return { center: a.map((value, i) => (value + b[i]) / 2),
      distance: Math.hypot((a[0] - b[0]) * frameWidth, (a[1] - b[1]) * frameHeight) };
  }

  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(svg);
  controls.in.addEventListener('click', () => { if (active) transform(1.6); });
  controls.out.addEventListener('click', () => { if (active) transform(1 / 1.6); });
  controls.reset.addEventListener('click', () => { if (active) reset(); });
  svg.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    transform(Math.exp(-clamp(event.deltaY, -160, 160) * 0.009), fraction(event.clientX, event.clientY));
  }, { passive: false });
  svg.addEventListener('dblclick', (event) => transform(1.6, fraction(event.clientX, event.clientY)));
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointers.size >= 2 || event.target.closest('[data-map-action]')) return;
    pointers.set(event.pointerId, fraction(event.clientX, event.clientY));
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('map-grabbing');
  });
  svg.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    const before = gesture();
    pointers.set(event.pointerId, fraction(event.clientX, event.clientY));
    const after = gesture();
    const factor = before.distance && after.distance ? after.distance / before.distance : 1;
    transform(factor, before.center, after.center);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    svg.addEventListener(type, (event) => {
      pointers.delete(event.pointerId);
      if (!pointers.size) svg.classList.remove('map-grabbing');
    });
  }
  svg.addEventListener('keydown', (event) => {
    const directions = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, 0.12], ArrowDown: [0, -0.12] };
    if (directions[event.key]) transform(1, [0.5, 0.5], directions[event.key].map((delta) => 0.5 + delta));
    else if (event.key === '+' || event.key === '=') transform(1.6);
    else if (event.key === '-') transform(1 / 1.6);
    else if (event.key === '0' || event.key === 'Home') reset();
    else return;
    event.preventDefault();
  });

  render();
  return {
    reset,
    setActive(value) {
      active = value;
      if (active) {
        resize();
        render();
      }
    },
    focus(point) {
      zoom = zoom >= 8 ? zoom : 12;
      [cx, cy] = point;
      render();
    },
  };
}

const width = 900;
const height = 450;
const maxZoom = 64;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function setupMapViewport(svg, controls) {
  let zoom = 1;
  let x = 0;
  let y = 0;
  const pointers = new Map();
  const detail = svg.querySelector('#route-basemap-detail');

  function render() {
    x = clamp(x, 0, width - width / zoom);
    y = clamp(y, 0, height - height / zoom);
    svg.setAttribute('viewBox', [x, y, width / zoom, height / zoom].join(' '));
    svg.style.setProperty('--marker-scale', 1 / zoom);
    svg.classList.toggle('map-close', zoom >= 3);
    if (zoom >= 3 && !detail.hasAttribute('href')) detail.setAttribute('href', './route-land-detail.svg?v=1');
    detail.toggleAttribute('hidden', zoom < 3);
    controls.value.textContent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(zoom) + '×';
    controls.in.disabled = zoom >= maxZoom;
    controls.out.disabled = zoom <= 1;
    controls.reset.disabled = zoom <= 1;
  }

  function reset() {
    zoom = 1;
    render();
  }

  function transform(factor, [fromX, fromY] = [0.5, 0.5], [toX, toY] = [fromX, fromY]) {
    const next = clamp(zoom * factor, 1, maxZoom);
    x += fromX * width / zoom - toX * width / next;
    y += fromY * height / zoom - toY * height / next;
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
      distance: Math.hypot((a[0] - b[0]) * width, (a[1] - b[1]) * height) };
  }

  controls.in.addEventListener('click', () => transform(1.6));
  controls.out.addEventListener('click', () => transform(1 / 1.6));
  controls.reset.addEventListener('click', reset);
  svg.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    transform(Math.exp(-clamp(event.deltaY, -160, 160) * 0.009), fraction(event.clientX, event.clientY));
  }, { passive: false });
  svg.addEventListener('dblclick', (event) => transform(1.6, fraction(event.clientX, event.clientY)));
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointers.size >= 2) return;
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
    focus([pointX, pointY]) {
      zoom = zoom >= 8 ? zoom : 12;
      x = pointX - width / zoom / 2;
      y = pointY - height / zoom / 2;
      render();
    },
  };
}

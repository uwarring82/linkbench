import { mapPoint } from './routes.js?v=2';

const viewNames = { local: 'connection', fiber: 'intercontinental', infrastructure: 'infrastructure' };

export function setupAtlas(find, svg, flat, controls) {
  const content = find('route-content');
  const home = content.parentNode;
  const dialog = find('atlas-dialog');
  const launch = find('atlas-launch');
  const close = find('atlas-close');
  const flatButton = find('atlas-flat');
  const sphereButton = find('atlas-sphere');
  const detailsButton = find('atlas-details');
  const frame = find('atlas-map-frame');
  const canvas = find('atlas-globe');
  const status = find('atlas-globe-status');
  const mapHelp = find('map-help');
  const shapes = new WeakMap();
  let projection = '2d';
  let layer = 'local';
  let globe;
  let loading;
  let pendingFocus;

  function writeLocation() {
    const url = new URL(location.href);
    if (dialog.open) {
      url.searchParams.set('atlas', projection);
      url.searchParams.set('view', viewNames[layer]);
    } else {
      url.searchParams.delete('atlas');
    }
    if (url.href !== location.href) history.replaceState(history.state, '', url);
  }

  function showControls(zoom, changed) {
    if (projection !== '3d') return;
    controls.value.textContent = zoom.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '×';
    controls.in.disabled = zoom >= 12;
    controls.out.disabled = zoom <= 1;
    controls.reset.disabled = !changed;
  }

  async function showProjection(value) {
    projection = value;
    const sphere = value === '3d';
    frame.classList.toggle('is-globe', sphere);
    canvas.hidden = !sphere;
    status.hidden = true;
    flat.setActive(!sphere);
    globe?.setActive(sphere);
    flatButton.setAttribute('aria-pressed', !sphere);
    sphereButton.setAttribute('aria-pressed', sphere);
    mapHelp.textContent = sphere
      ? 'Drag or use arrow keys to rotate. Scroll, pinch or use + and − to zoom.'
      : 'Drag or use arrow keys to pan. Pinch or use + and − to zoom.';
    writeLocation();
    if (!sphere || globe) return;

    status.textContent = 'Loading the globe…';
    status.hidden = false;
    controls.in.disabled = controls.out.disabled = controls.reset.disabled = true;
    try {
      loading ??= import('./atlas-globe.js?v=2').then(({ setupGlobe }) => setupGlobe(canvas, svg, shapes, {
        updateZoom: showControls,
        describe(text) {
          canvas.setAttribute('aria-label', 'Interactive world globe. ' + text);
        },
        inspect() {
          if (matchMedia('(max-width: 760px)').matches) setDetails(true);
        },
      }));
      globe = await loading;
      globe.setActive(projection === '3d');
      if (pendingFocus && projection === '3d') globe.focus(...pendingFocus);
      pendingFocus = null;
      status.hidden = true;
    } catch {
      loading = null;
      if (projection !== '3d') return;
      await showProjection('2d');
      status.textContent = 'The globe could not load. You can use the 2D map or retry 3D globe.';
      status.hidden = false;
    }
  }

  function setDetails(open) {
    dialog.classList.toggle('atlas-details-open', open);
    detailsButton.setAttribute('aria-expanded', open);
  }

  function open(view = '2d') {
    if (!dialog.open) {
      dialog.append(content);
      dialog.showModal();
      setDetails(false);
    }
    void showProjection(view);
    (view === '3d' ? sphereButton : flatButton).focus({ preventScroll: true });
  }

  dialog.addEventListener('close', () => {
    home.insertBefore(content, dialog);
    pendingFocus = null;
    void showProjection('2d');
    launch.focus({ preventScroll: true });
  });
  launch.addEventListener('click', () => open());
  close.addEventListener('click', () => dialog.close());
  flatButton.addEventListener('click', () => { void showProjection('2d'); });
  sphereButton.addEventListener('click', () => { void showProjection('3d'); });
  detailsButton.addEventListener('click', () => setDetails(!dialog.classList.contains('atlas-details-open')));
  controls.in.addEventListener('click', () => { if (projection === '3d') globe?.zoomBy(1.5); });
  controls.out.addEventListener('click', () => { if (projection === '3d') globe?.zoomBy(1 / 1.5); });
  controls.reset.addEventListener('click', () => { if (projection === '3d') globe?.reset(); });

  return {
    open,
    setLayer(value) {
      layer = value;
      if (dialog.open) writeLocation();
    },
    track(element, geometry) {
      shapes.set(element, geometry);
      if (!element.hasAttribute('data-atlas-shape')) element.setAttribute('data-atlas-shape', '');
    },
    reset() {
      if (projection === '3d') {
        pendingFocus = null;
        globe?.reset();
      } else flat.reset();
    },
    focus(coords) {
      if (projection === '2d') flat.focus(mapPoint(coords));
      else if (globe) globe.focus(coords, 4);
      else pendingFocus = [coords, 4];
    },
    reveal(coords) {
      if (projection !== '3d') return;
      if (globe) globe.focus(coords);
      else pendingFocus = [coords];
    },
  };
}

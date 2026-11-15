const link = (name, href) => ({ name, href });
const sources = {
  aec: link('EXA Infrastructure · AEC‑1', 'https://www.exainfra.net/'),
  equiano: link('Google · Equiano', 'https://cloud.google.com/blog/products/infrastructure/introducing-equiano-a-subsea-cable-from-portugal-to-south-africa'),
  smw: link('SEA‑ME‑WE 5 system', 'https://www.submarinenetworks.com/en/systems/asia-europe-africa/smw5'),
  asc: link('Vocus · Australia Singapore Cable', 'https://www.vocus.com.au/about-vocus/our-network/international/australia-singapore-cable'),
  decix: link('DE‑CIX · Frankfurt interconnection', 'https://www.de-cix.net/en/locations/frankfurt'),
};

const waypoint = (name, coords, role) => ({ name, coords, role });
const landing = (name, coords) => waypoint(name, coords, 'Cable landing or coastal handoff');
const site = (name, coords) => waypoint(name, coords, 'M‑Lab NDT7 site');
const sites = {
  fra04: site('Frankfurt', [8.57056, 50.0333]),
  lga05: site('New York', [-73.875, 40.775]),
  jnb01: site('Johannesburg', [28.246, -26.1392]),
  sin01: site('Singapore', [103.994, 1.35019]),
  syd03: site('Sydney', [151.177, -33.9461]),
};
const leg = (point, medium = 'Land / regional', publishedKm) => ({ point, medium, publishedKm });
const asia = [
  leg(landing('Toulon area', [5.88, 43.10])),
  leg(landing('Abu Talat', [29.72, 31.08]), 'Mediterranean subsea'),
  leg(landing('Zafarana', [32.66, 29.11]), 'Egypt land crossing'),
  leg(landing('Djibouti area', [43.15, 11.59]), 'Red Sea subsea'),
  leg(landing('Matara area', [80.55, 5.95]), 'Indian Ocean subsea'),
  leg(landing('Tuas', [103.63, 1.30]), 'Southeast Asia subsea'),
];

export const routeModels = {
  fra04: {
    summary: 'A regional terrestrial route via Cologne illustrates how a provider can reach the Frankfurt metro.',
    legs: [leg(waypoint('Cologne', [6.95, 50.93333], 'Possible regional backbone hub')), leg(sites.fra04)],
    sources: [sources.decix],
  },
  lga05: {
    summary: 'A North Atlantic scenario via the AEC‑1 landing points in Ireland and Long Island.',
    legs: [
      leg(waypoint('London', [-0.12574, 51.50853], 'Possible carrier interconnection metro'), 'European backhaul'),
      leg(landing('Killala', [-9.2322, 54.2068]), 'Land and regional crossings'),
      leg(landing('Shirley, NY', [-72.8722, 40.8003]), 'Atlantic subsea · AEC‑1', 5536),
      leg(sites.lga05),
    ],
    sources: [sources.aec],
  },
  jnb01: {
    summary: 'A West African coast scenario, using the Portugal–South Africa corridor documented for Equiano as an infrastructure example.',
    legs: [
      leg(landing('Sesimbra', [-9.1028, 38.4427])),
      leg(waypoint('Offshore West Africa', [-17.5, 9], 'Illustrative offshore waypoint'), 'Atlantic subsea'),
      leg(landing('Melkbosstrand', [18.4458, -33.7272]), 'Atlantic subsea'),
      leg(sites.jnb01),
    ],
    sources: [sources.equiano],
  },
  sin01: {
    summary: 'A Europe–Asia scenario through the Mediterranean, Egypt and Indian Ocean, following the broad SEA‑ME‑WE 5 corridor.',
    legs: [...asia, leg(sites.sin01)],
    sources: [sources.smw],
  },
  syd03: {
    summary: 'An Indian Ocean and Australia scenario via Singapore, Perth and terrestrial backhaul to Sydney.',
    legs: [...asia, leg(landing('Perth area', [115.86, -31.95]), 'Indian Ocean subsea · ASC', 4600), leg(sites.syd03)],
    sources: [sources.smw, sources.asc],
  },
};

export const defaultOrigin = Object.freeze({ name: 'Ruhr region', coords: [7.24, 51.35], role: 'Approximate origin' });
export const fiberIndex = 1.468;
const earthKm = 6371.0088;
const lightKmPerSecond = 299792.458;
const radians = Math.PI / 180;

export function distanceKm([lonA, latA], [lonB, latB]) {
  const a = Math.sin((latB - latA) * radians / 2) ** 2 +
    Math.cos(latA * radians) * Math.cos(latB * radians) * Math.sin((lonB - lonA) * radians / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
}

export function estimateRoute(model, origin = defaultOrigin) {
  const end = model.legs.at(-1).point;
  const directKm = distanceKm(origin.coords, end.coords);
  const legs = model.legs.map((segment, index) => {
    const from = index ? model.legs[index - 1].point : origin;
    const geographicKm = distanceKm(from.coords, segment.point.coords);
    return { ...segment, from, geographicKm, km: segment.publishedKm ?? geographicKm };
  });
  return { directKm, legs, corridorKm: legs.reduce((total, segment) => total + segment.km, 0) };
}

export function fiberRttMs(km) {
  return 2000 * km * fiberIndex / lightKmPerSecond;
}

function cartesian([lon, lat]) {
  return [Math.cos(lat * radians) * Math.cos(lon * radians),
    Math.cos(lat * radians) * Math.sin(lon * radians), Math.sin(lat * radians)];
}

function arc(from, to) {
  const angle = distanceKm(from, to) / earthKm;
  if (angle < 1e-8 || Math.PI - angle < 1e-8) return [from, to];
  const a = cartesian(from);
  const b = cartesian(to);
  const steps = Math.max(8, Math.ceil(angle * 48));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const ratio = i / steps;
    const wa = Math.sin((1 - ratio) * angle);
    const wb = Math.sin(ratio * angle);
    const [x, y, z] = a.map((value, index) => wa * value + wb * b[index]);
    return [Math.atan2(y, x) / radians, Math.atan2(z, Math.hypot(x, y)) / radians];
  });
}

export function mapPoint([lon, lat]) {
  return [(lon + 180) * 2.5, (90 - lat) * 2.5];
}

export function mapPath(points) {
  return mapPolyline(points.slice(1).flatMap((to, index) => arc(points[index], to).slice(index ? 1 : 0)));
}

export function mapPolyline(route) {
  return route.reduce((path, point, index) => {
    const [x, y] = mapPoint(point);
    const formatted = x.toFixed(2) + ' ' + y.toFixed(2);
    const previous = route[index - 1];
    if (!previous) return 'M' + formatted;
    const [oldX, oldY] = mapPoint(previous);
    if (Math.abs(oldX - x) <= 450) return path + 'L' + formatted;
    if (Math.abs(oldX - x) === 900) return path + 'M' + formatted;
    const edge = oldX > x ? 900 : 0;
    const otherEdge = 900 - edge;
    const ratio = (edge - oldX) / ((x + edge - otherEdge) - oldX);
    const crossing = (oldY + ratio * (y - oldY)).toFixed(2);
    return path + 'L' + edge + ' ' + crossing + 'M' + otherEdge + ' ' + crossing + 'L' + formatted;
  }, '');
}

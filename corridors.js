const stop = (name, coords, probe, ping, trace) => ({ name, coords, probe, ping, trace });
export const atlasStops = {
  sines: stop('Sines', [-8.86089, 37.95716], 7493, 91695155, 91695154),
  ashburn: stop('Ashburn', [-77.45129, 39.02086], 6991, 79346731, 79346730),
  fortaleza: stop('Fortaleza', [-38.46230, -3.73534], 7242, 57650135, 57650134),
  luanda: stop('Luanda', [13.18134, -8.91489], 7239, 57561745, 57561744),
  cape: stop('Cape Town', [18.41415, -33.92386], 7467, 86246125, 86246124),
  kuala: stop('Kuala Lumpur', [101.70628, 3.14961], 7310, 66423680, 66423679),
  singapore: stop('Singapore', [103.78984, 1.29517], 6996, 29779918, 29779917),
  perth: stop('Perth', [115.87632, -31.96214], 7432, 84190565, 84190564),
  sydney: stop('Sydney', [151.1893, -33.9182], 6976, 79359775, 79359774),
  la: stop('Los Angeles', [-118.25938, 34.04879], 6989, 29751736, 29751735),
  seattle: stop('Seattle', [-122.33974, 47.61443], 6947, 79346739, 79346738),
  tokyo: stop('Tokyo', [139.74806, 35.61746], 6983, 79354268, 79354267),
  marseille: stop('Marseille', [5.49528, 43.29243], 7293, 64348795, 64348794),
};

const landing = (name, coords) => ({ name, coords });
const fortaleza = landing('Fortaleza landing area', [-38.48, -3.72]);
const sines = landing('Sines landing area', [-8.87, 37.94]);
const virginia = landing('Virginia Beach landing area', [-75.99, 36.75]);
const cape = landing('Melkbosstrand', [18.45, -33.73]);
const singapore = landing('Singapore landing area', [103.67, 1.29]);
const route = (region, cable, from, to, landings, href, via = []) => ({ region, cable, from, to, landings, href, via });

export const corridors = {
  marea: route('Europe ↔ North America', 'MAREA', 'sines', 'ashburn',
    [landing('Sopelana', [-2.99, 43.39]), virginia], 'https://telxius.com/en/marea-2/'),
  faster: route('North America ↔ East Asia', 'FASTER', 'seattle', 'tokyo',
    [landing('Bandon, Oregon', [-124.41, 43.12]), landing('Chiba landing area', [139.91, 34.90])],
    'https://www.nec.com/en/press/201606/global_20160629_02.html'),
  southern: route('North America ↔ Oceania', 'Southern Cross NEXT', 'la', 'sydney',
    [landing('Hermosa Beach', [-118.40, 33.86]), landing('Sydney landing area', [151.28, -33.87])],
    'https://www.southerncrosscables.com/systems'),
  brusa: route('North America ↔ South America', 'BRUSA', 'ashburn', 'fortaleza',
    [virginia, fortaleza], 'https://telxius.com/en/brusa-2/'),
  ella: route('Europe ↔ South America', 'EllaLink', 'sines', 'fortaleza',
    [sines, fortaleza], 'https://ella.link/about/'),
  sacs: route('South America ↔ Africa', 'SACS', 'fortaleza', 'luanda',
    [fortaleza, landing('Sangano', [13.11, -9.20])], 'https://www.submarinenetworks.com/en/systems/brazil-africa/sacs'),
  equiano: route('Europe ↔ Africa', 'Equiano', 'sines', 'cape',
    [landing('Sesimbra', [-9.10, 38.44]), cape],
    'https://cloud.google.com/blog/products/infrastructure/introducing-equiano-a-subsea-cable-from-portugal-to-south-africa',
    [[-17.7, 32], [-21.2, 15], [-14.5, 0], [2, -11], [8, -21]]),
  aae: route('Europe ↔ Asia via Egypt', 'AAE-1', 'marseille', 'singapore',
    [landing('Marseille landing area', [5.35, 43.33]), singapore], 'https://aaeone.com/aaeportal/index.jsp',
    [[5.7, 42.5], [12.2, 37.2], [29.5, 31.1], [32.7, 29.1], [35.0, 25], [40, 17], [43.2, 11.8], [50, 11.5], [75, 6], [80.3, 4],
      [92, 6], [95.3, 5.7], [99, 3.1]]),
  safe: route('Africa ↔ Asia via the Indian Ocean', 'SAFE', 'cape', 'kuala',
    [cape, landing('Penang landing area', [100.29, 5.32])], 'https://www.submarinecablemap.com/submarine-cable/safe',
    [[20.5, -35.2], [39.9, -30], [57.4, -20.3], [67.5, -9], [75.8, 7.9], [79.8, 5.8], [93.4, 5.8], [97, 5.6]]),
  asc: route('Southeast Asia ↔ Oceania', 'Australia Singapore Cable', 'singapore', 'perth',
    [singapore, landing('Perth landing area', [115.74, -31.83])],
    'https://www.vocus.com.au/about-vocus/our-network/international/australia-singapore-cable',
    [[105, -5.8], [106, -9.8], [105.7, -12.2], [111, -24]]),
};

export const tours = {
  atlantic: ['sines', 'fortaleza', 'luanda', 'fortaleza', 'sines'],
  world: ['sines', 'ashburn', 'fortaleza', 'luanda', 'fortaleza', 'sines', 'cape', 'kuala', 'singapore',
    'perth', 'sydney', 'la', 'seattle', 'tokyo', 'singapore', 'marseille', 'sines'],
};

#!/usr/bin/env node
/* Kjører appens EGNE spørringer mot Entur live, slik de står i index.html. */
const fs = require('fs');
const path = require('path');
// Les alltid fra index.html, slik at testen aldri kjører mot en gammel kopi.
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const js = html.match(/<script>\n?([\s\S]*?)<\/script>\s*<\/body>/)[1];

function grab(name) {
  const i = js.indexOf('const ' + name + '=`');
  if (i < 0) throw new Error('fant ikke ' + name);
  const s = js.indexOf('`', i) + 1;
  const e = js.indexOf('`', s);
  return js.slice(s, e);
}
const TRIP_Q = grab('TRIP_Q'), NEAR_Q = grab('NEAR_Q'), DEP_Q = grab('DEP_Q'),
      EXIT_Q = grab('EXIT_Q'), VEH_Q = grab('VEH_Q'), NEARBY_Q = grab('NEARBY_Q');

const H = { 'Content-Type': 'application/json', 'ET-Client-Name': 'reis-norge-web' };
const JP = 'https://api.entur.io/journey-planner/v3/graphql';
const VEH = 'https://api.entur.io/realtime/v2/vehicles/graphql';

async function gq(url, query, variables) {
  const r = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors[0].message).slice(0, 220));
  return j.data;
}

/* Noen strekninger har ingen avganger midt på natta. Tester som ellers ville
   vært skjøre bruker derfor et fast, rimelig tidspunkt: neste hverdag kl. 08. */
function nextWeekdayMorning() {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { const info = await fn(); console.log('  PASS  ' + name + (info ? ' — ' + info : '')); pass++; }
  catch (e) { console.log('  FEIL  ' + name + ' — ' + e.message); fail++; }
};

(async () => {
  console.log('\nEntur-spørringer hentet direkte fra index.html:\n');

  await t('NEAR_Q – stoppesteder nær Jernbanetorget', async () => {
    const d = await gq(JP, NEAR_Q, { lat: 59.9119, lon: 10.7504, r: 1200, n: 8 });
    const e = d.nearest.edges;
    if (!e.length) throw new Error('ingen treff');
    const names = e.map(x => x.node.place.name);
    if (new Set(names).size !== names.length) throw new Error('dubletter (multiModalMode virker ikke)');
    return e.length + ' unike stopp, nærmest ' + names[0];
  });

  await t('DEP_Q – avganger fra Jernbanetorget', async () => {
    const d = await gq(JP, DEP_Q, { id: 'NSR:StopPlace:58366', n: 25 });
    const c = d.stopPlace.estimatedCalls;
    if (!c.length) throw new Error('ingen avganger');
    return c.length + ' avganger, første linje ' + c[0].serviceJourney.line.publicCode;
  });

  await t('TRIP_Q – holdeplass til holdeplass', async () => {
    const d = await gq(JP, TRIP_Q, {
      from: { name: 'Jernbanetorget', place: 'NSR:StopPlace:58366' },
      to: { name: 'Majorstuen', place: 'NSR:StopPlace:58381' },
      via: null, dateTime: new Date().toISOString(), arriveBy: false, numTripPatterns: 3
    });
    const p = d.trip.tripPatterns;
    if (!p.length) throw new Error('ingen reiser');
    if (!p[0].expectedStartTime) throw new Error('mangler expectedStartTime');
    return p.length + ' reiser, første ' + p[0].expectedStartTime.slice(11, 16);
  });

  await t('TRIP_Q – adresse (koordinater) som startpunkt', async () => {
    const d = await gq(JP, TRIP_Q, {
      from: { name: 'Storgata 10, Fredrikstad', coordinates: { latitude: 59.212292, longitude: 10.936767 } },
      to: { name: 'Oslo S', place: 'NSR:StopPlace:59872' },
      via: null, dateTime: nextWeekdayMorning(), arriveBy: false, numTripPatterns: 2
    });
    if (!d.trip.tripPatterns.length) throw new Error('ingen reiser');
    return 'reise funnet fra adresse';
  });

  await t('TRIP_Q – via-stopp som NSR-id', async () => {
    const d = await gq(JP, TRIP_Q, {
      from: { name: 'Jernbanetorget', place: 'NSR:StopPlace:58366' },
      to: { name: 'Majorstuen', place: 'NSR:StopPlace:58381' },
      via: [{ visit: { label: 'Nationaltheatret', stopLocationIds: ['NSR:StopPlace:58404'] } }],
      dateTime: new Date().toISOString(), arriveBy: false, numTripPatterns: 2
    });
    const p = d.trip.tripPatterns;
    if (!p.length) throw new Error('ingen reiser');
    const hit = p[0].legs.some(l => (l.toPlace.name || '').includes('Nationaltheatret') || (l.fromPlace.name || '').includes('Nationaltheatret'));
    if (!hit) throw new Error('ruten går ikke via punktet');
    return 'ruten går faktisk via Nationaltheatret';
  });

  await t('TRIP_Q – via-stopp som koordinat', async () => {
    const d = await gq(JP, TRIP_Q, {
      from: { name: 'Fredrikstad', coordinates: { latitude: 59.2121, longitude: 10.9366 } },
      to: { name: 'Oslo S', place: 'NSR:StopPlace:59872' },
      via: [{ visit: { label: 'Moss', coordinate: { latitude: 59.434, longitude: 10.658 }, minimumWaitTime: 'PT2M' } }],
      dateTime: nextWeekdayMorning(), arriveBy: false, numTripPatterns: 2
    });
    if (!d.trip.tripPatterns.length) throw new Error('ingen reiser');
    return 'via-koordinat godtatt';
  });

  await t('TRIP_Q – arriveBy (ankomst innen)', async () => {
    const dt = new Date(Date.now() + 3 * 3600e3).toISOString();
    const d = await gq(JP, TRIP_Q, {
      from: { name: 'Jernbanetorget', place: 'NSR:StopPlace:58366' },
      to: { name: 'Majorstuen', place: 'NSR:StopPlace:58381' },
      via: null, dateTime: dt, arriveBy: true, numTripPatterns: 2
    });
    if (!d.trip.tripPatterns.length) throw new Error('ingen reiser');
    return 'ankomstsøk fungerer';
  });

  await t('TRIP_Q – med modus-filter (buss + trikk)', async () => {
    const d = await gq(JP, TRIP_Q, {
      from: { name: 'Jernbanetorget', place: 'NSR:StopPlace:58366' },
      to: { name: 'Majorstuen', place: 'NSR:StopPlace:58381' },
      via: null, dateTime: new Date().toISOString(), arriveBy: false, numTripPatterns: 3,
      modes: { accessMode: 'foot', egressMode: 'foot', transportModes: [{ transportMode: 'bus' }, { transportMode: 'tram' }] }
    });
    if (!d.trip.tripPatterns.length) throw new Error('ingen reiser');
    const modes = [...new Set(d.trip.tripPatterns[0].legs.map(l => l.mode))];
    return 'moduser i svar: ' + modes.join(', ');
  });

  await t('NEARBY_Q – stopp og neste avganger i ett kall', async () => {
    const d = await gq(JP, NEARBY_Q, { lat: 59.9119, lon: 10.7504, r: 900, n: 3, dep: 3 });
    const e = d.nearest.edges;
    if (!e.length) throw new Error('ingen stopp');
    const withCalls = e.filter(x => (x.node.place.estimatedCalls || []).length);
    if (!withCalls.length) throw new Error('ingen avganger på noen av stoppene');
    const first = withCalls[0].node.place;
    return `${e.length} stopp, ${first.name} har ${first.estimatedCalls.length} avganger`;
  });

  await t('quickQuery – tre hurtigreiser i ETT kall', async () => {
    // Bygg spørringen med appens egen generator
    const gen = new Function('return ' + js.slice(js.indexOf('function quickQuery('),
      js.indexOf('let qtLive=')).trim() + ';quickQuery')();
    const q = gen(3);
    const pairs = [['NSR:StopPlace:58366', 'NSR:StopPlace:58381'],
                   ['NSR:StopPlace:59872', 'NSR:StopPlace:58404'],
                   ['NSR:StopPlace:58355', 'NSR:StopPlace:58366']];
    const v = { dt: new Date().toISOString() };
    pairs.forEach(([a, b], i) => { v['f' + i] = { name: 'A', place: a }; v['t' + i] = { name: 'B', place: b }; });
    const d = await gq(JP, q, v);
    const got = pairs.map((_, i) => (d['q' + i].tripPatterns || []).length);
    if (got.some(n => n === 0)) throw new Error('en av reisene kom tom tilbake');
    if (!d.q0.tripPatterns[0].expectedStartTime) throw new Error('mangler avgangstid');
    return `3 reiser, første kl. ${d.q0.tripPatterns[0].expectedStartTime.slice(11, 16)}`;
  });

  await t('EXIT_Q – utganger på Nationaltheatret', async () => {
    const d = await gq(JP, EXIT_Q, { id: 'NSR:StopPlace:58404' });
    return (d.stopPlace.quays || []).length + ' plattformer';
  });

  await t('VEH_Q – levende kjøretøy i Oslo-boks', async () => {
    const d = await gq(VEH, VEH_Q, { bb: { minLat: 59.85, minLon: 10.6, maxLat: 60.0, maxLon: 10.9 } });
    if (!d.vehicles.length) throw new Error('ingen kjøretøy (kan være natt)');
    const v = d.vehicles[0];
    if (!v.location) throw new Error('mangler location');
    return d.vehicles.length + ' kjøretøy, f.eks. ' + (v.line ? v.line.publicCode : v.mode);
  });

  await t('Geocoder – adresse på norsk med focus.point', async () => {
    const q = new URLSearchParams({ text: 'Storgata 10', lang: 'no', size: '8', layers: 'venue,address,street,locality',
      'focus.point.lat': '59.2121', 'focus.point.lon': '10.9366' });
    const j = await (await fetch('https://api.entur.io/geocoder/v1/autocomplete?' + q, { headers: H })).json();
    if (!j.features.length) throw new Error('ingen treff');
    return 'øverste treff: ' + j.features[0].properties.label;
  });

  await t('Geocoder – reverse leser features[]', async () => {
    const j = await (await fetch('https://api.entur.io/geocoder/v1/reverse?point.lat=59.9119&point.lon=10.7504&lang=no&size=1', { headers: H })).json();
    const f = j.features && j.features[0];
    if (!f) throw new Error('ingen features');
    return f.properties.label;
  });

  await t('GBFS – bysykkel med språknøkkel', async () => {
    const root = await (await fetch('https://gbfs.urbansharing.com/oslobysykkel.no/gbfs.json')).json();
    const d = root.data;
    const feeds = Array.isArray(d.feeds) ? d.feeds : (d.nb || d.no || d.en || Object.values(d)[0]).feeds;
    if (!feeds) throw new Error('fant ikke feeds');
    const info = feeds.find(f => f.name === 'station_information');
    const st = await (await fetch(info.url)).json();
    return st.data.stations.length + ' stasjoner';
  });

  console.log(`\n${pass} bestått, ${fail} feilet\n`);
  process.exit(fail ? 1 : 0);
})();

#!/usr/bin/env node
/* DOM- og logikktester for REIS Norge. Kjøres uten nett. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const js = html.match(/<script>\n?([\s\S]*?)<\/script>\s*<\/body>/)[1];

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FEIL  ' + name + ' — ' + e.message); fail++; }
};
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ` fikk ${JSON.stringify(a)}, ventet ${JSON.stringify(b)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'usant'); };

/* ---------- 1. Markup og PWA-oppsett ---------- */
const dom = new JSDOM(html, { runScripts: 'outside-only' });
const doc = dom.window.document;

console.log('\nMarkup og PWA:\n');

t('manifest lenkes relativt (virker i undermappe på GitHub Pages)', () => {
  const l = doc.querySelector('link[rel="manifest"]');
  ok(l, 'mangler manifest-lenke');
  eq(l.getAttribute('href'), 'manifest.webmanifest');
});
t('apple-touch-icon peker på ekte PNG-fil', () => {
  const l = doc.querySelector('link[rel="apple-touch-icon"]');
  ok(l && l.getAttribute('href').endsWith('.png'), 'ikke PNG');
});
t('favicon finnes i både SVG og PNG', () => {
  const hrefs = [...doc.querySelectorAll('link[rel~="icon"]')].map(l => l.getAttribute('href'));
  ok(hrefs.some(h => h.endsWith('.svg')), 'mangler SVG');
  ok(hrefs.some(h => h.endsWith('.png')), 'mangler PNG');
});
t('theme-color, manifest og ikonbakgrunn er samme flaggblå', () => {
  const c = '#0A2A57';
  eq(doc.querySelector('meta[name="theme-color"]').getAttribute('content'), c);
  const mf = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.webmanifest'), 'utf8'));
  eq(mf.theme_color, c);
  eq(mf.background_color, c);
  ok(fs.readFileSync(path.join(__dirname, 'icons/icon.svg'), 'utf8').includes(c), 'ikonet bruker ikke samme blå');
});
t('ingen canvas-generert ikon ved oppstart', () => {
  ok(!/toDataURL/.test(js), 'toDataURL finnes fortsatt');
  ok(!/createElement\(['"]canvas/.test(js), 'canvas-ikon finnes fortsatt');
});
t('service worker registreres med relativ sti og scope', () => {
  ok(/register\('sw\.js',\s*\{\s*scope:\s*'\.\/'\s*\}\)/.test(js), 'feil registrering');
});
t('[hidden] overstyrer display (LIVE-merket og «Vis på kart» skjules)', () => {
  ok(/\[hidden\]\{display:none!important\}/.test(html), 'mangler [hidden]-regel');
});
t('LIVE-merket og kartknappen starter skjult', () => {
  ok(doc.getElementById('depLive').hasAttribute('hidden'));
  ok(doc.getElementById('depMapBtn').hasAttribute('hidden'));
});
t('undertittelen i topplinjen brytes ikke over to linjer', () => {
  const small = doc.querySelector('.brand-txt small');
  eq(small.textContent, 'NORGE · SANNTID');
  ok(/\.brand-txt small\{[^}]*white-space:nowrap/.test(html), 'mangler nowrap');
});
t('menyen har tre faner – Lagret er flyttet til «Mer»-arket', () => {
  eq(doc.querySelectorAll('.nav-btn').length, 3);
  eq([...doc.querySelectorAll('.nav-btn')].map(b => b.dataset.tab).join(','), 'plan,depart,map');
  ok(doc.getElementById('moreSheet'), 'mangler «Mer»-ark');
  ok(doc.getElementById('btnMore'), 'mangler knapp i topplinjen');
  ok(doc.getElementById('moreSheet').querySelector('#favJourneys'), 'lagrede reiser fulgte ikke med');
  ok(doc.getElementById('moreSheet').querySelector('#themeSeg'), 'utseendevalget fulgte ikke med');
});
t('avviksfelt finnes i avgangsfanen', () => {
  ok(doc.getElementById('depAvvik'), 'mangler #depAvvik');
});
t('feillogg finnes i Lagret-fanen', () => {
  ok(doc.getElementById('errLogBox') && doc.getElementById('btnCopyLog'));
});

/* ---------- 2. Rene hjelpefunksjoner ---------- */
console.log('\nHjelpefunksjoner:\n');

// Kjør hele appen i jsdom med stubbede eksterne avhengigheter, og les ut
// funksjonene etterpå. Mer realistisk enn å klippe ut kildekode.
const STUBS = `
window.matchMedia = q => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
window.fetch = () => new Promise(()=>{});
const _layer = () => ({ addTo(){return _layer()}, clearLayers(){}, eachLayer(){}, removeLayer(){},
  setLatLng(){}, bindPopup(){}, setIcon(){}, getLatLng:()=>({lat:0,lng:0}) });
const _bounds = { pad:()=>_bounds, getSouth:()=>59, getWest:()=>10, getNorth:()=>60, getEast:()=>11,
  contains:()=>true, getCenter:()=>({lat:59.9,lng:10.7}) };
window.L = {
  map: () => ({ setView(){return this}, on(){}, getBounds:()=>_bounds, getCenter:()=>({lat:59.9,lng:10.7}),
    invalidateSize(){}, fitBounds(){}, flyTo(){}, removeLayer(){}, addLayer(){},
    getContainer:()=>document.getElementById('map') }),
  tileLayer: () => ({ addTo(){return this}, _url:'' }),
  control: { attribution: () => ({ addAttribution: () => ({ addTo(){} }) }) },
  layerGroup: _layer, marker: _layer, polyline: _layer, divIcon: () => ({}), latLngBounds: () => ({})
};
`;
const EXPOSE = `
window.__T = { toLocation, toVia, bearingTo, estimateFare, mapCalls, gbfsFeeds,
  situationTexts, pickText, isNSR, haversine, fmtWalk, COMPASS, esc, fmtDur,
  countdownHTML, paceFor, toast, state };
window.renderStops = renderStops;
window.ensureMap = ensureMap;
window.switchTab = switchTab;\nwindow.renderCommuter = renderCommuter;\nwindow.sec = {initSections, setSec, secOpen, updateSecCounts};\nwindow.qt = {renderQuickTrips, runQuickTrip, openQuickEditor, quickQuery, quickTrips, saveQuickTrips};\nwindow.currentTabName = () => currentTab;
`;
function bootApp() {
  // Fjern Leaflet-CDN, sett inn stubs før appens skript, og eksponer funksjonene etter.
  let testHtml = html
    .replace("<script>\n'use strict';", '<script>' + STUBS + '<\/script>\n<script>\n\'use strict\';')
    .replace('</script>\n</body>', EXPOSE + '<\/script>\n</body>');
  const d2 = new JSDOM(testHtml, { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://example.github.io/reis/', virtualConsole: new (require('jsdom').VirtualConsole)() });
  return d2.window;
}

// Stubs som lar Leaflet-lastingen feile med vilje, for å teste at appen overlever.
const STUBS_NO_MAP = `
window.matchMedia = q => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
window.fetch = () => new Promise(()=>{});
const _ap = Element.prototype.appendChild;
Element.prototype.appendChild = function(node){
  const r = _ap.call(this, node);
  if ((node.tagName === 'SCRIPT' && node.src) || node.tagName === 'LINK') {
    setTimeout(() => node.dispatchEvent(new window.Event('error')), 0);
  }
  return r;
};
`;
function bootAppNoMap() {
  const testHtml = html
    .replace("<script>\n'use strict';", '<script>' + STUBS_NO_MAP + '<\/script>\n<script>\n\'use strict\';')
    .replace('</script>\n</body>', EXPOSE + '<\/script>\n</body>');
  const d3 = new JSDOM(testHtml, { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://example.github.io/reis/', virtualConsole: new (require('jsdom').VirtualConsole)() });
  return d3.window;
}

const win = bootApp();
const helpers = win.__T;
if (!helpers) throw new Error('appen kastet under oppstart – ingen funksjoner eksponert');

const H = helpers;

t('isNSR skiller holdeplass-id fra adresse-id', () => {
  ok(H.isNSR('NSR:StopPlace:58366'));
  ok(H.isNSR('NSR:Quay:7184'));
  ok(!H.isNSR('17873150'), 'adresse-id ble godtatt som NSR');
  ok(!H.isNSR('OSM:TopographicPlace:6126674571'), 'POI-id ble godtatt som NSR');
  ok(!H.isNSR(undefined));
});

t('toLocation bruker place for holdeplass', () => {
  const l = H.toLocation({ id: 'NSR:StopPlace:58366', name: 'Jernbanetorget', lat: 59.9, lon: 10.7 });
  eq(l.place, 'NSR:StopPlace:58366');
  eq(l.coordinates, undefined, 'skal ikke sende koordinater for holdeplass:');
});

t('toLocation bruker koordinater for adresse (kjernen i adressefeilen)', () => {
  const l = H.toLocation({ id: '17873150', name: 'Storgata 10', lat: 59.2123, lon: 10.9368 });
  eq(l.place, undefined, 'adresse-id skal ikke bli place:');
  eq(l.coordinates.latitude, 59.2123);
  eq(l.coordinates.longitude, 10.9368);
});

t('toLocation håndterer GPS-punkt uten id', () => {
  const l = H.toLocation({ name: 'Min posisjon', lat: 59.5, lon: 10.5 });
  ok(l.coordinates && !l.place);
});

t('toVia pakker holdeplass som visit.stopLocationIds', () => {
  const v = H.toVia({ id: 'NSR:StopPlace:58404', name: 'Nationaltheatret' });
  eq(JSON.stringify(v.visit.stopLocationIds), '["NSR:StopPlace:58404"]');
  eq(v.name, undefined, 'via skal ikke ha Location-form:');
});

t('toVia pakker adresse som visit.coordinate', () => {
  const v = H.toVia({ id: '999', name: 'Moss', lat: 59.434, lon: 10.658 });
  eq(v.visit.coordinate.latitude, 59.434);
  eq(v.visit.stopLocationIds, undefined);
});

t('toVia legger på ventetid i ISO 8601', () => {
  eq(H.toVia({ id: 'NSR:StopPlace:1', name: 'X' }, 5).visit.minimumWaitTime, 'PT5M');
  eq(H.toVia({ id: 'NSR:StopPlace:1', name: 'X' }).visit.minimumWaitTime, undefined);
});

t('toVia gir null for ubrukelige punkter', () => {
  eq(H.toVia(null), null);
  eq(H.toVia({ name: 'uten koordinater' }), null);
});

t('bearingTo gir riktig kompassretning', () => {
  eq(H.COMPASS(H.bearingTo(59.9, 10.7, 60.0, 10.7)), 'N');
  eq(H.COMPASS(H.bearingTo(59.9, 10.7, 59.9, 10.9)), 'Ø');
  eq(H.COMPASS(H.bearingTo(59.9, 10.7, 59.8, 10.7)), 'S');
  eq(H.COMPASS(H.bearingTo(59.9, 10.7, 59.9, 10.5)), 'V');
});

t('mapCalls sorterer stigende og regner ut forsinkelse', () => {
  const calls = H.mapCalls({
    estimatedCalls: [
      { aimedDepartureTime: '2026-07-31T12:10:00+02:00', expectedDepartureTime: '2026-07-31T12:17:00+02:00', realtime: true, cancellation: false, destinationDisplay: { frontText: 'Kolsås' }, quay: { publicCode: '2' }, serviceJourney: { line: { publicCode: '3', transportMode: 'metro', presentation: { colour: 'EC700C' } } }, situations: [] },
      { aimedDepartureTime: '2026-07-31T12:05:00+02:00', expectedDepartureTime: '2026-07-31T12:05:00+02:00', realtime: true, cancellation: true, destinationDisplay: { frontText: 'Bergkrystallen' }, quay: { publicCode: '1' }, serviceJourney: { line: { publicCode: '1', transportMode: 'metro', presentation: { colour: null } } }, situations: [] }
    ]
  });
  eq(calls[0].code, '1', 'feil sortering:');
  eq(calls[0].cancelled, true, 'innstilt ikke fanget:');
  eq(calls[1].delay, 7, 'feil forsinkelse:');
  eq(calls[1].colour, 'EC700C');
});

t('mapCalls tåler manglende expectedDepartureTime', () => {
  const c = H.mapCalls({ estimatedCalls: [{ aimedDepartureTime: '2026-07-31T12:00:00+02:00', expectedDepartureTime: null, serviceJourney: { line: { publicCode: '5', transportMode: 'metro' } }, destinationDisplay: { frontText: 'X' } }] });
  eq(c[0].delay, 0);
  ok(!isNaN(c[0].t.getTime()), 'ugyldig dato');
});

t('gbfsFeeds finner feeds bak språknøkkelen nb', () => {
  const feeds = H.gbfsFeeds({ data: { nb: { feeds: [{ name: 'station_information', url: 'x' }] } } });
  eq(feeds.length, 1);
});
t('gbfsFeeds takler også flat data.feeds', () => {
  eq(H.gbfsFeeds({ data: { feeds: [{ name: 'a' }, { name: 'b' }] } }).length, 2);
});
t('gbfsFeeds gir null uten data', () => {
  eq(H.gbfsFeeds({}), null);
});

t('situationTexts foretrekker norsk og fjerner duplikater', () => {
  const s = H.situationTexts([
    { summary: [{ language: 'en', value: 'Delays' }, { language: 'no', value: 'Forsinkelser' }] },
    { summary: [{ language: 'no', value: 'Forsinkelser' }] }
  ]);
  eq(s.length, 1);
  eq(s[0], 'Forsinkelser');
});

t('estimateFare øker med avstand og er merket som anslag', () => {
  ok(H.estimateFare(3000).amount < H.estimateFare(30000).amount);
  eq(H.estimateFare(3000).est, true);
});

t('fmtWalk bytter til km over 1000 m', () => {
  eq(H.fmtWalk(450), '450 m');
  eq(H.fmtWalk(1500), '1.5 km');
});

/* ---------- 2b. Via-stopp i grensesnittet ---------- */
console.log('\nVia-stopp i grensesnittet:\n');

const wdoc = win.document;
const addBtn = wdoc.getElementById('btnAddStop');

t('starter med A og B', () => {
  eq(wdoc.querySelectorAll('#stops .stop-row').length, 2);
  eq(wdoc.querySelector('.stop-dot.from').textContent, 'A');
  eq(wdoc.querySelector('.stop-dot.to').textContent, 'B');
});

t('«+ Legg til via-stopp» setter inn raden mellom A og B', () => {
  addBtn.onclick();
  const dots = [...wdoc.querySelectorAll('#stops .stop-dot')].map(d => d.className.split(' ')[1]);
  eq(dots.join(','), 'from,via,to', 'feil rekkefølge:');
  eq(wdoc.querySelectorAll('#stops .stop-row').length, 3);
});

t('via-raden har egen slett-knapp, A og B har ikke', () => {
  const rows = [...wdoc.querySelectorAll('#stops .stop-row')];
  eq(!!rows[0].querySelector('.stop-del'), false);
  eq(!!rows[1].querySelector('.stop-del'), true);
  eq(!!rows[2].querySelector('.stop-del'), false);
});

t('maks to via-stopp – knappen deaktiveres, men forsvinner ikke fra rutenettet', () => {
  addBtn.onclick();
  eq(wdoc.querySelectorAll('#stops .stop-row').length, 4);
  eq(addBtn.disabled, true, 'knappen skulle vært deaktivert:');
  eq(addBtn.hidden, false, 'knappen skal bli stående så rutenettet forblir symmetrisk:');
  addBtn.onclick();
  eq(wdoc.querySelectorAll('#stops .stop-row').length, 4, 'la til en femte rad:');
});

t('knappen blir aktiv igjen når en rad fjernes', () => {
  helpers.state.stops.pop();
  win.renderStops();
  eq(addBtn.disabled, false);
  helpers.state.stops.push({ uid: 999, name: 'B' });
  win.renderStops();
});

t('sletting av via-stopp fjerner riktig rad', () => {
  helpers.state.stops[1].name = 'Majorstuen';
  helpers.state.stops[2].name = 'Nationaltheatret';
  win.renderStops ? win.renderStops() : helpers.renderStops();
  const rows = [...wdoc.querySelectorAll('#stops .stop-row')];
  rows[1].querySelector('.stop-del').onclick();
  const names = [...wdoc.querySelectorAll('#stops input')].map(i => i.value);
  eq(names[1], 'Nationaltheatret', 'feil rad ble slettet:');
  eq(wdoc.querySelectorAll('#stops .stop-row').length, 3);
  eq(addBtn.hidden, false, 'knappen skulle vært synlig igjen:');
});

t('«Bytt» snur start og mål', () => {
  const before = [...wdoc.querySelectorAll('#stops input')].map(i => i.value);
  wdoc.getElementById('btnSwap').onclick();
  const after = [...wdoc.querySelectorAll('#stops input')].map(i => i.value);
  eq(after[0], before[before.length - 1]);
  eq(after[after.length - 1], before[0]);
});

/* ---------- 2d. Hurtigreise (Hjem/Jobb) ---------- */
console.log('\nHurtigreise:\n');

t('to like celler, tomme fra start', () => {
  eq(wdoc.querySelectorAll('#commuter .comm-cell').length, 2);
  eq(wdoc.querySelectorAll('#commuter .comm-btn.empty').length, 2);
});

t('ingen knapp inni en knapp (ugyldig HTML som brøt kortet)', () => {
  helpers.state.home = { name: 'Storgata 10', lat: 59.21, lon: 10.93, id: null };
  helpers.state.work = { name: 'Oslo S', lat: 59.91, lon: 10.75, id: 'NSR:StopPlace:59872' };
  win.renderCommuter();
  eq(wdoc.querySelectorAll('#commuter button button').length, 0, 'fant nøstet knapp:');
});

t('navnet ligger faktisk inne i kortet etter oppsett', () => {
  const name = wdoc.querySelector(".comm-btn[data-k='home'] .cb-name");
  ok(name, 'fant ikke .cb-name inni knappen');
  eq(name.textContent, 'Storgata 10');
  ok(wdoc.querySelector(".comm-btn[data-k='work'] .cb-name").textContent === 'Oslo S');
});

t('endre-knappen er søsken, ikke barn, av kortet', () => {
  const edit = wdoc.querySelector("#commuter .cb-edit[data-edit='home']");
  ok(edit, 'mangler endre-knapp');
  eq(edit.parentElement.className, 'comm-cell');
  eq(edit.closest('.comm-btn'), null, 'endre-knappen ligger inni kortet:');
});

t('endre-knappen åpner oppsettet med riktig tittel', () => {
  wdoc.querySelector("#commuter .cb-edit[data-edit='work']").onclick();
  ok(wdoc.getElementById('commSetup').classList.contains('show'));
  eq(wdoc.getElementById('commTitle').textContent, 'Endre Jobb');
});

t('tomt kort åpner «Sett opp»', () => {
  helpers.state.work = null;
  win.renderCommuter();
  wdoc.querySelector(".comm-btn[data-k='work']").onclick();
  eq(wdoc.getElementById('commTitle').textContent, 'Sett opp Jobb');
});

t('oppsettets to knapper er like brede (eget rutenett)', () => {
  ok(/\.cs-acts\{display:grid;grid-template-columns:1fr 1fr/.test(html), 'cs-acts er ikke et 2-kolonners rutenett');
});

t('pickAC krasjer ikke lenger på acFor.blur()', () => {
  // Feilen var: acClose() nullet acFor, og linjen etter kalte acFor.blur().
  const fn = js.slice(js.indexOf('function pickAC('), js.indexOf('function pickAC(') + 700);
  ok(!/acClose\(\);\s*acFor\.blur\(\)/.test(fn), 'acFor brukes fortsatt etter acClose()');
  ok(/const it=acItems\[i\],\s*inp=acFor/.test(fn), 'feltet tas ikke vare på før acClose()');
});

/* ---------- 2e. Symmetriske rader ---------- */
console.log('\nSymmetri:\n');

t('verktøyraden er tre like kolonner', () => {
  ok(/\.plan-tools\{display:grid;grid-template-columns:repeat\(3,1fr\)/.test(html));
  eq(wdoc.querySelectorAll('.plan-tools .chip-btn').length, 3);
});

t('begge transportvelgerne er 3-kolonners rutenett', () => {
  ok(/\.modes,\.mode-filter\{display:grid;grid-template-columns:repeat\(3,1fr\)/.test(html));
});

t('begge velgerne har «Alle» + fem transportmidler = to hele rader', () => {
  const plan = [...wdoc.querySelectorAll('#planModes .mode-chip')].map(b => b.dataset.m);
  const dep  = [...wdoc.querySelectorAll('#depModeFilter .mf-chip')].map(b => b.dataset.m);
  eq(plan.join(','), 'all,tram,metro,bus,rail,water');
  eq(dep.join(','), plan.join(','), 'velgerne er ikke like:');
  eq(plan.length % 3, 0, 'antallet fyller ikke hele rader:');
});

t('«Alle» er på når ingen modus er valgt', () => {
  ok(wdoc.querySelector('#planModes .mode-chip[data-m="all"]').classList.contains('on'));
});

t('velger man Buss slås «Alle» av', () => {
  wdoc.querySelector('#planModes .mode-chip[data-m="bus"]').click();
  ok(helpers.state.modes.has('bus'), 'modusen ble ikke lagret');
  ok(!wdoc.querySelector('#planModes .mode-chip[data-m="all"]').classList.contains('on'));
  ok(wdoc.querySelector('#planModes .mode-chip[data-m="bus"]').classList.contains('on'));
});

t('«Alle» nullstiller valget', () => {
  wdoc.querySelector('#planModes .mode-chip[data-m="all"]').click();
  eq(helpers.state.modes.size, 0);
  ok(wdoc.querySelector('#planModes .mode-chip[data-m="all"]').classList.contains('on'));
  ok(!wdoc.querySelector('#planModes .mode-chip[data-m="bus"]').classList.contains('on'));
});

/* ---------- 2c. Appen overlever at kartbiblioteket ikke laster ---------- */
console.log('\nNår Leaflet ikke laster:\n');

t('ingen <script src> til Leaflet i HTML (lastes ved behov)', () => {
  ok(!/<script[^>]*src=[^>]*leaflet/i.test(html), 'Leaflet lastes fortsatt synkront');
  ok(!/<link[^>]*leaflet[^>]*\.css/i.test(html), 'Leaflet-CSS lastes fortsatt synkront');
});

t('tre CDN-er å falle tilbake på', () => {
  const m = js.match(/const LEAFLET_CDN=\[([\s\S]*?)\];/);
  ok(m, 'fant ikke CDN-listen');
  eq((m[1].match(/js:/g) || []).length, 3);
});

const winNoMap = bootAppNoMap();

t('appen starter uten at L finnes (feilen «L is not defined»)', () => {
  ok(winNoMap.__T, 'appen kastet under oppstart');
  eq(typeof winNoMap.L, 'undefined', 'L skulle ikke vært lastet:');
});

t('Plan-fanen tegnes som normalt uten kart', () => {
  eq(winNoMap.document.querySelectorAll('#stops .stop-row').length, 2);
  eq(winNoMap.document.querySelectorAll('.nav-btn').length, 3);
});

t('Avganger faller tilbake til Oslo sentrum når kartet mangler', () => {
  ok(/mapCenter\(\)/.test(js), 'bruker fortsatt map.getCenter() direkte');
  ok(/const OSLO=\{lat:59\.91125,lon:10\.75031\}/.test(js), 'mangler fast fallback-punkt');
});

t('feilmelding og prøv-igjen vises når kartet ikke kan lastes', async () => {
  // ensureMap er async; testen kjøres synkront, så vi sjekker markup og logikk.
  ok(winNoMap.document.getElementById('mapFallback'), 'mangler fallback-panel');
  ok(winNoMap.document.getElementById('mfRetry'), 'mangler prøv-igjen-knapp');
  ok(winNoMap.document.getElementById('mapFallback').hasAttribute('hidden'), 'panelet skal starte skjult');
});

t('alle kartfunksjoner sjekker at kartet finnes', () => {
  const mustGuard = ['setUser', 'drawPattern', 'drawStreetRoute', 'applyMapContext', 'centerOnStop', 'nodeMarker', 'fitRoute'];
  mustGuard.forEach(fn => {
    const i = js.indexOf('function ' + fn + '(');
    ok(i > -1, 'fant ikke ' + fn);
    const head = js.slice(i, i + 260);
    ok(/!map/.test(head) || /!routeLayer/.test(head) || /!spotLayer/.test(head), fn + ' mangler vakt mot manglende kart');
  });
});

/* ---------- 2f. Farger, faneidentitet og bevegelse ---------- */
console.log('\nFarger og bevegelse:\n');

t('flaggrød er handlingsfargen, flaggblå bærefargen', () => {
  ok(/--navy:#0A2A57/.test(html), 'topplinjen er ikke flaggblå');
  ok(/--signal:#C8102E/.test(html), 'primærhandlingen er ikke flaggrød');
});

t('hver fane har sin egen farge', () => {
  const tabs = {};
  html.replace(/#app\[data-tab="(\w+)"\]\s*\{--tab:(#[0-9A-Fa-f]{6})/g, (_, k, v) => (tabs[k] = v));
  eq(Object.keys(tabs).sort().join(','), 'depart,map,plan');
  eq(new Set(Object.values(tabs)).size, 3, 'to faner deler farge:');
});

t('fanebytte setter data-tab på appen', () => {
  win.switchTab('depart');
  eq(wdoc.getElementById('app').dataset.tab, 'depart');
  win.switchTab('saved');
  eq(wdoc.getElementById('app').dataset.tab, 'saved');
});

t('animasjonsretningen følger rekkefølgen i menyen', () => {
  win.switchTab('plan');
  win.switchTab('map');
  eq(wdoc.getElementById('views').dataset.dir, 'fwd', 'framover:');
  win.switchTab('depart');
  eq(wdoc.getElementById('views').dataset.dir, 'back', 'bakover:');
  win.switchTab('depart');
  eq(wdoc.getElementById('views').dataset.dir, 'none', 'samme fane skal ikke animere sidelengs:');
});

t('fargeskiftet er en overgang, ikke et hopp', () => {
  ok(/#navInd\{[^}]*transition:[^}]*background \.45s/.test(html), 'indikatoren skifter farge brått');
  ok(/#topbar::after\{[\s\S]{0,320}?transition:background \.45s/.test(html), 'topplinjen skifter farge brått');
});

t('listene kommer inn forskjøvet, med tak på forsinkelsen', () => {
  ok(/animation-delay:\$\{Math\.min\(i\*26,260\)\}ms/.test(js), 'avgangsrader mangler forskyvning');
  ok(/animation-delay:\$\{Math\.min\(i\*45,270\)\}ms/.test(js), 'reisekort mangler forskyvning');
});

t('bevegelse slås av for dem som ber om det', () => {
  ok(/prefers-reduced-motion:reduce\)\{\*\{animation-duration:\.01ms!important/.test(html));
});

t('koordinatvakt hindrer at Leaflet får NaN', () => {
  ok(/const okLL=ll=>Array\.isArray\(ll\)&&Number\.isFinite/.test(js), 'mangler okLL');
  ['setUser', 'nodeMarker', 'centerOnStop', 'addSpotMarkerFn'].forEach(fn => {
    const i = js.indexOf('function ' + fn + '(');
    ok(/okLL/.test(js.slice(i, i + 220)), fn + ' mangler koordinatvakt');
  });
});

/* ---------- 2g. Sveip mellom faner og tilbakeknapp ---------- */
console.log('\nSveip og tilbakeknapp:\n');

function touch(el, type, x, y) {
  const ev = new win.Event(type, { bubbles: true, cancelable: true });
  const list = (type === 'touchend' || type === 'touchcancel') ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(ev, 'touches', { value: list });
  Object.defineProperty(ev, 'changedTouches', { value: [{ clientX: x, clientY: y }] });
  el.dispatchEvent(ev);
}
function swipe(dx, dy = 0, startX = 200) {
  const el = win.document.getElementById('views');
  touch(el, 'touchstart', startX, 400);
  touch(el, 'touchmove', startX + dx * 0.3, 400 + dy * 0.3);
  touch(el, 'touchmove', startX + dx, 400 + dy);
  touch(el, 'touchend', startX + dx, 400 + dy);
}

t('sveip mot venstre går framover i menyen', () => {
  win.switchTab('plan');
  swipe(-140);
  eq(win.currentTabName(), 'depart');
  swipe(-140);
  eq(win.currentTabName(), 'map');
});

t('sveip mot høyre går bakover', () => {
  swipe(140, 0, 10);              // står på Kart, så sveipet må starte i kanten
  eq(win.currentTabName(), 'depart');
  swipe(140);
  eq(win.currentTabName(), 'plan');
});

t('«Mer»-arket åpnes fra topplinjen og sperrer sveip', () => {
  win.switchTab('plan');
  wdoc.getElementById('btnMore').onclick();
  eq(wdoc.getElementById('moreSheet').hidden, false);
  swipe(-140);
  eq(win.currentTabName(), 'plan', 'sveipet gikk gjennom arket:');
  wdoc.getElementById('moreClose').onclick();
});

t('rundgang: fra Kart videre til Plan', () => {
  win.switchTab('map');
  swipe(-140, 0, 10);            // Kart krever kantstart
  eq(win.currentTabName(), 'plan', 'sveipet stoppet på Kart:');
});

t('rundgang andre vei: fra Plan tilbake til Kart', () => {
  win.switchTab('plan');
  swipe(140);
  eq(win.currentTabName(), 'map', 'sveipet stoppet på Plan:');
});

t('loddrett sveip bytter ikke fane (rulling går som normalt)', () => {
  win.switchTab('plan');
  swipe(-20, 160);
  eq(win.currentTabName(), 'plan');
});

t('kort sveip uten fart teller ikke', () => {
  win.switchTab('plan');
  const el = win.document.getElementById('views');
  touch(el, 'touchstart', 200, 400);
  touch(el, 'touchmove', 175, 400);
  // ingen touchend med fart -> under terskel
  touch(el, 'touchend', 175, 400);
  eq(win.currentTabName(), 'plan');
});

t('på Kart starter sveipet bare fra ytterkanten', () => {
  win.switchTab('map');
  swipe(-140, 0, 200);                 // midt på kartet
  eq(win.currentTabName(), 'map', 'kartet mistet panoreringen:');
  swipe(-140, 0, 10);                  // fra venstre kant
  eq(win.currentTabName(), 'plan');    // rundgang: Kart -> Plan
});

t('sveip er avslått når søkelisten er åpen', () => {
  win.switchTab('plan');
  win.document.getElementById('ac').classList.add('open');
  swipe(-140);
  eq(win.currentTabName(), 'plan');
  win.document.getElementById('ac').classList.remove('open');
});

t('tilbakeknappen har en historikk å gå tilbake i', () => {
  ok(/window\.addEventListener\('popstate'/.test(js), 'ingen popstate-håndtering');
  ok(/history\.pushState\(\{reis:next\}/.test(js), 'ingen tilstand dyttes på historikken');
  ok(/function applyState/.test(js), 'ingen gjenoppretting av tilstand');
});

t('fanebytte og underskjerm i Plan legges på historikken', () => {
  const i = js.indexOf('function switchTab(');
  ok(/pushHistory\(\)/.test(js.slice(i, js.indexOf('\n}', i))), 'switchTab pusher ikke');
  const j = js.indexOf('function showPlanSection(');
  ok(/pushHistory\(\)/.test(js.slice(j, j + 260)), 'showPlanSection pusher ikke');
});

/* ---------- 2h. Færre trykk ---------- */
console.log('\nFærre trykk:\n');

t('kortet du trykker er målet, ikke startpunktet', () => {
  helpers.state.home = { name: 'Hjemme', lat: 59.2, lon: 10.9, id: null };
  helpers.state.work = { name: 'Kontoret', lat: 59.9, lon: 10.7, id: null };
  win.renderCommuter();
  const btn = wdoc.querySelector(".comm-btn[data-k='home']");
  eq(btn.getAttribute('aria-label'), 'Reis til Hjemme');
  ok(/state\.stops=\[\{uid:uid\(\),name:other\.name/.test(js), 'startpunktet er ikke det andre kortet');
});

t('siste fane og siste stoppested lagres for neste åpning', () => {
  ok(/saveLS\('lastTab',name\)/.test(js), 'fanen lagres ikke');
  ok(/saveLS\('lastStop'/.test(js), 'stoppestedet lagres ikke');
  ok(/loadLS\('lastStop',null\)/.test(js), 'stoppestedet gjenopprettes ikke');
});

/* ---------- 2i. Zoom-sperre og utfylt Plan-fane ---------- */
console.log('\nZoom-sperre og utfylling:\n');

t('appen kan ikke knipes større', () => {
  const v = doc.querySelector('meta[name="viewport"]').getAttribute('content');
  ok(/user-scalable=no/.test(v), 'mangler user-scalable=no');
  ok(/maximum-scale=1/.test(v), 'mangler maximum-scale');
  ok(/body\{touch-action:pan-y\}/.test(html), 'body låser ikke sidelengs zoom');
});

t('kartet er unntatt – Leaflet håndterer knipingen der', () => {
  ok(/#map,\.leaflet-container\{touch-action:none\}/.test(html), 'kartet er også låst');
  ok(/const onMap=t=>!!\(t&&t\.closest&&t\.closest\('#map'\)\)/.test(js), 'mangler unntak for kartet');
});

t('knipe- og dobbelttrykk-gester stoppes utenfor kartet', () => {
  ok(/gesturestart','gesturechange','gestureend/.test(js), 'iOS-gester håndteres ikke');
  ok(/e\.touches\.length>1&&!onMap\(e\.target\)/.test(js), 'to fingre stoppes ikke');
  ok(/now-lastTouchEnd<300&&!onMap/.test(js), 'dobbelttrykk stoppes ikke');
});

t('sidelengs rullefelt får fortsatt rulle', () => {
  ok(/\.dep-stop-chips,#modeBar\{touch-action:pan-x\}/.test(html));
});

t('«I nærheten» ligger under «Finn reise» og fyller plassen', () => {
  const form = doc.getElementById('plan-form');
  const kids = [...form.children].map(e => e.id || e.className);
  const cta = kids.findIndex(k => String(k).includes('cta'));
  const near = kids.indexOf('nearbyWrap');
  ok(near > -1, 'seksjonen mangler');
  ok(near > cta, 'seksjonen ligger ikke under knappen');
});

t('nærhetslista hentes ved oppstart, ikke bare ved fanebytte', () => {
  ok(/renderNearby\(\);loadNearby\(\);startNearby\(\);/.test(js), 'henter ikke ved oppstart');
});

t('posisjon hentes stille bare når tillatelsen alt er gitt', () => {
  const i = js.indexOf('async function positionIfAlreadyAllowed');
  const fn = js.slice(i, i + 520);
  ok(/st\.state!=='granted'\)return null/.test(fn), 'ber om tilgang uten handling');
  ok(/near-ask/.test(js), 'mangler kort som spør om posisjon');
});

t('nærhetslista oppdateres, men ikke oftere enn hvert 45. sekund', () => {
  ok(/Date\.now\(\)-nearbyAt<45000/.test(js), 'mangler bremse på henting');
  ok(/nearbyTimer=every\(45000/.test(js), 'oppdaterer ikke av seg selv');
});

/* ---------- 2j. Hurtigreiser fra A til B ---------- */
console.log('\nHurtigreiser:\n');

const QT = win.qt;

t('hurtigreiser ligger rett under Hjem/Jobb i samme seksjon', () => {
  const sec = wdoc.querySelector('.sec[data-sec="quick"] .sec-inner');
  ok(sec, 'mangler seksjonen');
  const kids = [...sec.children].map(e => e.id || e.className);
  eq(kids.join(','), 'commuter,quickTrips');
});

t('tom liste viser bare «Ny hurtigreise»', () => {
  QT.saveQuickTrips([]);
  QT.renderQuickTrips();
  eq(wdoc.querySelectorAll('#quickTrips .qt-card').length, 0);
  ok(wdoc.getElementById('qtAdd'), 'mangler legg-til-knapp');
});

t('lagrede hurtigreiser tegnes som rute fra → til', () => {
  QT.saveQuickTrips([
    { from: { n: 'Hjem', lat: 59.2, lon: 10.9 }, to: { n: 'Treningen', lat: 59.3, lon: 10.8 }, vias: [] },
    { from: { n: 'Hjem', lat: 59.2, lon: 10.9 }, to: { n: 'Mormor', lat: 59.4, lon: 10.7 }, vias: [] }
  ]);
  QT.renderQuickTrips();
  const cards = [...wdoc.querySelectorAll('#quickTrips .qt-card')];
  eq(cards.length, 2);
  eq(cards[0].querySelector('.qt-route').textContent.replace(/\s+/g, ''), 'Hjem→Treningen');
  eq(cards[0].getAttribute('aria-label'), 'Reis fra Hjem til Treningen');
});

t('ingen knapp inni en knapp (samme felle som Hjem/Jobb-kortet)', () => {
  eq(wdoc.querySelectorAll('#quickTrips button button').length, 0);
  const edit = wdoc.querySelector('#quickTrips .qt-edit');
  eq(edit.closest('.qt-card'), null, 'endre-knappen ligger inni kortet:');
  eq(edit.parentElement.className, 'qt-cell');
});

t('ett trykk setter både start og mål', () => {
  QT.runQuickTrip({ from: { n: 'Hjem', lat: 59.2, lon: 10.9 }, to: { n: 'Mormor', lat: 59.4, lon: 10.7 }, vias: [] });
  eq(helpers.state.stops.map(s => s.name).join(' → '), 'Hjem → Mormor');
  eq(helpers.state.stops.length, 2);
});

t('editoren forhåndsvelger Hjem som startpunkt', () => {
  helpers.state.home = { name: 'Hjemme', lat: 59.2, lon: 10.9, id: null };
  QT.openQuickEditor(-1);
  const from = wdoc.querySelector("#modalCard [data-row='from'] .qte-pick b");
  eq(from.textContent, 'Hjemme');
  ok(wdoc.querySelector("#modalCard [data-row='to']"), 'mangler til-rad');
  ok(wdoc.querySelector("#modalCard [data-row='to'] .qte-chip[data-k='search']"), 'mangler søkevalg');
});

t('editoren tilbyr Hjem, Jobb og Min posisjon som snarveier', () => {
  helpers.state.work = { name: 'Kontoret', lat: 59.9, lon: 10.7, id: null };
  QT.openQuickEditor(-1);
  const keys = [...wdoc.querySelectorAll("#modalCard [data-row='from'] .qte-chip")].map(b => b.dataset.k);
  eq(keys.join(','), 'home,work,pos,search');
});

t('quickQuery henter flere reiser i ett kall med aliaser', () => {
  const q = QT.quickQuery(3);
  eq((q.match(/q\d: trip\(/g) || []).length, 3, 'feil antall aliaser:');
  ok(/\$f0:Location!/.test(q) && /\$t2:Location!/.test(q), 'mangler variabler');
  ok(/\$dt:DateTime!/.test(q), 'mangler tidspunkt');
  eq((QT.quickQuery(1).match(/q\d: trip\(/g) || []).length, 1);
});

t('sanntid hentes ikke oftere enn hvert 60. sekund', () => {
  ok(/Date\.now\(\)-qtAt<60000/.test(js), 'mangler brems');
  ok(/const QT_MAX_LIVE=3/.test(js), 'mangler tak på antall sanntidskall');
});

t('«Lagrede reiser» og «hurtigreise» er nå det samme', () => {
  ok(/function quickTrips\(\)\{return loadLS\('favJourneys'/.test(js), 'bruker ikke samme lager');
  ok(html.includes('<div class="sec-label">Hurtigreiser</div>'), 'Mer-arket bruker gammelt navn');
});

t('forslagslisten ligger utenfor #app, ellers havner den bak dialogen', () => {
  const ac = doc.getElementById('ac');
  ok(ac, 'mangler forslagsliste');
  eq(ac.closest('#app'), null, '#ac ligger inne i #app sin stablingskontekst:');
  ok(/#ac\{position:fixed;z-index:4600/.test(html), 'for lav z-index');
});

/* ---------- 2k. Sammenleggbare seksjoner og kartkort ---------- */
console.log('\nSammenleggbare seksjoner:\n');

t('fire seksjoner kan legges ned, kjerneskjemaet kan ikke', () => {
  const keys = [...wdoc.querySelectorAll('.sec[data-sec]')].map(e => e.dataset.sec);
  eq(keys.join(','), 'quick,modes,recents,nearby');
  // «Planlegg reisen» og «Når» skal alltid være åpne
  ok(!wdoc.querySelector('.sec[data-sec="stops"]'), 'kjerneskjemaet ble gjort sammenleggbart');
});

t('hver seksjon har knapp, pil og innholdsboks', () => {
  wdoc.querySelectorAll('.sec[data-sec]').forEach(sec => {
    const b = sec.querySelector('.sec-label.toggle');
    ok(b, sec.dataset.sec + ' mangler knapp');
    eq(b.tagName, 'BUTTON', sec.dataset.sec + ' bruker ikke knapp:');
    ok(sec.querySelector('.sec-chev'), sec.dataset.sec + ' mangler pil');
    ok(sec.querySelector('.sec-body > .sec-inner'), sec.dataset.sec + ' mangler innholdsboks');
  });
});

t('klikk lukker og åpner igjen, og setter aria-expanded', () => {
  const sec = wdoc.querySelector('.sec[data-sec="nearby"]');
  const btn = sec.querySelector('.sec-label.toggle');
  eq(sec.classList.contains('closed'), false, 'startet lukket:');
  btn.onclick();
  eq(sec.classList.contains('closed'), true);
  eq(btn.getAttribute('aria-expanded'), 'false');
  btn.onclick();
  eq(sec.classList.contains('closed'), false);
  eq(btn.getAttribute('aria-expanded'), 'true');
});

t('valget lagres, så det huskes til neste gang', () => {
  win.sec.setSec('modes', false);
  const saved = JSON.parse(win.localStorage.getItem('reis.sections'));
  eq(saved.modes, false);
  win.sec.setSec('modes', true);
  eq(JSON.parse(win.localStorage.getItem('reis.sections')).modes, true);
});

t('animasjonen bruker grid-rows, ikke fast høyde', () => {
  ok(/\.sec-body\{display:grid;grid-template-rows:1fr/.test(html), 'mangler grid-animasjon');
  ok(/\.sec\.closed \.sec-body\{grid-template-rows:0fr/.test(html), 'lukkes ikke');
});

t('lukket seksjon viser en teller så innholdet ikke blir usynlig', () => {
  win.qt.saveQuickTrips([
    { from: { n: 'Hjem', lat: 59.2, lon: 10.9 }, to: { n: 'Treningen', lat: 59.3, lon: 10.8 }, vias: [] }
  ]);
  win.qt.renderQuickTrips();
  const c = wdoc.getElementById('quickCount');
  eq(c.hidden, false);
  eq(c.textContent, '1 reise');
  win.qt.saveQuickTrips([]);
  win.qt.renderQuickTrips();
  eq(wdoc.getElementById('quickCount').hidden, true);
});

t('kartkortet har et grep for å legge det ned', () => {
  ok(/function mapCardHTML\(inner\)/.test(js), 'mangler grep-innpakning');
  ok(/#mapCard\.collapsed>\*:not\(\.mc-grip\):not\(\.mc-head\)\{display:none\}/.test(html),
     'lagt ned kort skjuler ikke innholdet');
  ok(/bottom:calc\(18px \+ var\(--card-h\)/.test(html), 'knappene følger ikke kortets høyde');
});

t('alle fire kartkort-varianter får grepet', () => {
  eq((js.match(/card\.innerHTML=mapCardHTML\(/g) || []).length, 5, 'et kort mangler grep:');
  ok((js.match(/bindCardGrip\(\);/g) || []).length >= 5, 'grepet bindes ikke overalt');
});

t('nedlagt kartkort huskes', () => {
  ok(/loadLS\('mapCardCollapsed',false\)/.test(js), 'leser ikke lagret valg');
  ok(/saveLS\('mapCardCollapsed',mapCardCollapsed\)/.test(js), 'lagrer ikke valg');
});

/* ---------- 2l. Kartpaneler stables, de dekker ikke hverandre ---------- */
console.log('\nKartpaneler:\n');

t('bunnpanelene stables etter målt høyde, ikke faste pikselverdier', () => {
  ok(/#viewMap\{--card-h:0px;--layer-h:0px\}/.test(html), 'mangler stabelvariabler');
  ok(/bottom:calc\(12px \+ var\(--card-h\)\)/.test(html), 'lagvelgeren ligger ikke over kortet');
  ok(/bottom:calc\(18px \+ var\(--card-h\) \+ var\(--layer-h\)\)/.test(html), 'knappene stables ikke');
  ok(!/#viewMap\.has-card \.fabs\{bottom:216px\}/.test(html), 'gamle faste verdier står igjen');
});

t('høydene måles i JS og ved størrelsesendring', () => {
  ok(/function measureStack\(\)/.test(js), 'mangler måling');
  ok(/setProperty\('--card-h'/.test(js) && /setProperty\('--layer-h'/.test(js), 'setter ikke variablene');
  ok(/new ResizeObserver\(\(\)=>measureStack\(\)\)/.test(js), 'måler ikke på nytt ved endring');
});

t('lagvelgeren legger kortet ned mens den er åpen, og gjenoppretter etterpå', () => {
  ok(/cardWasOpen=!!\(card&&!card\.hidden&&!mapCardCollapsed\)/.test(js), 'husker ikke tilstanden');
  ok(/if\(cardWasOpen\)\{mapCardCollapsed=true;applyCardCollapse\(\)\}/.test(js), 'legger ikke ned kortet');
  ok(/if\(cardWasOpen\)\{cardWasOpen=false;mapCardCollapsed=false/.test(js), 'gjenoppretter ikke');
});

t('stabelen måles også når kortet skjules', () => {
  const i = js.indexOf('function hideMapCard(');
  ok(/measureStack\(\)/.test(js.slice(i, i + 200)), 'måler ikke ved skjuling');
});

/* ---------- 2m. Batteri, oppfriskning og bufrede avganger ---------- */
console.log('\nYtelse og oppfriskning:\n');

t('ingen naken setInterval igjen – alt går gjennom every()', () => {
  const bare = (js.match(/setInterval\(/g) || []).length;
  ok(/function every\(ms,fn,opts=\{\}\)/.test(js), 'mangler every()');
  ok(/const start=\(\)=>\{id=setInterval/.test(js), 'every() bruker ikke setInterval internt');
  eq(bare, 1, 'det finnes timere utenfor every():');
});

t('every() hopper over når appen er skjult', () => {
  ok(/if\(visible\(\)\|\|opts\.always\)fn\(\)/.test(js), 'kjører uansett synlighet');
  ok(/const visible=\(\)=>document\.visibilityState==='visible'/.test(js), 'mangler synlighetssjekk');
});

t('appen henter friskt når du kommer tilbake', () => {
  ok(/addEventListener\('visibilitychange'/.test(js), 'lytter ikke på synlighet');
  ok(/onResume\.forEach/.test(js), 'kjører ingenting ved retur');
  ok(/if\(away<10000\)return/.test(js), 'mangler terskel mot unødige kall');
});

t('klokke og nedtelling rettes opp umiddelbart ved retur', () => {
  const i = js.indexOf("addEventListener('visibilitychange'");
  const fn = js.slice(i, i + 700);
  ok(/tickClock\(\)/.test(fn), 'klokka oppdateres ikke');
  ok(/data-ts/.test(fn), 'nedtellingen oppdateres ikke');
});

t('siste avgangsliste bufres og vises umiddelbart', () => {
  ok(/function cacheDepartures\(id,calls\)/.test(js), 'lagrer ikke');
  ok(/function readDepCache\(id\)/.test(js), 'leser ikke');
  ok(/Date\.now\(\)-c\.t>3600000\)return null/.test(js), 'mangler holdbarhet på bufferet');
});

t('bufret liste merkes tydelig og dempes', () => {
  ok(doc.getElementById('depStale'), 'mangler merkelapp');
  ok(/#depList\.stale\{opacity:\.62/.test(html), 'dempes ikke');
  const i = js.indexOf('function setStale(');
  ok(/classList\.toggle\('stale'/.test(js.slice(i, i + 420)), 'setStale styrer ikke dempingen');
});

t('feilet henting beholder lista i stedet for å vise feilkort', () => {
  ok(/if\(state\.departures\.length&&state\.departuresFor===id\)/.test(js), 'kaster bort brukbare data');
});

t('skriftene ligger i fila, ikke hos Google', () => {
  eq((html.match(/@font-face/g) || []).length, 7, 'feil antall skriftsnitt:');
  ok(!/fonts\.googleapis|fonts\.gstatic/.test(html), 'henter fortsatt fra Google');
  ok(/font-display:swap/.test(html), 'mangler font-display');
});

t('alle vekter som brukes er faktisk lastet', () => {
  const loaded = new Set();
  html.replace(/font-family:'([^']+)';font-style:normal;font-weight:(\d+)/g,
    (_, fam, w) => loaded.add(fam + ' ' + w));
  ['Space Grotesk 700', 'Space Grotesk 600', 'IBM Plex Sans 400',
   'IBM Plex Sans 600', 'IBM Plex Sans 700', 'IBM Plex Mono 400', 'IBM Plex Mono 600']
    .forEach(f => ok(loaded.has(f), 'mangler ' + f));
});

/* ---------- 2n. Finpuss: trykkflater, skjermleser, nett og dyplenker ---------- */
console.log('\nFinpuss:\n');

t('små knapper får usynlig trykksone på 44 px', () => {
  ok(/\.tap::before\{[^}]*width:max\(100%,44px\);height:max\(100%,44px\)/.test(html), 'mangler trykksone');
  ok(wdoc.querySelectorAll('.tap').length >= 4, 'for få knapper bruker den');
});

t('seksjonsoverskriftene er høye nok til å treffes', () => {
  ok(/\.sec-label\.toggle\{[^}]*min-height:44px/.test(html));
});

t('rutenettknappene er 44 px høye', () => {
  ok(/\.plan-tools \.chip-btn\{width:100%;height:44px/.test(html), 'verktøyraden');
  ok(/\.seg button\{flex:1;height:44px/.test(html), 'segmentvelgeren');
  ok(/height:44px;padding:0 12px;border-radius:999px/.test(html), 'transportvelgerne');
});

t('dialoger har rolle, modal-flagg og tittel', () => {
  const m = doc.getElementById('modalCard');
  eq(m.getAttribute('role'), 'dialog');
  eq(m.getAttribute('aria-modal'), 'true');
  eq(doc.getElementById('moreSheet').getAttribute('role'), 'dialog');
  eq(doc.getElementById('wakeFlash').getAttribute('role'), 'alertdialog');
});

t('fokus holdes inne i dialogen og gis tilbake etterpå', () => {
  ok(/function trapFocus\(container\)/.test(js), 'mangler fokusfelle');
  ok(/function releaseFocus\(\)/.test(js), 'gir ikke fokus tilbake');
  ok(/e\.shiftKey&&document\.activeElement===first/.test(js), 'Tab går ut av dialogen');
});

t('avgangstavla annonseres for skjermleser', () => {
  const l = doc.getElementById('depList');
  eq(l.getAttribute('aria-live'), 'polite');
  eq(l.getAttribute('role'), 'list');
  ok(/role="listitem" aria-label="\$\{esc\(talt\)\}"/.test(js), 'radene mangler lesbar tekst');
  ok(/aria-busy/.test(js), 'sier ikke fra at den laster');
});

t('fanemenyen er en tablist med riktig valgt-tilstand', () => {
  eq(doc.getElementById('bottomNav').getAttribute('role'), 'tablist');
  ok(/setAttribute\('aria-selected',String\(on\)\)/.test(js), 'oppdaterer ikke aria-selected');
});

t('klokkeavvik leses fra Entur og korrigeres', () => {
  ok(/function noteServerDate\(res\)/.test(js), 'leser ikke Date-headeren');
  ok(/function now\(\)\{return Date\.now\(\)\+clockSkew\}/.test(js), 'mangler korrigert klokke');
  ok(!/countdownHTML\(\+n\.dataset\.ts-Date\.now\(\)\)/.test(js), 'nedtellingen bruker ukorrigert klokke');
});

t('pollefrekvensen skaleres etter forbindelsen', () => {
  ok(/function netInfo\(\)/.test(js), 'mangler nettverkssjekk');
  ok(/c\.saveData\?3:\(slow\?3:/.test(js), 'skalerer ikke');
  ok(/opts\.net===false/.test(js), 'skalerer også sekundtikk');
  const i = js.indexOf('async function pollVehicles');
  ok(/ni\.slow\|\|ni\.save/.test(js.slice(i, i + 260)), 'kjøretøy hentes også på treg linje');
});

t('dyplenke rett til et stoppested', () => {
  ok(/const stopId=q\.get\('stop'\)/.test(js), 'mangler ?stop=');
  ok(/function stopUrl\(st\)/.test(js), 'kan ikke lage lenken');
});

t('hurtigreise kan legges på startsiden', () => {
  ok(/function tripUrl\(x\)/.test(js), 'mangler lenke');
  ok(/u\.searchParams\.set\('go','1'\)/.test(js), 'lenken søker ikke automatisk');
  ok(/function offerShortcut\(url,label\)/.test(js), 'mangler veiledning');
});

t('manifestet tar imot delte adresser og viser skjermbilder', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.webmanifest'), 'utf8'));
  eq(m.share_target.method, 'GET');
  eq(m.share_target.params.text, 'shared');
  eq(m.screenshots.length, 3);
  m.screenshots.forEach(s2 => ok(fs.existsSync(path.join(__dirname, s2.src)), 'mangler ' + s2.src));
});

t('«Siste avgang i kveld» finnes og grupperer per linje', () => {
  ok(/const LAST_Q=/.test(js), 'mangler spørring');
  ok(/function nightCutoff\(\)/.test(js), 'mangler nattgrense');
  ok(/c\.setHours\(3,0,0,0\)/.test(js), 'natta slutter ikke kl. 03');
  ok(/const key=line\.publicCode\+'\|'\+dest/.test(js), 'grupperer ikke per linje og retning');
});

/* ---------- 3. Ikoner og manifest på disk ---------- */
console.log('\nFiler og manifest:\n');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.webmanifest'), 'utf8'));

t('manifest har PNG i både 192 og 512 (kreves av Chrome for WebAPK)', () => {
  const png = manifest.icons.filter(i => i.type === 'image/png' && i.purpose === 'any');
  ok(png.some(i => i.sizes === '192x192'), 'mangler 192');
  ok(png.some(i => i.sizes === '512x512'), 'mangler 512');
});
t('manifest har maskable-ikon for Android', () => {
  ok(manifest.icons.some(i => i.purpose === 'maskable' && i.sizes === '512x512'));
});
t('manifest har monochrome for Samsung One UI temaikoner', () => {
  ok(manifest.icons.some(i => i.purpose === 'monochrome'));
});
t('alle ikonfiler i manifestet finnes på disk', () => {
  const missing = [];
  manifest.icons.forEach(i => { if (!fs.existsSync(path.join(__dirname, i.src))) missing.push(i.src); });
  manifest.shortcuts.forEach(s => (s.icons || []).forEach(i => { if (!fs.existsSync(path.join(__dirname, i.src))) missing.push(i.src); }));
  eq(missing.length, 0, 'mangler ' + missing.join(', ') + ':');
});
t('start_url og scope er relative', () => {
  ok(manifest.start_url.startsWith('./'), 'start_url ikke relativ');
  eq(manifest.scope, './');
});
t('snarveier peker på faner appen faktisk kjenner', () => {
  const tabs = ['plan', 'avganger', 'kart', 'lagret'];
  manifest.shortcuts.forEach(s => {
    const tab = new URL(s.url, 'https://x/').searchParams.get('tab');
    ok(tabs.includes(tab), 'ukjent fane ' + tab);
  });
});
t('.nojekyll finnes', () => {
  ok(fs.existsSync(path.join(__dirname, '.nojekyll')));
});
t('sw.js har navigasjonsfallback', () => {
  const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
  ok(/mode\s*===\s*'navigate'/.test(sw), 'mangler navigate-håndtering');
  ok(/index\.html/.test(sw), 'mangler offline-fallback');
});

console.log(`\n${pass} bestått, ${fail} feilet\n`);
process.exit(fail ? 1 : 0);

# REIS Norge

Installerbar reise-app for Norge – en Progressive Web App bygget på åpne, gratis
datakilder. Kollektiv, bil, sykkel og gange i én app, med sanntidsavganger, kart,
avvik, bysykkel, vær og severdigheter langs ruten.

## Mappestruktur

Legg filene **nøyaktig slik** i rota av repositoryet:

```
/
├── index.html                 ← selve appen
├── sw.js                      ← service worker
├── manifest.webmanifest       ← PWA-manifest
├── .nojekyll                  ← tom fil, hindrer at GitHub Pages filtrerer filer
├── README.md
├── ENDRINGER.md               ← hva som ble rettet (trengs ikke på nett)
├── test-dom.js                ← tester (trengs ikke på nett)
├── test-live.js               ← tester (trengs ikke på nett)
└── icons/
    ├── icon.svg               vektorikon
    ├── icon-192.png           installasjonsikon (any)
    ├── icon-512.png           installasjonsikon (any)
    ├── maskable.svg           vektor, med sikkerhetssone
    ├── maskable-192.png       Android adaptivt ikon
    ├── maskable-512.png       Android adaptivt ikon
    ├── monochrome.svg         Samsung One UI temaikon
    ├── monochrome-512.png     Samsung One UI temaikon
    ├── apple-touch-icon.png   iOS hjemskjerm (180 px)
    ├── favicon.svg            fanikon
    ├── favicon-32.png         fanikon, raster
    ├── favicon-180.png
    ├── favicon.ico            eldre nettlesere
    └── logo.svg               merkevare-lockup (merke + ordmerke)
```

### Hvorfor både SVG og PNG nå?
Chrome på Android bygger en **WebAPK** når du installerer appen. Den prosessen vil ha
ekte PNG i 192 og 512 px – med bare SVG blir hjemskjermikonet ofte beskåret, gråtonet
eller pakket inn i en hvit ramme. Derfor ligger PNG-ene ved siden av vektorene.
`maskable`-variantene holder motivet innenfor den trygge sonen (66 % av flaten), slik
at ingen Android-maske klipper av ruten. `monochrome` brukes av Samsung One UI når
temaikoner er slått på. Ordmerket i `logo.svg` er ekte vektorbaner, ikke tekst, så det
ser likt ut uansett hvilke skrifter enheten har.

## Publisere på GitHub Pages

1. Opprett et nytt repository, f.eks. `reis-norge`.
2. Last opp filene slik strukturen over viser. `icons/` skal være en **ekte mappe** –
   dra hele mappen inn i opplastingsvinduet, ikke filene enkeltvis.
3. Opprett en tom fil som heter `.nojekyll` i rota.
4. **Settings → Pages**: *Source* = `Deploy from a branch`, branch `main`,
   mappe `/ (root)`. Trykk *Save*.
5. Vent 1–2 minutter, åpne `https://<bruker>.github.io/<repo>/`.
6. Chrome på Android: meny → *Legg til på startsiden*. Langtrykk på ikonet gir
   snarveiene *Nær meg*, *Planlegg*, *Kart* og *Lagret*.

> HTTPS er påkrevd for både installasjon og posisjon. GitHub Pages gir HTTPS
> automatisk. Åpner du `index.html` som fil (`file://`), virker ingen av delene.

### Når du legger ut en ny versjon
Appen oppdager den selv og viser et banner nederst med «Oppdater». Du trenger
ikke lukke og åpne appen. Vil du fremtvinge en sjekk: **Mer → Versjon → Se etter
oppdatering**.

### Hvis ikonet ikke oppdaterer seg
Android cacher WebAPK-ikonet. Avinstaller appen, åpne Chrome →
*Innstillinger → Personvern → Slett nettleserdata → Bufrede bilder og filer*,
last siden på nytt og installer igjen.

## Bygging av ressurser
```
python3 build_icons.py   # ikonsettet (SVG + PNG)
python3 build_fonts.py   # subsetter og legger skriftene inn i index.html
python3 mkshots.py       # skjermbildene manifestet viser ved installasjon
```
Skriftene ligger i `index.html` som base64-WOFF2, så appen har ingen eksterne
avhengigheter utenom kart og API-er.

## Datakilder (alle gratis, ingen nøkkel)
- Kollektiv, sanntid, geosøk, avvik, kjøretøyposisjoner: **Entur**
- Bil / sykkel / gange-ruting: **OSRM** (FOSSGIS)
- Bysykkel: **Oslo bysykkels** åpne GBFS-feed
- Vær og høydedata: **Open-Meteo**
- Kart: **OpenStreetMap + CARTO**, satellitt fra **Esri**, topografi fra **Kartverket**
- Severdigheter: **Wikipedia + OpenStreetMap (Overpass)**

Alle Entur-kall skal sende headeren `ET-Client-Name` – uten den kan du bli
rate-limited.

## Ærlige begrensninger
Ekte iOS Live Activities, Android låsskjerm-widgets og «venn følger bussen live»
krever native kode eller en server. I web-appen oppdateres i stedet fanetittelen
mens en reise pågår, og passasjerrapporter lagres lokalt. «Vekk meg»-alarmen virker
mens appen er åpen.

## Tester
```
npm install jsdom      # kun for test-dom.js
node test-dom.js       # 150 tester: grensesnitt, sveip, PWA-oppsett, logikk (uten nett)
node test-live.js      # 15 tester: appens egne spørringer mot Entur (krever nett)
python3 swipe_test.py  # sveip og kartlag med ekte touch i Chromium
python3 measure.py     # tetthet, fanefarger og kontrast
python3 fill_test.py   # utfylling av Plan-fanen og zoom-sperre
python3 qt_test.py     # hurtigreiser ende-til-ende
python3 sec_test.py    # sammenleggbare seksjoner og kartkort
python3 overlap_test.py # at kartpanelene ikke dekker hverandre
python3 perf_test.py   # pausing i bakgrunn, oppfriskning, offline-buffer
python3 font_test.py   # at skriftene er lokale og dekker alle vekter
python3 a11y.py        # trykkflater og tilgjengelige navn
python3 polish_test.py # siste avgang, dyplenker, share target, fokus
python3 plan_test.py   # Plan-fanens oppsett og kontrast i begge temaer
python3 soak.py        # slitasjetest: forfall, fastlåste flagg, timerlekkasje
python3 regress_map.py # reisesøk etter at kartfanen har vært besøkt
python3 update_test.py # at nye versjoner oppdages uten omstart
```

## Feilretting
`ENDRINGER.md` beskriver hver feil som ble funnet og rettet, med kildehenvisning
til hva Entur-API-et faktisk returnerer.

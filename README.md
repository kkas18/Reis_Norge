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
├── README.md                  ← denne filen
└── ENDRINGER.md               ← endringslogg
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

## Feilretting
`ENDRINGER.md` beskriver hver feil som ble funnet og rettet, med kildehenvisning
til hva Entur-API-et faktisk returnerer.

Testene og byggeskriptene (jsdom-suite, Playwright-målinger, font- og
ikongenerering) er holdt utenfor denne pakken, siden de ikke skal på nett.

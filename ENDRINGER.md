# REIS Norge – hva som ble fikset

Alt under er verifisert mot Entur live 31. juli 2026, ikke gjettet.
`node test-live.js` kjører appens egne spørringer mot API-et (13 tester),
`node test-dom.js` tester grensesnitt og logikk i jsdom (73 tester),
`python3 shot.py` og `python3 measure.py` måler layout, farger og kontrast i ekte
Chromium på Galaxy S24-bredde. Alle grønne.

---

## De to feilene som lammet appen

### 1. Reisesøket feilet alltid — `TripPattern.startTime` finnes ikke
Den gamle spørringen ba om `startTime` og `endTime` på `TripPattern`. Disse feltene
ble fjernet i JourneyPlanner v3. Hele `trip`-spørringen feilet derfor på validering,
og Plan-fanen kunne aldri returnere en reise.

```diff
- tripPatterns{ duration distance startTime endTime legs{…} }
+ tripPatterns{ duration distance walkDistance expectedStartTime expectedEndTime legs{…} }
```
Alle avlesninger (`p.startTime` → `p.expectedStartTime`) er rettet, også i
resultatkortene, kartkortet, detaljvisningen og fanetittelen.

### 2. Avgangsfanen feilet — `STOP_PLACE` er ikke en gyldig enum-verdi
Dette var feilen på skjermbildet ditt. Entur bruker lowerCamelCase:

```
FilterPlaceType : quay | stopPlace | bicycleRent | bikePark | carPark
```

```diff
- filterByPlaceTypes:[STOP_PLACE]
+ filterByPlaceTypes:[stopPlace], filterByInUse:true, multiModalMode:parent
```
`filterByInUse` fjerner nedlagte holdeplasser, og `multiModalMode:parent` gjør at
Jernbanetorget kommer som **ett** stopp i stedet for ett per transportmiddel.
Testen sjekker eksplisitt at det ikke kommer dubletter.

---

## Adresser og «din posisjon»

`Location.place` godtar **kun** ruteplanleggerens egne id-er. Geocoderen gir helt
andre id-er for alt som ikke er en holdeplass:

| Treff | id fra geocoder | duger som `place`? |
|---|---|---|
| Jernbanetorget | `NSR:StopPlace:58366` | ja |
| Storgata 10, Fredrikstad | `17873150` | nei |
| Fredrikstad tannklinikk | `OSM:TopographicPlace:6126674571` | nei |
| Din posisjon (GPS) | – | nei |

Den gamle koden sendte alt inn som `place`. Nå går alt gjennom `toLocation()`,
som velger `place` for NSR-id-er og `coordinates` for resten.

I tillegg:
- Geocoderen kalles nå med `lang=no` (sto `lang=en`, derfor engelske stedsnavn).
- `focus.point` sendes med din posisjon, så «Storgata» nær deg havner øverst.
- `reverseGeocode` leste `j.properties` — men Entur svarer med en FeatureCollection.
  Den fant derfor aldri navnet og svarte alltid «Valgt punkt». Leser nå `j.features[0]`.
- `getPos()` skiller mellom avslått tillatelse, manglende HTTPS, tidsavbrudd og
  manglende GPS, og sier hva du skal gjøre i stedet for «Fant ikke posisjonen din».

---

## Via-stopp

`via` er ikke lenger en liste med `Location`, men `[TripViaLocationInput!]`:

```graphql
input TripVisitViaLocationInput {
  label: String
  minimumWaitTime: Duration   # "PT5M"
  stopLocationIds: [String!]
  coordinate: InputCoordinates
}
```

Gammel kode sendte `{name, place, coordinates}` og ble stille avvist. Ny `toVia()`
pakker holdeplasser som `{visit:{stopLocationIds:[…]}}` og adresser som
`{visit:{coordinate:{…}}}`. Tom via-liste sendes som `null`, siden en tom liste
også gir feil.

Live-testen bekrefter at ruten **faktisk** går via punktet, ikke bare at kallet
går gjennom.

I grensesnittet er via-radene også testet: knappen setter inn raden mellom A og B,
bare via-rader får slett-knapp, knappen skjules ved fire rader, og sletting fjerner
riktig rad.

---

## Utgangsguiden var også ødelagt

`Quay.compassBearing` finnes ikke i v3 — spørringen feilet på validering hver gang.
Guiden bruker nå felt som faktisk finnes:

- `latitude`/`longitude` per plattform, og kompassretningen regnes ut selv fra
  stoppestedets midtpunkt (`bearingTo()`, testet mot N/Ø/S/V).
- `wheelchairAccessible` (`possible` / `notPossible` / `noInformation`) gir et
  ærlig «Trinnfri»-merke i stedet for tekstgjetting.
- `lines{publicCode}` viser hvilke linjer som går fra hver plattform.

Teksten er også gjort ærligere: den sier nå at retningene er utregnet, og lover
ikke heisplassering Entur ikke har data om.

---

## Levende kjøretøy

Endepunktet `api.entur.io/vehicle/v1/graphql` finnes ikke lenger og svarte tomt.
Riktig er `realtime/v2/vehicles`, med tre forskjeller den gamle koden ikke tok høyde for:

- posisjon ligger i `location{latitude longitude}`, ikke på rotnivå
- `mode` er STORE BOKSTAVER (`BUS`, `TRAM`, `METRO`, `RAIL`, `FERRY`)
- filtrering skjer med `boundingBox`, som også sparer båndbredde

Testen henter 35+ kjøretøy i Oslo-boksen.

---

## Bysykkel

`gbfs.json` fra Oslo bysykkel har feeds bak en språknøkkel — `data.nb.feeds`, ikke
`data.feeds`. Gammel kode fant derfor aldri stasjonene. `gbfsFeeds()` håndterer
begge formene. Testen henter 268 stasjoner.

---

## Severdigheter kastet en ReferenceError

I `spotHTML` sto det `href="${a?.url||s.url}"`. Variabelen `a` finnes ikke i den
funksjonen, så hvert kall kastet `ReferenceError` og listen ble aldri tegnet.
Rettet til `s.url`, og URL-en escapes nå. Wikipedia-oppslagene er samtidig byttet
fra `en.wikipedia.org` til `no.wikipedia.org`.

---

## «L is not defined» — kartbiblioteket kunne velte hele appen

Leaflet lå som en vanlig `<script src="https://unpkg.com/…">` rett før appens eget
skript. Feilet den forespørselen — dårlig dekning, blokkert CDN, annonseblokker,
unpkg nede — ble `L` aldri definert, og appen døde på `const map=L.map('map',…)`
før noe som helst rakk å kjøre. Ikke bare kartet: hele appen, inkludert Plan og
Avganger, som ikke trenger kart i det hele tatt.

Nå:

- Leaflet lastes **først når kartfanen faktisk åpnes**, ikke ved oppstart.
- Tre CDN-er prøves etter tur: unpkg → jsDelivr → cdnjs. CSS og JS hentes fra samme.
- `map`, `tiles` og alle lagene starter som `null`. Hver funksjon som rører kartet
  (`setUser`, `drawPattern`, `drawStreetRoute`, `nodeMarker`, `fitRoute`,
  `centerOnStop`, `applyMapContext`, `fetchVehicles`, bysykkel- og
  severdighetslagene) sjekker først at kartet finnes.
- Avgangsfanen brukte `map.getCenter()` som reservepunkt. Den bruker nå `mapCenter()`,
  som faller tilbake til Oslo sentrum hvis kartet ikke er lastet.
- Klarer ikke kartet å laste, vises et panel i kartfanen med årsak og en
  «Prøv å laste kartet igjen»-knapp. Resten av appen går som normalt.

Testen booter appen i jsdom **uten** Leaflet i det hele tatt og bekrefter at den
starter, at Plan-fanen tegnes, og at alle kartfunksjonene har vakt.

---

## Norsk flaggpalett, farge per fane, kompaktere flate

**Paletten.** Flaggblå (`#0A2A57`) bærer topplinje, bunnmeny og app-ikon.
Flaggrød (`#C8102E`) er reservert primærhandlingen – «Finn reise», målpunktet B
og innstilte avganger. Ikonet er tegnet på nytt i flaggets tre farger: blå flate,
hvit rute, rød destinasjon med hvit ring rundt. Mørk modus bruker samme to farger,
bare lysnet så kontrasten holder.

**Egen farge per fane.** Hver fane har sin identitet, brukt kun på topplinjens
glød, den stiplede stripa, indikatoren og det aktive ikonet – aldri på innholdet:

| Fane | Farge | |
|---|---|---|
| Plan | `#1B4FA0` | flaggblå |
| Avganger | `#C8102E` | flaggrød |
| Kart | `#0F6F6C` | fjord |
| Lagret | `#8A5A12` | messing |

Fargen ligger i `--tab` på `#app[data-tab]`, og elementene som bruker den har
`transition: background .45s`, så skiftet **glir** over i stedet for å hoppe.

**Bevegelse, uten å overdrive.** Alt er kort og enveis:
- Fanebytte glir sidelengs i den retningen du trykket – rekkefølgen i menyen
  bestemmer om det går framover eller bakover.
- Avgangsrader og reisekort kommer inn forskjøvet, 26 ms per rad med tak på
  260 ms, så en lang liste aldri føles treg.
- Avganger som går straks får et lavmælt lysstrøk over raden.
- Indikatoren i bunnmenyen fjærer på plass, ikoner skalerer lett ved trykk.
- Alt slås av under `prefers-reduced-motion`.

**Kompaktering.** Målt i Chromium på 384 px:

| | Før | Etter |
|---|---|---|
| Topplinje | 64 px | 56 px |
| Bunnmeny | 67 px | 56 px |
| Bunnen av Plan-skjemaet | 688 px | 610 px |

Hele reiseskjemaet – hurtigreise, A/B, verktøy, tidsvalg, transport og
«Finn reise» – får nå plass over skjermkanten med 130 px til overs, mot 54 px før.

Kontrasten er målt etter endringen: laveste forhold er 5,0:1 (brødtekst), altså
over WCAG AA på alt.

**Bonus fra måleoppsettet:** Leaflet kaster hardt på `NaN`-koordinater og river da
med seg hele kartvisningen. Alt som skal på kartet passerer nå en `okLL()`-vakt.

---

## Hjem og Jobb i Hurtigreise virket ikke

To feil samtidig.

**1. Kortet var ugyldig HTML.** Endre-knappen lå som `<button>` *inne i* kortets
egen `<button>`. Nøstede knapper er ikke lov, så HTML-parseren lukker det ytre
kortet i det øyeblikket den møter det indre. Resultatet ble at navnet og
sanntidslinjen havnet **utenfor** knappen — kortet mistet innholdet sitt og
klikkhåndteringen gikk i stykker så snart Hjem eller Jobb var satt opp.
Endre-knappen er nå en søsken-knapp i en egen `.comm-cell`, absolutt plassert
oppe i hjørnet. Testen leter etter `button button` og feiler hvis noen nøster igjen.

**2. `pickAC` kastet TypeError.** Da du trykket på et treff i søkelisten:

```js
if(acFor.id==='commInput'){acClose();acFor.blur();pickCommuter(it)}
```

`acClose()` setter `acFor=null`, og linjen etter kaller `acFor.blur()`. Hver
eneste gang. Det tok også stoppestedssøket i Avgangsfanen. Feltet tas nå vare på
i en lokal variabel før `acClose()`.

I tillegg: oppsettpanelet har fått en tittel som sier hva du holder på med
(«Sett opp Hjem» / «Endre Jobb»), søkefeltet ligger på egen linje i full bredde,
og «Din posisjon» / «Avbryt» er to like brede knapper under. Endre-ikonet er byttet
fra et kryss til en blyant — et kryss så ut som «slett».

---

## Symmetri i menyene

Radene var bygget som `flex-wrap` med knapper av ulik bredde, så høyrekanten ble
ujevn og «Båt» havnet alene på en tredje linje i avgangsfilteret.

| Rad | Før | Nå |
|---|---|---|
| Via-stopp / Bytt / Din posisjon | tre ulike bredder på én flytende rad | `grid` med tre like kolonner — målt 113/113/113 px |
| Transport (Plan) | fem chips, flyt | `grid` 3×2 med «Alle» først — 114 px hver |
| Filter (Avganger) | seks chips, «Båt» alene på rad tre | samme 3×2-rutenett — identisk med Plan |

Begge transportvelgerne bygges nå fra **én** felles liste og deler kode for
opptegning og av/på-logikk, så de kan ikke drive fra hverandre igjen. «Alle» er
lagt til i Plan-fanen også — det gir seks celler som fyller nøyaktig to hele rader,
og en tydelig måte å nullstille valget på.

«+ Legg til via-stopp» ble tidligere skjult ved fire stopp, noe som ville etterlatt
en tom rutenettcelle. Den deaktiveres nå i stedet, så raden holder formen.

Bredene er verifisert i ekte Chromium på 384 px (Galaxy S24), ikke bare i CSS.

---

## Grensesnitt

**`[hidden]` virket ikke.** `.chip-btn` og `.live-pill` setter `display:inline-flex`,
som overstyrer nettleserens `[hidden]{display:none}`. Derfor sto «Vis på kart» og
det grønne LIVE-merket alltid synlig — også på skjermbildet ditt, før du hadde valgt
et stoppested. Én regel fikser alle tre steder:

```css
[hidden]{display:none!important}
```

**Topplinjen.** «NORGE · PENDLER · SANNTID» brøt over to linjer og skjøv logoen ut
av balanse. Undertittelen er kortet til «NORGE · SANNTID» med `white-space:nowrap`
og fast `min-height` på topplinjen.

**Feil kan kopieres.** Du skrev at du ikke fikk kopiert feilmeldingene. Nå:
- feilmeldinger med teknisk detalj får en «KOPIER»-knapp og blir stående i 11 sekunder
- «Prøv igjen» og «Kopier feilen» på feilkort i Plan- og Avgangsfanen
- en feillogg under **Lagret** som holder de 40 siste feilene, med kopierknapp
- `window.onerror` og `unhandledrejection` fanges også opp

**Avvik vises.** `situations` hentes nå i både avgangs- og reisespørringen, vises som
banner i avgangsfanen, som «N avvik»-merke på reisekortene og under hver etappe i
detaljvisningen. Innstilte avganger merkes «INNSTILT» og gjennomstrekes.

---

## Priser

`TripPattern.fareProducts` finnes ikke i v3, så den gamle prisspørringen feilet
alltid og falt stille tilbake til anslaget. Kallet er fjernet, og anslaget er
tydelig merket «(anslag)» også i Lagret-fanens forbehold.

---

## Ikoner og installasjon

Manifestet pekte bare på SVG, og appen tegnet i tillegg et apple-touch-icon på
`<canvas>` ved hver oppstart. Chrome bygger en WebAPK ved installasjon og vil ha
**ekte PNG i 192 og 512 px** — derfor så hjemskjermikonet uskarpt eller beskåret ut.

Nytt sett i `icons/`:

| Fil | Bruk |
|---|---|
| `icon-192.png`, `icon-512.png` | installasjonsikon (`any`) |
| `maskable-192.png`, `maskable-512.png` | Android adaptivt ikon, motivet innenfor 66 % trygg sone |
| `monochrome-512.png` | Samsung One UI temaikon |
| `apple-touch-icon.png` | iOS hjemskjerm, 180 px |
| `favicon.svg`, `favicon-32.png`, `favicon.ico` | fanikon |
| `icon.svg`, `maskable.svg`, `monochrome.svg` | vektorkilder |
| `logo.svg` | merkevare-lockup, ordmerket er ekte vektorbaner |

Canvas-koden er fjernet. Service worker registreres med `{scope:'./'}` og alle
stier i manifestet er relative, så alt virker i en undermappe på GitHub Pages.
`sw.js` har fått navigasjonsfallback, så dyplenker og offline-start fungerer.

---

## Slik legger du det ut

1. Last opp alt til rota av repoet, med `icons/` som en ekte mappe.
2. Pass på at `.nojekyll` blir med.
3. **Settings → Pages** → `Deploy from a branch`, `main`, `/ (root)`.
4. Åpne `https://<bruker>.github.io/<repo>/` i Chrome → menyen → *Legg til på startsiden*.

Oppdaterer ikke ikonet seg? Android cacher WebAPK-ikonet: avinstaller appen, tøm
Chromes bufrede bilder, last siden på nytt og installer igjen.

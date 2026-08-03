# REIS Norge – hva som ble fikset

Alt under er verifisert mot Entur live 31. juli 2026, ikke gjettet.
`node test-live.js` kjører appens egne spørringer mot API-et (15 tester),
`node test-dom.js` tester grensesnitt og logikk i jsdom (220 tester),
`python3 shot.py`, `measure.py`, `swipe_test.py`, `fill_test.py`, `qt_test.py`,
`sec_test.py`, `overlap_test.py`, `perf_test.py`, `font_test.py`, `a11y.py` og
`polish_test.py`, `plan_test.py`, `soak.py`, `regress_map.py` og `update_test.py`
måler layout,
farger, kontrast, sveip og zoom-sperre med ekte touch-hendelser i Chromium på
Galaxy S24-bredde. Alle grønne.

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

## Navn på holdeplassene

Kartet viste bare prikker – du måtte trykke på hver enkelt for å vite hva den
var. Navn på alle 45 samtidig ville blitt en grøt, så de plasseres **grådig med
kollisjonstest**:

- Viktigst først: tog og T-bane før trikk og buss, og nærmeste før fjerneste.
- Hvert navn får plass til høyre for nålen. Er det opptatt eller utenfor
  skjermen, prøves venstre side. Passer ingen av delene, hoppes navnet over –
  nålen står igjen alene.
- Navn vises først fra zoom 14. Under det er stoppene for tett.
- Under zooming skjules navnene, så de ikke flimrer mens kartet beveger seg.
- Mørk plate bak teksten, så den er lesbar også over satellittbilder.

Målt i nettleser på fem zoomnivåer:

| Zoom | Nåler | Navn vist | Overlappende par |
|---|---|---|---|
| 13 | 45 | 0 (under grensen) | 0 |
| 14 | 45 | 20 | **0** |
| 15 | 19 | 10 | **0** |
| 16 | 7 | 4 | **0** |
| 17 | 5 | 1 | **0** |

> Første versjon viste bare 15 navn på zoom 14, og «Oslo S» manglet selv om det
> var god plass. Årsaken var at navnet bare ble forsøkt til høyre for nålen –
> lå nålen langt til høyre, fikk det aldri plass. Med venstre side som reserve
> gikk antallet opp til 20, fortsatt uten en eneste overlapp.

---

## Tre meldte problemer – alle var ekte

### 1. Bytteanimasjonen «snudde hele firkanten»
Riktig observert. Animasjonen flyttet hele `.stop-row` – etikettene «Fra» og
«Til», prikkene og skillelinja fulgte med. Det er ikke rammen som bytter plass,
det er innholdet.

Nå animeres bare selve feltet: teksten glir ut, blir usynlig, og kommer tilbake
på motsatt rad. Etiketter og prikker står stille. Byttet skjer 168 ms inn i
animasjonen – nøyaktig i det usynlige øyeblikket.

### 2. «Finner aldri trikk eller T-bane i søk»
Søket **returnerte** holdeplasser hele tiden – de var bare umulige å se.
Målt på «Majorstuen»: ett metrostoppested og fem POI-er (kirke, skole,
barnehage, politistasjon), alle med samme grå nål og ingen merking.

To ting rettet:
- Vi hentet bare 8 treff. Nå hentes 20, og **holdeplasser sorteres først** –
  inntil seks stopp og seks adresser, aldri bare det ene eller det andre.
- Hvert treff viser **hva det er**: fargelagt ikon for trikk, T-bane, buss, tog
  eller båt, og teksten «Trikk», «T-bane», «Adresse» foran adresselinja.
  Enturs `category`-felt (`onstreetTram`, `metroStation`, …) gir dette gratis;
  vi brukte det bare ikke.

### 3. «Følger meg ikke ordentlig når jeg går, reiser eller kjører»
Målt ved simulert bevegelse i tre hastigheter. Følgingen var teknisk presis –
2,4 m avvik ved gange, 2,1 m i bil. Det som manglet var **retning**: du så hvor
du var, men ikke hvilken vei du vendte. Da må du gå noen meter for å skjønne om
du går riktig vei.

- Posisjonsprikken har fått en **retningskjegle**, som i kartappene. Verifisert
  mot alle fire himmelretninger: 0° avvik i alle.
- Retningen kommer fra GPS når den finnes, ellers regnes den ut fra bevegelsen.
- Kjeglen glattes ut, så den ikke rykker ved hver GPS-unøyaktighet.
- Følgingen **zoomer inn til gatenivå** (16) når den starter, hvis du er lenger
  ute. Zoomer aldri ut – du kan ha valgt selv. Målt avvik falt fra 2,4 m til
  0,3 m samtidig.

> Retningen kom først ikke fram nettopp ved **gange**. Årsaken var min egen:
> referansepunktet ble flyttet ved hver måling, så avstanden aldri rakk
> terskelen når du bare går fire meter mellom hver. Punktet står nå stille til
> du faktisk har flyttet deg seks meter.

---

## Feiljakt: to alvorlige kappløp

Systematisk gjennomgang på jakt etter feil som påvirker funksjon, ikke utseende.
Metoden var å kjøre appen hardt (`stress_test.py`: alle knapper i alle faner,
uten nett, API-feil 500, tomt svar, avslått posisjon, rare inndata, rask
fanebytting) og deretter angripe det stresstesten ikke kan se: **kappløp**.

De to alvorligste feilene var av samme type – **riktig utseende, feil innhold,
ingen feilmelding.**

### 1. Reisesøket kunne vise en reise til feil sted
Søker du Oslo S → Majorstuen, bytter mål til Nationaltheatret og søker på nytt
før første svar er kommet, overskrev det trege gamle svaret det nye.
Skjemaet sa **Nationaltheatret**, resultatene gjaldt **Majorstuen**. Ingenting
tydet på at noe var galt.

### 2. Avgangstavla kunne vise feil stopps avganger
Samme mønster: overskriften sa **Majorstuen**, mens listen under tilhørte
**Jernbanetorget**. Målt direkte: `departuresFor` pekte på det gamle stoppet
mens `departStop` og overskriften pekte på det nye.

Dette er verre enn en tom skjerm. En tom skjerm ser man; feil avgangstid gjør at
man går til feil holdeplass.

**Rettelse:** hvert søk og hver henting får et løpenummer. Kommer et svar som
ikke er det siste, kastes det – også i feilhåndteringen, der en gammel feil
ellers kunne overskrive et nytt, gyldig resultat.

### Mindre funn samtidig
- **Taket på hurtigreiser gjaldt bare ved lagring.** Lå det flere fra en eldre
  versjon, ble alle tegnet, men bare de tre øverste fikk sanntid. Kappes nå ved
  lesing også, med én felles konstant.

### Det som viste seg å være i orden
| Sjekk | Resultat |
|---|---|
| Alle knapper i alle faner (27 stk.) | ingen krasj |
| Uten nett | feilmelding vises, avgangsbuffer brukes (25 rader) |
| API svarer 500 | feilmelding, knappen låser seg ikke |
| API svarer tomt | «Ingen ruter funnet» med forslag |
| `localStorage` sperret (privat modus) | appen starter og virker |
| Posisjon avslått | forklarende melding, ingen krasj |
| 90 tegn langt stedsnavn | sprenger ikke kortet |
| Ugyldige koordinater | håndtert, ingen unntak |
| Rask fanebytting ×36 | én aktiv visning, ingen feil |

> Én kjøring av kappløpstesten feilet på nytt etterpå. Den falt sammen med
> 503-svar fra Entur – jeg har kjørt mange hundre kall mot API-et i dag – og
> fire påfølgende kjøringer var rene. Jeg kan ikke utelukke at det finnes en
> gjenværende kant her, så testen er beholdt som `race_test.py`.

---

## Automatisk oppdatering, levende posisjon, mindre støy

### Appen oppdaterer seg selv fra GitHub
Ja, det lar seg gjøre. Laster du opp nye filer, oppdager appen det innen ti
minutter – eller med én gang du henter den fram igjen – og **bytter til den nye
versjonen av seg selv**.

Men aldri midt i noe. Automatikken krever at *alt* dette stemmer:

- du står på Plan-fanen, på selve skjemaet
- ingen dialog, ark eller søkeliste er åpen
- ingen søk pågår
- kartet følger deg ikke (du er ikke underveis et sted)
- du har ikke rørt skjermen på ti sekunder

Er du opptatt, viser den banneret i stedet og prøver igjen hvert femte sekund
til du blir stående stille. Å laste om under fingeren på noen er verre enn å
vente. Automatikken kan slås av under **Mer → Teknisk**.

Verifisert begge veier: ny versjon lagt ut mens appen sto i ro ble byttet inn
uten spørsmål; ny versjon lagt ut med et ark åpent ga banner, ingen omlasting,
og oppdaterte først ved trykk.

### Posisjonen viser at den lever
Følger kartet deg, sender prikken ut ringer – to forskjøvne pulser, som et
ekkolodd. Står ringene stille, har appen ikke fersk kontakt. Mister vi signalet,
stopper ringene og prikken blekner i stedet, så forskjellen på «følger deg» og
«leter» er synlig uten å lese noe.

> Ryddet samtidig opp i to funksjoner som gjorde det samme (`setDotLive` med
> argumenter og `setDotState` som leser tilstanden). To kilder til samme sannhet
> kan gå ut av synk; nå er det én.

### Meldinger som gjentok seg
Meldinger fra ting som kjører i løkke kunne komme igjen og igjen – som
«Ingen kjøretøy i dette kartutsnittet» hvert 12. sekund utenfor byene.

- `toastOnce()` viser samme tekst maks én gang i minuttet, uansett hvor den kommer fra.
- Status for kartlagene står **på laget** i lagvelgeren («12 i utsnittet»,
  «ingen i utsnittet»), ikke som varsel midt på skjermen.
- «Henter severdigheter…» og «Henter bysykler…» er fjernet helt – du ser jo at
  det skjer.

---

## Klar for ekte brukere: ærlighet og drift

Tre ting som må på plass før noen andre enn deg bruker appen.

### «Om appen og personvern»
Ny seksjon i Mer. Sier rett ut at REIS er **et uavhengig hobbyprosjekt**, ikke
laget av Entur, Ruter eller noe transportselskap. Videre: at det ikke finnes
noen server eller konto, at alt ligger i din egen nettleser, hva posisjonen
brukes til, hvilke tjenester som kalles, og at det ikke finnes sporing eller
reklame. Rutedata er kreditert Entur under NLOD.

Listen over hva som er lagret **genereres fra `localStorage`**, ikke skrevet for
hånd. Da kan den ikke bli usann når vi legger til eller fjerner noe senere.

### «Rapporter» het noe den ikke var
Funksjonen så ut som crowdsourcing – flere reisende som melder «heis ute» – men
rapportene lå i `localStorage` på din egen telefon. Med én bruker er det en
notatblokk; med hundre er det et løfte appen ikke kan holde.

Den heter nå **Notat**, stripen er merket «Dine notater» med personikon, og
dialogen sier tydelig at ingen andre reisende ser dem. Ordet «Rapporter»
finnes ikke lenger i grensesnittet.

### Helsesjekk
Appen har ingen server, så endrer Entur et felt, slutter noe å virke – og
hverken du eller brukeren ville visst hvorfor. **Mer → Teknisk → Kjør
helsesjekk** kaller de fire viktigste spørringene og kontrollerer at svarene har
formen koden forventer: avganger, reisesøk, stedssøk og holdeplasser i nærheten.

Sjekken peker på **hvilket felt** som svikter, ikke bare at noe er galt.
Verifisert ved å simulere at Entur fjerner `expectedDepartureTime`:

```
FEIL Avganger: expectedDepartureTime mangler
OK   Reisesøk: svarer som forventet
OK   Stedssøk: svarer som forventet
OK   Holdeplasser i nærheten: svarer som forventet
```

> En test som bare kan si ja er verdiløs. Derfor kjøres helsesjekken både mot
> ekte API-svar (alle fire grønne) og mot et manipulert svar, for å bevise at
> den faktisk fanger en endring.

---

## Gjennomgang: overlapp, fanebytte, avkuttet tekst

Meldt av bruker: «Zoom inn for å se holdeplasser» la seg oppå modusraden. Det
ble utgangspunktet for en systematisk gjennomgang (`audit_test.py`) som går
gjennom **14 tilstander** i appen og måler faktisk overlappende areal mellom alle
flytende elementer, om noe havner utenfor skjermen, og om tekst er avkuttet.

**Feilen brukeren så:** hintet lå på `top:14px`, modusraden på `top:12px` – begge
festet til toppen uten å vite om hverandre. Toppen av kartet stables nå etter
målt høyde, akkurat som bunnen allerede gjorde: modusrad → hint → kontekst-chip.

**To feil til som gjennomgangen fant, og som ingen hadde meldt:**

1. **Kontekst-chipen overlappet modusraden med 4 557 px²** når du åpnet en reise
   i kartet. Årsaken var timing: chipen ble tegnet i samme øyeblikk som
   modusraden dukket opp, og målingen skjedde før nettleseren hadde lagt ut
   endringen. Stabelen måles nå også neste bilde (`requestAnimationFrame`).
2. **Etiketten «Stopp» ble kuttet.** Kolonnen var låst til 28 px for å passe
   «Fra»/«Til»; «Stopp» trenger 37. Fikk egen bredde.

**Resultat etter rettelsene:**

| Sjekk | Resultat |
|---|---|
| Tilstander gjennomgått | 14 |
| Overlappende elementer | **0** |
| Elementer utenfor skjermen | **0** |
| Avkuttet tekst | **0** |
| Fanebytte (alle 6 kombinasjoner) | alle ok |
| Sideskriptfeil | **0** |

> Første versjon av gjennomgangen ga en haug med falske alarmer: den regnet
> `.tap`-elementenes usynlige 44 px trykksone som «avkuttet tekst», og innhold
> under skjermkanten i rullelister som «utenfor skjermen». En test som roper ulv
> er verre enn ingen test, så den ble strammet inn før tallene ble brukt til noe.

---

## «Følg meg» fulgte ikke

Meldt av bruker, og reprodusert med simulert gange i nettleser. **Tre feil lå
oppå hverandre**, og den siste var den alvorlige.

### 1. Følgingen slo seg av i samme øyeblikk den ble slått på
`map.setView()` fyrer `movestart`, og `movestart` var koblet til «brukeren dro i
kartet – slutt å følge». Rekkefølgen var: sentrer kartet → start følging →
zoom-animasjonen fyrer `movestart` → følgingen avsluttes.

Appens egne bevegelser går nå gjennom `moveSelf()`, som markerer at det er vi
som flytter. Bare `dragstart` – et ekte fingerdrag – avbryter.

### 2. Dobbelttrykk innen 450 ms var i praksis umulig
Og ingen visste at det fantes. Knappen går nå gjennom tre tilstander ved helt
vanlige trykk: **sentrer → følg → av**. Samme mønster som kartappene folk kjenner.

### 3. Ett forbigående GPS-avbrudd drepte følgingen permanent
Dette er den viktigste. Feilhåndteringen kalte `stopFollow()` på **enhver** feil
fra `watchPosition`. Men GPS mister signalet hele tiden når du går: under en bro,
inn i en tunnel, mellom høye hus. Overvåkeren lever videre og henter seg inn av
seg selv – vi kastet den bort ved første hikke.

Nå avsluttes følgingen kun ved **avslått tillatelse** (kode 1). Mister vi
signalet, pulserer knappen mens vi venter, og alt fortsetter når posisjonen er
tilbake. Er signalet borte i mer enn 25 sekunder, sier appen fra – men slutter
fortsatt ikke å prøve.

> Målingen som avslørte det: en rå `watchPosition` i testen fikk **fem
> posisjoner og én `POSITION_UNAVAILABLE`**. Appen fulgte pent til feilen kom,
> og stoppet der. Etter rettelsen følger kartsenteret hele veien
> (59.9119 → 59.9194) og følgingen står fortsatt på.

I tillegg: sporingen pauses når appen går i bakgrunnen og gjenopptas når du
henter den fram, så den ikke tapper batteri i lomma.

---

## Hvem er start, og hvem er mål?

«A» og «B» var to like sirkler med hver sin bokstav. Du måtte huske
konvensjonen, og fargen var det eneste andre holdepunktet – som ikke hjelper
alle. Nå skiller de seg på **tre** måter samtidig:

| | Start | Mål |
|---|---|---|
| Form | sirkel | dråpe med spiss ned i punktet |
| Innhold | «A», eller **personikon** hvis det er deg | flaggikon |
| Etikett | «Fra», eller **«Din posisjon»** | «Til» |

**Startpunktet vet om det er deg.** Ligger startpunktet under 60 meter fra din
egen posisjon, byttes «A» ut med et personikon, markøren får appens blåfarge med
en ring rundt, og etiketten sier «Din posisjon». Da er det ingen tvil om hvilken
prikk som er deg.

**Posisjonsprikken lå oppå målmarkøren.** På skjermbildet ditt dekket den blå
GPS-prikken delvis B-markøren. Den er nå mindre og ligger under rutemarkørene i
stablingen, så målet alltid er synlig.

**Kortet fargekoder samme retning som kartet** – en grønn prikk foran
startstedet, en rød foran målet. Da henger «Oslo S → Fjeldlund barnehage»
visuelt sammen med markørene over.

Form og tekst betyr at det virker uten å stole på farge alene.

---

## Kartfanen er ikke lenger tom

Målingen var tydelig: kartfanen hadde bare 7 knapper og 9 % dekket flate – den
var ryddig. Problemet var det motsatte. Du åpnet Kart og fikk et kart uten
innhold: **én** markør, ingen holdeplasser, alle datalag avslått.

**1. Holdeplasser tegnes med én gang.** Nålene følger utsnittet og oppdateres når
du panorerer eller zoomer. Trykk på en nål → samme stoppestedskort som ellers.

> To feil funnet underveis. Entur teller `maximumResults` på **plattformer**,
> ikke stoppesteder – ber du om 20 med `multiModalMode:parent`, får du bare 7
> stopp tilbake. Vi over-etterspør nå (80–120) og kutter i visningen i stedet,
> med tak på 45 nåler. Bremsen bygde dessuten bare på klokka, så zoom utløste
> ingen ny henting; den ser nå på selve utsnittet. Målt: 45 nåler på zoom 13,
> 19 på zoom 15, 7 på zoom 16.

**2. Kjøretøy slås på av seg selv.** Levende busser er appens mest slående
funksjon, men lå begravd i lagvelgeren. Fra zoomnivå 14 kommer de automatisk, og
forsvinner igjen når du zoomer ut – men **bare** hvis det var appen som slo dem
på. Har du valgt selv, blir valget respektert. Hoppes over på treg forbindelse.

**3. Modusraden vises bare når den betyr noe.** Kollektiv/Bil/Sykkel/Gå gjelder
ruteberegning, og lå der som en meny uten funksjon før du hadde søkt. Nå dukker
den opp når det finnes to punkter å regne mellom.

**4. «Følg meg».** Trykk posisjonsknappen to ganger, så låser kartet seg til deg
mens du går. Knappen lyser mens den er aktiv, og panorerer du selv, slipper den
taket. En nøyaktighetssirkel vises når GPS-en er upresis (over 25 m).

**5. «Hva er her?»** Et vanlig trykk på kartet gir nå stedsnavn, de nærmeste
holdeplassene med gåavstand, og knappene «Reis hit» / «Reis herfra». Før måtte
du først armere en knapp for at kartet skulle reagere i det hele tatt.

Etter endringene: **46 markører** på skjermen ved åpning, mot 1 før – og
kartflaten er *mindre* dekket enn før (4 % mot 9 %), fordi modusraden er borte
når den ikke trengs.

---

## Fra/Til-raden: skinne, prikker og et bytte man ser

**Skinnen henger sammen med prikkene nå.** Den stiplede linja var tegnet som et
løst element med en fast venstremarg (`left:34px`), mens prikkene lå i et
flex-oppsett – de kunne ikke annet enn å gli fra hverandre. Skinnen tegnes nå
*inne i* prikkekolonnen, med halve streken over og halve under hver prikk.
Første rad har ingen strek oppover, siste ingen nedover. Målt i nettleser:
prikker og skinne står på **nøyaktig samme x** (74 px), uansett hvor bred
etiketten er.

**Bytt-knappen snurr.** Ett trykk gir en halv omdreining med fjærende kurve,
radene glir kort forbi hverandre, og du kjenner et lite vibrasjonsklikk. Byttet
skjer 150 ms inn i bevegelsen, så du ser *hva* som skjedde – ikke bare at noe
skjedde. Under `prefers-reduced-motion` skjer byttet umiddelbart uten animasjon.

**«Din posisjon» sto på begge radene.** To identiske knapper rett over hverandre
leste som en feil. Nå står den bare på startpunktet, slik Ruter gjør det, og
Til-raden viser i stedet ledeteksten «Hvor skal du?».

Ledetekstene er samtidig kortet ned: «Start – f.eks. Oslo S» → **«Hvor reiser du
fra?»**, «Mål – f.eks. Vigelandsparken» → **«Hvor skal du?»**.

> Testrammen avslørte seg selv her: jeg skrev først en `async`-test for byttet,
> men rammen er synkron og ventet aldri på løftet – den ville «bestått» uansett
> resultat. Byttet verifiseres nå i nettleser (`swap_test.py`), og jsdom-testen
> sjekker bare logikken den faktisk kan se.

---

## Roligere topplinje

Tre ting gjorde den urolig, og alle tre var pynt uten innhold.

**Den animerte stripa er borte.** En stiplet linje som løp sidelengs i loop –
den lignet sperrebånd og trakk blikket bort fra innholdet hele tiden. Erstattet
med en 2 px hårstrek i fanens farge som toner ut mot høyre. Den gjør samme jobb
(markerer kanten, viser hvor du er) uten å rope. Målt: **null animasjoner** i
topplinja nå.

**Klokka er fjernet.** «14:19 · OSLO» sto rett under telefonens egen klokke i
statuslinja – appen kjører `standalone`, så den er alltid synlig. To klokker
10 mm fra hverandre er ikke informasjon, det er støy.

**Undertittelen sier nå hvor du er.** «NORGE · SANNTID» var ren dekorasjon.
Nå står det **Planlegg reisen**, **Sanntidsavganger** eller **Kart og kjøretøy**,
og teksten toner mykt over når du bytter fane. Samme plass, faktisk innhold.

I tillegg: logoen er lettere (32 px, uten tung slagskygge), ordmerket har
strammere sperring, og gløden i hjørnet er dempet fra 34 % til 22 %.

Topplinja rommer nå **to** elementer – merket og menyknappen – mot fire før.
Høyde 54 px, kontrast 14,2:1 på ordmerket og 9,1:1 på konteksten.

---

## «Din posisjon» ligger i feltet

Som i Ruter-appen: knappen står *inne* i Fra-raden i stedet for som en egen
lenke under kortet. Ett element mindre å lese, og valget står der du faktisk
skal fylle inn.

- Vises bare når raden er tom og ikke har fokus – begynner du å skrive,
  forsvinner den umiddelbart.
- Ligger i **alle** radene, ikke bare Fra. «Til = min posisjon» er nyttig når
  noen skal hente deg, og det kostet ingenting å støtte.
- Etiketten tilpasser seg raden: «Bruk din posisjon som startpunkt / mål /
  via-stopp».

### FIX funnet av testen: knappen kunne ikke trykkes
Å trykke knappen ga feltet fokus, og `:focus-within` skjulte knappen **midt i
trykket**. Da fullførte aldri klikket – `mouseup` traff et annet element enn
`mousedown`. På telefon ville den oppført seg som en død knapp.

Løst ved å hindre fokusflyttingen (`pointerdown`/`mousedown` med
`preventDefault`), så knappen står stille til trykket er ferdig.

> Måleskriptet for trykkflater ga samtidig et falskt utslag: en knapp nederst på
> siden lå delvis bak bunnmenyen, og `elementFromPoint` traff menyen i stedet.
> Skriptet hopper nå over elementer som ikke er fritt målbare, i stedet for å
> melde dem som for små.

---

## Én vei til hver funksjon

Talte opp synlige kontroller per fane, og Avganger skilte seg ut med **45**.
Årsaken var at flere ting fantes to steder.

| | Før | Etter |
|---|---|---|
| Avganger | 45 knapper | **33** |
| Seksjoner i «Mer» | 9 | **5** |

**Transportfilteret er borte fra Avganger.** Det lå der med seks knapper
samtidig som transportvalget nettopp var flyttet til innstillingene – to steder
som gjorde nesten det samme, med hver sin tilstand. Nå finnes valget ett sted.

**Søkefeltet er borte fra Avganger.** Det gjentok søkekortet på Plan. I stedet
står det **«Bytt stopp»**, som tar deg til kortet i avgangsmodus med markøren i
feltet. Én implementasjon, ett sted å vedlikeholde.

**Nabostoppene ligger bak én knapp.** Fem holdeplasser ble listet opp samtidig;
du trenger sjelden mer enn den du står på. Knappen sier hvor mange som er skjult:
«4 stopp til i nærheten».

**«Vis på kart» er fjernet.** Kartfanen ligger ett trykk unna i menyen uansett.

**«Mer» er ryddet.** Versjon, Systemtid og Feillogg er feilsøking, ikke
innstillinger. De ligger samlet bak **Teknisk**, lukket som standard, slik at
arket viser fem meningsfulle punkter i stedet for ni blandede.

> Underveis fant testene en skade i selve testrammen: tidligere Python-baserte
> tekstbytter hadde lagt igjen bokstavelige `\n` i en JavaScript-blokk, slik at
> hele testoppsettet kastet ved oppstart. Rettet, og verdt å merke seg – verktøy
> kan gå i stykker på samme måte som koden de tester.

---

## Samlet søkekort

Etter mønster fra Ruter: **«Finn reise»** og **«Se avganger»** ligger nå i ett
kort med en fanevelger på toppen, i stedet for å være spredt over to faner og
fire løse knapperader.

**Fra og Til er rader, ikke bokser.** Hvert felt hadde sin egen ramme, avrunding
og skygge – tre kanter å lese før man kom til teksten. Nå er kortet rammen, og
radene deler én tynn skillelinje. Etiketten er tekst («Fra», «Til», «Via») i
stedet for A/B-medaljonger, og punktet er redusert til en liten farget prikk.
Fokus vises med en strek som gror ut fra venstre.

**Bytt-knappen ligger i margen**, loddrett midt mellom første og siste rad. Den
plasseres etter måling, ikke en fast verdi – legger du til via-stopp, følger den
med. Målt avvik fra senter: **0 px**, både med og uten via-stopp.

> Den satt først 18 px for lavt. Årsaken var at posisjonen ble regnet ut før
> skriftene var ferdig lastet, slik at radene flyttet seg etterpå. Løst ved å
> måle med `offsetTop` (uavhengig av rulling) og måle på nytt når
> `document.fonts.ready` løser seg.

**«Se avganger» sparer et steg.** Du søker etter en holdeplass rett i kortet, og
et treff tar deg direkte til tavla. «Nær meg» finner nærmeste stopp med ett
trykk. Valgt modus huskes.

Via-stopp og «Din posisjon» er dempet til tekstlenker – de er sekundære
handlinger og skal ikke konkurrere med «Finn reise».

---

## «Må lukke og åpne appen før ting virker»

Symptomet ble sporet med en slitasjetest (`soak.py`) som bruker appen som en
person over fem runder og måler tilstand underveis. Den avdekket to ting.

### Hovedårsaken: appen oppdaget aldri nye versjoner
Det var ingen håndtering av oppdateringer i det hele tatt – null forekomster av
`updatefound` eller `controllerchange`. Når en ny versjon ble lastet opp, hentet
nettleseren riktignok ny `sw.js`, men **siden som allerede kjørte beholdt gammel
HTML og JavaScript**. Først når appen ble lukket og åpnet lastet den nye koden.

Det er ikke tilfeldig – det skjer hver gang det kommer en ny build.

Rettet i begge ender:

- **Service workeren tar ikke lenger over i det skjulte.** `skipWaiting()` kjørte
  automatisk ved installasjon, slik at ny worker serverte nye filer til en side
  som fortsatt kjørte gammel kode. Nå venter den, med mindre ingen side er åpen.
- **Appen sier fra.** Et banner nederst: «Ny versjon av REIS er klar» med
  «Oppdater». Ett trykk ber ny worker ta over, og siden lastes på nytt én gang.
- Det ses etter oppdatering ved oppstart, hver gang appen hentes fram igjen, og
  hver halvtime. **Mer → Versjon** har også en manuell knapp.

Bevist ende-til-ende: en ny versjon legges ut mens appen står åpen, banneret
dukker opp uten omstart, og ett trykk laster den nye koden.

### Bifunn: en unntaksstorm fra kartet
Slitasjetesten viste at feilloggen fyltes til taket (40) allerede etter to søk,
med `Invalid LatLng object: (NaN, NaN)` – **43 unntak** i en kort økt.

Årsaken: Leaflet projiserer mot containerens størrelse. Er kartet lastet, men
skjult, er størrelsen 0×0 og all matematikk gir `NaN`. `clearRoute()` kalte
`applyMapContext()` → `centerOnStop()` → `map.flyTo()` fra Plan-fanen.

- Alle karthandlinger krever nå at containeren faktisk har flate (`mapUsable()`),
  ikke bare at kartet finnes.
- Arbeid som kommer for tidlig legges i kø og kjøres når kartfanen åpnes.
- `clearRoute()` er pakket inn, og oppryddingen i `findJourney()` flyttet **inn**
  i try-blokken – lå den utenfor, kunne en feil avbryte et søk før det startet.

> Ærlig forbehold: jeg klarte å bevise unntaksstormen og at den er borte
> (43 → 0), men **ikke** at den var det som blokkerte reisesøket. `flyTo` kaster
> i en animasjonsramme, ikke i vår egen kallstakk, så den avbrøt ikke søket i
> reproduksjonen min. Hovedforklaringen på symptomet er oppdateringshåndteringen.

---

## Ryddigere Plan-fane

**Transportvelgeren er flyttet til innstillingene.** Seks knapper for trikk,
t-bane, buss, tog og båt tok ~200 px i den viktigste fanen for noe man endrer
sjelden. De ligger nå under **Mer → Transportmidler**, og valget huskes mellom
økter i stedet for å nullstilles hver gang.

Er filteret aktivt, sier appen fra der du faktisk ser det – en diskré linje rett
under søkeknappen: *«● ● Søker kun med buss · endre»*. Trykk på den, så åpnes
innstillingen og ruller til velgeren. Er ingenting valgt, vises den ikke.

Plan-fanen leser nå som en historie ovenfra og ned:

| | |
|---|---|
| Hurtigreise | dine lagrede ruter med neste avgang |
| Planlegg reisen | A → B og verktøy |
| Når | reis nå / avreise / ankomst |
| **Finn reise** | ligger nå 597 px oppe, godt over skjermkanten |
| I nærheten | fyller resten med noe du kan handle på |

«Ny hurtigreise» er dempet til en sekundær handling – den ropte like høyt som
søkeknappen før.

### FIX: «Alle» var nesten usynlig i mørk modus
Den valgte «Alle»-knappen brukte flaggblå som tekstfarge mot et mørkt kort:
**1,09:1 i kontrast**, altså praktisk talt uleselig. Nøytralfargen følger nå
temaet. Målt etter endringen: **11,2:1 i lys modus, 6,6:1 i mørk** – begge godt
over WCAG AA.

---

## Finpuss: tilgjengelighet, nattbuss og snarveier

### Trykkflater
20 av 26 knapper var under 44 px. Verstingene: tøm-krysset 28×28, og
seksjonsoverskriftene bare **20 px høye** – brede, men en tynn stripe å treffe.

Løst på to måter: små ikonknapper fikk en usynlig sone (`::before` med
`max(100%,44px)`) som ikke endrer utseendet, og knappene i rutenett ble hevet til
44 px høyde. Målt med ekte treffpunkt-testing, ikke bare bokshøyde: **0 av 26 for
små** nå. Tettheten er praktisk talt uendret.

### Skjermleser og tastatur
- Dialogene har `role="dialog"`, `aria-modal` og tittel; vekkealarmen `alertdialog`.
- **Fokusfelle:** Tab går ikke lenger ut av en åpen dialog, og fokus gis tilbake
  til knappen du kom fra. En finurlighet underveis: dialoger som tegnes to ganger
  (skjelett → innhold) lagret fokus fra sin egen forgjenger, så det forsvant.
  Fokus lagres nå bare første gang.
- Avgangstavla er `aria-live="polite"` med `aria-busy` mens den laster, og hver
  rad har en lesbar setning: «Buss 31 mot Fornebu, om 4 minutter, 2 minutter forsinket».
- Bunnmenyen er en `tablist` med `aria-selected`.
- Synlig fokusmarkering i faneidentitetens farge.

### «Siste avgang i kveld»
Ny knapp i avgangsfanen. Henter et døgn med avganger, grupperer per linje og
retning, og viser den siste før kl. 03 – nattbussene hører til kvelden før.
Øverst står svaret på det man faktisk lurer på: *«Aller siste fra Jernbanetorget
går 22:39 med linje 5 mot Stortinget – om 1t 34.»*

### Klokkeavvik
Nedtellingene ble regnet fra telefonens klokke. Går den feil, viser appen feil –
og du tror det er sanntidsdataene. `Date`-headeren fra Entur leses nå av hvert
kall, og alt som teller ned bruker `now()` i stedet for `Date.now()`. Avvik over
30 sekunder vises under **Mer → Systemtid**.

### Nettverksbevissthet
Appen pollet like hardt på 2G som på wifi. Intervallene skaleres nå ×3 på
2G/`saveData` og ×1,8 på 3G, og kjøretøylaget hoppes over med en beskjed.
Sekundtikk og klokke skaleres ikke.

### Dyplenker og snarveier
- `?stop=NSR:StopPlace:58366` åpner rett i tavla for det stoppet.
- `?from=…&to=…&go=1` søker en hurtigreise automatisk.
- Begge har en «Legg på startsiden»-knapp som kopierer lenken og forklarer
  framgangsmåten. Android lager da et eget ikon – i praksis en holdeplass-widget.
- **Share target:** del en adresse fra Kart eller Gmail rett inn i REIS som mål.
  Fire linjer i manifestet, ingen server.
- Manifestet har fått tre skjermbilder, så Androids installasjonsdialog viser
  hva appen er i stedet for bare navnet.

---

## Batteri, oppstart og offline

Tre svakheter funnet ved gjennomgang, ikke ved gjetting.

### 1. Appen jobbet videre i bakgrunnen
Sju `setInterval` gikk uansett om skjermen var på. De sjekket om *fanen* var
aktiv, men ikke om appen var synlig. Det tappet batteri, og ved retur sto
nedtellingen på gamle tall til neste poll.

Alle periodiske jobber går nå gjennom `every()`, som hopper over når
`document.visibilityState` er `hidden`. Ved retur:

- klokke og nedtellinger rettes opp **umiddelbart**
- var du borte i mer enn 10 sekunder, hentes friske data for den fanen du er på

Målt i nettleser: **0 Entur-kall på 26 sekunder** i bakgrunnen (mot minst ett
per 20 sekunder før), og ett kall umiddelbart ved retur.

### 2. Skriftene ble hentet fra Google
Første gang appen ble åpnet uten nett fikk du systemfont, og på treg forbindelse
blokkerte skriftene opptegningen. Nå ligger alle sju snitt i fila som
base64-WOFF2, subsettet til latin + norsk + de symbolene grensesnittet bruker –
**82 kB til sammen**.

Verifisert: null eksterne fontkall, og alle vekter som faktisk brukes er lastet.
Byggeskriptet `build_fonts.py` kan kjøres på nytt og bytter blokken ut i stedet
for å legge en ny oppå.

> Underveis fant testen at `IBM Plex Sans 700` og `IBM Plex Mono 400` var i bruk
> uten å være lastet – nettleseren syntetiserte dem. Begge er nå med.

### 3. Avgangstavla startet tom
Siste stoppested ble husket, men ikke avgangene. Nå bufres de siste 12
avgangene, og tavla viser dem umiddelbart – nedtonet, med «Lagret liste ·
oppdaterer…» over – til friske tall er på plass. Bufferet regnes som ubrukelig
etter en time.

Feiler hentingen mens du har en brukbar liste, beholdes lista med en beskjed i
stedet for at et feilkort tar over. Verifisert med nettverket avslått:
**12 rader på skjermen uten nett.**

> Testene mot Entur var samtidig skjøre: to av dem brukte «nå» som tidspunkt og
> feilet om natta, når det ikke går buss fra Fredrikstad. De bruker nå neste
> hverdag kl. 08.

---

## Sammenleggbare seksjoner, og paneler som ikke dekker hverandre

**Seksjoner kan legges ned.** Hurtigreise, Transport, Nylige og I nærheten har
fått en pil du kan trykke på. Valget huskes til neste gang du åpner appen.

- Animasjonen bruker `grid-template-rows: 1fr → 0fr`, som gir myk høyde uten at
  koden må måle innholdet – ingen hopp når listene endrer lengde.
- Lukket seksjon viser en teller («2 reiser», «3 valgt»), så du ser hva som
  ligger der uten å måtte åpne den.
- **Planlegg reisen** og **Når** er bevisst *ikke* sammenleggbare. De er selve
  skjemaet; å kunne skjule dem ville bare gitt en tilstand der appen ser ødelagt ut.

Målt: «I nærheten» går fra 118 px til 34 px.

**Kartkortet kan legges ned.** Det dekket store deler av kartet. Nå har det et
grep øverst – ett trykk gjør det om til bare overskriften, og valget huskes.
Målt: 265 px → 75 px, altså 22 % av skjermen tilbake til kartet.

**Panelene overlappet hverandre.** Kartkortet, lagvelgeren og knappekolonnen lå
alle forankret til bunnen med *faste* pikselverdier (`bottom: 216px`, `224px`,
`104px`). Verdiene stemte bare for én bestemt korthøyde, så i praksis la
lagvelgeren seg oppå stoppestedskortet og skjulte innholdet – akkurat som på
skjermbildet.

Nå stables de:

- `--card-h` og `--layer-h` måles i JS og settes som CSS-variabler.
- Lagvelgeren ligger på `bottom: calc(12px + var(--card-h))`, knappene på
  `calc(18px + var(--card-h) + var(--layer-h))`.
- En `ResizeObserver` måler på nytt når et panel endrer høyde, så det holder
  uansett hvor langt kortet blir.
- Åpner du lagvelgeren mens kortet er oppe, legges kortet ned automatisk – to
  fulle paneler ville dekket nesten hele kartet. Det spretter opp igjen etterpå.

Verifisert med en test som regner ut faktisk overlappende areal mellom alle
panelparene i tre tilstander: **0 px² i samtlige.**

---

## Hurtigreiser fra A til B

Hurtigreise besto av to faste steder – Hjem og Jobb. Nå kan du lagre hele ruter:
**«Hjem → treningen»**, **«Hjem → mormor»**, hva som helst. Kortet viser neste
avgang med linjenummer og nedtelling, og ett trykk søker reisen.

**«Lagrede reiser» og «hurtigreise» var to navn på det samme**, så de er slått
sammen. En lagret reise *er* en hurtigreise. Du lager dem på to måter:

- **«+ Ny hurtigreise»** øverst i Plan. «Fra» er forhåndsvalgt til Hjem, og du
  velger «Til» med Hjem/Jobb/Min posisjon-snarveier eller søk.
- **«Lagre»** på et søkeresultat, som før.

Under panseret:

- Sanntid for alle hurtigreisene hentes i **ett** HTTP-kall. GraphQL-aliaser
  (`q0: trip(…) q1: trip(…)`) gjør at tre reiser koster én forespørsel i stedet
  for tre. Maks tre kort får sanntid, og ikke oftere enn hvert 60. sekund.
- «Min posisjon» løses opp til et stedsnavn først når du lagrer, ikke ved hvert
  oppslag.
- Holdeplasser lagres med NSR-id, adresser med koordinater – samme skille som
  reiseplanleggeren ellers.

**To feil testen fanget underveis:**

1. **Forslagslisten lå bak dialogen.** `#ac` lå inne i `#app`, som har sin egen
   stablingskontekst – da hjelper ingen z-index mot en dialog utenfor. Resultatet
   var at man *ikke kunne velge et sted i det hele tatt* i editoren. Lista er nå
   flyttet ut av `#app`. Dette rammet enhver dialog med søkefelt, ikke bare denne.
2. **Nøstede knapper igjen.** Endre-knappen på hurtigreise-kortet havnet nesten
   inni kortets egen knapp – samme felle som Hjem/Jobb-kortet hadde. Testen leter
   nå etter `button button` begge steder.

---

## Tomrommet under «Finn reise», og lås mot knipe-zoom

**«I nærheten» fyller plassen.** Under knappen lå det rundt 250 px død flate.
Der ligger nå de nærmeste stoppestedene med hva som faktisk går derfra – linje,
retning og nedtelling. Ett trykk åpner tavla for det stoppet.

Det er ikke fyllstoff: det er den vanligste tingen du vil vite når du åpner
appen, og det sparer et fanebytte pluss et søk. Detaljene:

- Stopp og avganger hentes i **ett** kall (`NEARBY_Q`), ikke ett per stopp.
- Oppdateres hvert 45. sekund, og bare mens Plan-fanen faktisk er synlig.
- Har du alt gitt posisjonstilgang, hentes den stille ved oppstart – listen står
  klar før du rekker å trykke. Er tillatelsen **ikke** gitt, vises et kort med en
  knapp i stedet, slik at spørsmålet kommer av en handling og ikke av seg selv.

Målt i Chromium: innholdet i Plan-fanen rekker nå 763 px mot 742 px synlig flate,
altså fylt helt ut, mot 610 px før.

**Knipe-zoom er sperret – unntatt på kartet.** Å knipe grensesnittet større
forskjøv hele oppsettet. Nå:

- `user-scalable=no, maximum-scale=1` i viewport
- `touch-action: pan-y` på `body`, `pan-x` på de sidelengs rullefeltene
- `touch-action: none` på `#map`, så Leaflet håndterer knipingen selv
- iOS bryr seg ikke om viewport-flagget, så `gesturestart`/`gesturechange`
  stoppes i JS, sammen med to-finger-`touchmove` og dobbelttrykk – alt med et
  unntak for alt som skjer inne i `#map`

Verifisert med ekte to-finger-gester i nettleser: appens skala står på 1,0 før og
etter knip, mens kartet zoomet fra nivå 13 til 16 i samme test.

---

## Sveip, tre faner og færre trykk

**Sveip med rundgang.** Sidelengs sveip bytter fane, og du treffer aldri en vegg:
fra siste fane sveiper du videre til den første, og motsatt vei. Detaljer som
gjør at det ikke kommer i veien:

- Sveipet låses til én akse først – loddrett bevegelse ruller som normalt.
- Terskel er 40 px absolutt, deretter 64 px *eller* et raskt kast. Uten
  minsteavstanden kunne et skjelvent trykk bytte fane.
- På Kart starter sveipet bare fra ytterste 32 px, ellers ville du ikke fått
  panorert kartet.
- Sperret mens søkelisten, «Mer»-arket eller en dialog er åpen.
- Kort haptisk klikk når fanen faktisk skifter.

**Tilbakeknappen virker.** Tidligere lukket Androids tilbakeknapp hele appen.
Nå går den ett steg: dialog → «Mer»-ark → underskjerm i Plan → forrige fane →
og først da ut. Implementert med `pushState`/`popstate` og en `applyState()`
som gjenoppretter uten å legge nye steg på historikken.

**Fra fire faner til tre.** «Lagret» var en fast fane for ting man åpner sjelden.
Lagrede reiser, lagrede steder, utseende, feillogg og installasjon ligger nå i et
«Mer»-ark ett trykk unna i topplinjen. Menyen rommer bare det du faktisk veksler
mellom: **Plan · Avganger · Kart**. Sveipesirkelen ble kortere av samme grunn.

**Færre trykk ellers:**

| Før | Nå |
|---|---|
| Appen åpnet alltid på Plan med tomt avgangsbrett | Gjenopptar siste fane og siste stoppested – null trykk for å se hva som går |
| «Hjem» betød *reis fra* hjem | Kortet du trykker er **målet** – «Hjem» betyr reis hjem |
| Bytte fane krevde å strekke seg til bunnmenyen | Sveip hvor som helst på flaten |
| Tilbake førte ut av appen | Tilbake går ett steg innover |

---

## Kartlag som i Ruter-appen

Fem knapper lå strødd langs kartkanten. De er samlet i én lagvelger:

- **Kartvisning:** Standard · Satellitt · Topografi
- **Vis på kartet:** Kjøretøy i sanntid · Bysykkel · Severdigheter

Satellittbildene kommer fra **Esri World Imagery**, topografien fra
**Kartverkets** åpne WMTS. Begge uten API-nøkkel, som resten av appen. Alle tre
er verifisert i nettleser: flisene lastes og attribusjonen bytter med laget.
Service workeren cacher nå også disse flisene, med tak på 600.

Kjøretøyposisjoner fantes fra før, men lå bak et ikon uten forklaring. I
lagvelgeren står det hva de er, og en prikk på lagknappen viser når et lag er på.

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

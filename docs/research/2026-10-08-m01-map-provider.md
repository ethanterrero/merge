# M01: Map, geocoding and routing provider for Merge

Status: recommendation, researched 2026-10-08. Prices and terms were read from the vendors' live pages that day; URLs are listed at the bottom. This is an engineering reading of the terms, not legal advice. Get a lawyer to review before anything beyond the closed pilot.

## Decision (D-08, 2026-10-08)

The owner chose a smaller pilot setup than the recommendation below: **map tiles only, with no geocoding or routing provider.**

- **Display:** MapLibre, with `@maplibre/maplibre-react-native` on native and `maplibre-gl` in `BayMap.web.tsx` on web.
- **Tiles:** Stadia Maps. The plan tier is to be confirmed: without stored geocodes, the Standard plan's storage clause (§30.4) isn't needed.
- **No geocoding.** People set their commute points by placing a pin or area on the map. Coordinates from a user's own tap aren't vendor content, so the storage terms below don't apply. Address search is out for the pilot. If it's added, stored results need a provider that permits storage (Stadia Standard with Place Lookup, or Geocode Earth).
- **No routing.** Detour is estimated in PostGIS from straight-line distances, using the insertion formula `d(Do,Po) + d(Po,Pd) + d(Pd,Dd) − d(Do,Dd)`. That result is multiplied by a 1.35 road factor and divided by 25 mph, plus a check that the pickup comes before the drop-off along the driver's direction. The UI shows the result as "about N min detour", and the driver approves every request. The known weak spot is Bay water crossings.
- **Later:** if pilot feedback shows bad estimates, put real routing behind the same SQL function. The self-hosted Valhalla option below remains the recommended path for that.

The rest of this document is the original research. It is kept as the rationale, and as the plan for adding geocoding or routing later.

## Recommendation

**Use MapLibre for display, Stadia Maps for tiles and geocoding, and a self-hosted Valhalla server for detour routing.**

- **Display:** `@maplibre/maplibre-react-native` (11.5.0) on iOS and Android, and `maplibre-gl` in a `BayMap.web.tsx` for the Expo web build.
- **Tiles and geocoding:** Stadia Maps on the **Standard plan, $80/mo**.
- **Routing:** Valhalla in a small container, built from the Geofabrik NorCal OSM extract. Supabase Edge Functions call it.

Why this stack:

- **Storage is allowed.** This is the only combination where all three needs are clearly permitted by the terms:
  - Storing home/work/pickup coordinates in Postgres indefinitely: Stadia §30.4 allows this on Standard or higher.
  - Caching detour results in `detour_cache`: the route data is our own, from OSM under the ODbL licence.
  - Drawing our own zone circles on any map: no clause ties our data to one vendor's map.
- **The big vendors fail on terms, not features:**
  - Google allows lat/lng from geocoding, Places and Routes to be cached for only 30 days. The newer "indefinite" geocoding exception is per-user only, so cross-user matching can't use it. Google content also can't be shown with a non-Google map.
  - Mapbox bans storing or caching any Directions/Matrix result.
- **Cost:** about $95–110/mo for the pilot and roughly $110–300/mo at 10k MAU.
- **Privacy:** Stadia acts as a data processor under a DPA and keeps server logs for about 7–14 days. Routing never leaves our infrastructure.

Traffic-aware ETA is a nice-to-have. If we want it, make an uncached Stadia traffic-influenced call when a request is made (Standard+, public preview, TomTom data). Never store that result.

## Comparison

| Option | Display: RN / web | Store geocoded coords long-term? | Cache routing results? | Traffic | Pilot (~100 users) | ~10k MAU (est.) | Privacy |
|---|---|---|---|---|---|---|---|
| **MapLibre + Stadia + self-hosted Valhalla (recommended)** | maplibre-react-native (dev build, config plugin, no Expo Go, no web) + maplibre-gl on web via `.web.tsx` | **Yes**: "may be stored permanently… for so long as you maintain an active Standard, Professional, or Enterprise subscription" (Stadia ToS §30.4, Nov 2026 version; §8 in the current version says the same) | **Yes** for Valhalla (our own server, OSM ODbL). Stadia's hosted routing: **no**, "server-side caching is prohibited" (§8) | Valhalla: free-flow only. Stadia traffic profile: 60–120 credits/request, Standard+, preview, uncacheable | Stadia Standard $80 + VM ~$15–30 ≈ **$95–110/mo** | Stadia Standard $80 (7.5M credits) or Professional $250 (25M) + VM ≈ **$110–300/mo** | Stadia acts as processor under a DPA. Policy says server logs are kept ~7–14 days. No cookies to end users. Tile requests reveal the viewport and IP to Stadia. Routing stays in-house |
| Google Maps Platform (react-native-maps, Places, Routes) | react-native-maps works in Expo Go but **no web**. Web needs the Maps JS API ($7/1k loads after 10k free) | **No.** Geocoding lat/lng: 30 days (§6.3.1). The "indefinite" option (§6.3.2) only covers data "logically isolated to the specific End User" and "must not be used across multiple End Users", which blocks matching. Places lat/lng: 30 days only (§14.3). Place IDs can be kept forever but must be re-resolved | **No.** Only lat/lng, for 30 days (§19.3). Everything else falls under the general caching ban | Yes. Compute Routes Pro is $10/1k after 5k free | ~$0 (inside free caps) | Routes can't be cached, so detours get recomputed: roughly $1–3k/mo (estimate) + Places/Geocoding | Google is an **independent controller**, not a processor (Controller-Controller terms). Weakest position for us |
| Mapbox (@rnmapbox/maps, Geocoding v6, Directions/Matrix) | @rnmapbox/maps 10.3.7 (dev build; web support partial/experimental) | **Conditionally.** Needs the paid `permanent=true` mode ($5/1k, no free tier) and has conditions: a separate request per end-user account that "relies on" the geocode; can't be a "primary or significant feature"; lat/lng not shown to users (§2.7.3). Matching on home/work arguably breaks the first two. Must be used with a Mapbox map. Temporary geocodes can't be stored (§2.7.2) | **No.** "shall not export, download, cache or store results from any request to a Navigation API" (§2.10.1) | Yes (`driving-traffic`) | ~$0–5 | Mobile maps free up to 25k MAU; web 50k loads free; permanent geocoding ~$150 one-off; uncached Directions/Matrix $2/1k after 100k free → ~$300–800/mo (estimate) | DPA available. Mobile SDK sends **location telemetry by default**; we must offer an opt-out |
| MapLibre + Protomaps (self-hosted PMTiles) + Geocode Earth + Valhalla | Same as recommended | **Yes**: "cache or store geocoded results forever at no extra cost" (marketing page; full ToS has no counter-clause I could find) | Yes (Valhalla) | No | Geocode Earth Lite $100 + VM + R2 ≈ $110–130/mo | Lite $100 or Basic $200 + VM + ~$0 tiles ≈ $130–250/mo | Fewest third parties see tile traffic. Good **fallback** if Stadia terms change |
| OpenRouteService (hosted) | n/a (routing only) | n/a | Unclear. No caching clause found, but commercial use goes through a sales enquiry | No | Free tier, commercial status unclear | Contact sales | Ruled out as the primary router: unclear commercial terms. Self-hosting ORS is a valid alternative to Valhalla |
| Apple MapKit / MapKit JS / Maps Server API | iOS only natively; Android would need MapKit JS in a webview; web via MapKit JS | **No.** Map Data can't be cached or stored beyond temporary use and must be shown on an Apple map (DPLA Maps schedule, per secondary sources) | No (same clause). Server API has `/v1/directions` and `/v1/etas` | ETA endpoint exists; traffic handling not verified | Free (25k service calls/day per team) | Free up to quota; quota increases by request | Apple's terms; no DPA-style processor role found |
| HERE | Web/JS SDK; no maintained RN SDK found | **No by default.** 30-day retention. "Permanent Geocoding" is a sales add-on, not in the Base plan | Not verified | Yes | Base plan is pay-per-transaction (rates not public on page fetched) | Sales quote | Not assessed |
| TomTom | Web SDK; no first-party RN SDK | **Likely no.** Third-party sources say storage is banned and caching is limited to response headers; I could not load TomTom's own terms | Likely no (same) | Yes | Free 2,500 non-tile requests/day (TomTom FAQ) | Pay-as-you-grow | Not assessed |

How the 10k MAU estimates were built (assumptions, not quotes):

- **Map use:** each MAU opens the map about 20×/month at about 25 vector tiles per view, which is about 5M tile credits.
- **Onboarding:** about 15 autocomplete calls (1 credit each) plus 3 Place Lookups (20 credits each) per new user.
- **Matching:** PostGIS pre-filters candidate pairs before any routing call, giving roughly 150–300k route evaluations/month.

## Terms gotchas that rule options out

1. **Google: 30-day lat/lng limit plus "no use with a non-Google map"** (Service Specific Terms §6.2–6.3, §14.2–14.3, §19.2–19.3, last modified 2026-06-10).
   - We can't keep commute origin/destination coordinates or cache detours.
   - We can't mix Google Places/Routes with a MapLibre map.
   - The new §6.3.2 indefinite-geocode exception explicitly forbids use across end users, and cross-user use is what matching is.
2. **Mapbox: Navigation APIs (Directions, Matrix) can never be cached** (§2.10.1, Product Terms 2026-07-21). That kills `detour_cache` on Mapbox routing.
   - Permanent geocodes come with per-end-user request and "ancillary feature" conditions (§2.7.3). These are a poor fit when home/work coordinates drive matching.
   - Geocoding responses may only be used "in conjunction with a Mapbox map" (Geocoding API docs).
3. **Stadia hosted routing: no server-side caching** (ToS §8). That's why routing moves to self-hosted Valhalla while geocoding stays with Stadia.
   - Stadia storage rights cover Forward, Reverse, Structured and Place Lookup results only (§30.4). **Autocomplete results don't qualify.** Do a Place Lookup (20 credits) on the chosen result before writing coordinates to Postgres.
   - Storage rights last only while we hold Standard or higher.
   - The Free plan bans commercial use.
4. **Apple: no storing of Map Data, display on Apple maps only, no native Android map.**
5. **HERE: 30-day default retention.** Permanent storage needs a sales contract.

## What the owner must set up

1. **Stadia Maps account on Standard ($80/mo).**
   - Create one property for Merge. Don't share a subscription across products (ToS §8).
   - Make two API keys:
     - A **client key** for tiles and autocomplete in the app. Use domain auth for the web build, adding `localhost` for dev.
     - A **server key** for Place Lookup and reverse geocoding from Edge Functions.
   - Sign the Stadia **DPA**.
   - Store the keys as Supabase secret `STADIA_SERVER_KEY` and EAS env `EXPO_PUBLIC_STADIA_KEY`.
2. **Valhalla host.** Any container host with 2–4 GB RAM (Fly.io, Railway, Render or a small EC2).
   - Run `ghcr.io/valhalla/valhalla-scripted` with `tile_urls=https://download.geofabrik.de/north-america/us/california/norcal-latest.osm.pbf` (about 650 MB).
   - Don't expose it publicly. Require a shared-secret header or use a private network, and store it in Supabase secrets as `VALHALLA_URL` and `VALHALLA_TOKEN`.
   - Rebuild tiles monthly.
3. **Expo/EAS.**
   - Add the `@maplibre/maplibre-react-native` config plugin and ship a dev build (it won't run in Expo Go).
   - Add `maplibre-gl` (optionally `react-map-gl/maplibre`) for `BayMap.web.tsx`.
4. **Attribution.** Show "© Stadia Maps © OpenMapTiles © OpenStreetMap contributors" on every map. Credit OSM (ODbL) in About/Legal for Valhalla-derived data.
5. **Privacy hygiene (our side).**
   - Only zone centers (snapped/jittered ~0.5 mi), never raw coordinates, go to clients.
   - Run Place Lookup and storage server-side.
   - Add Stadia (and the Valhalla host) to the subprocessor list in the pilot privacy notice.

## Open risks

- **Stadia storage depends on the subscription.** If we drop below Standard, the stored coordinates lose their licence. Before scaling, confirm two things in writing with Stadia:
  - That calling Place Lookup from our Edge Function isn't "proxying" under §8.
  - That the 2026-11-09 ToS changes don't affect us.
  - Fallback: Geocode Earth (store forever, $100/mo+).
- **Geocode quality.** Stadia and Geocode Earth are both Pelias on OSM/OpenAddresses. Test about 20 real pilot addresses before committing: Alameda homes, SF offices, ferry terminals, BART and casual-carpool spots.
- **Free-flow routing understates rush hour.** Valhalla has no live traffic, so the 5-minute detour rule may pass detours that are slower in practice. Mitigations:
  - Apply a time-of-day multiplier.
  - Or run an uncached Stadia traffic check at request time.
  - Treat detour as an estimate in the UI.
- **Ops.** A single Valhalla VM is a point of failure for new matches. Keep the `detour_cache` hit path independent of it.
- **MapLibre RN v11** supports only the New Architecture and RN ≥ 0.80. That fits Expo 54 / RN 0.81 on paper but hasn't been tried here. Web needs a separate component; there's no shared code path.
- **Unverified:**
  - TomTom's actual terms text (page is JS-rendered).
  - HERE Base plan rates.
  - Apple's current DPLA maps-schedule wording (secondary sources only).
  - Whether Stadia's traffic profile honours a future departure time.
  - The exact US coverage of Stadia's traffic data.
- **Cost estimates** for Google and Mapbox at 10k MAU depend heavily on matching volume. They are order-of-magnitude only.

## Sources (fetched 2026-10-08)

- Google Maps Platform Service Specific Terms (last modified 2026-06-10): https://cloud.google.com/maps-platform/terms/maps-service-terms
- Google Maps Platform Terms of Service (last modified 2026-08-26): https://cloud.google.com/maps-platform/terms
- Google pricing (page updated 2026-10-07): https://developers.google.com/maps/billing-and-pricing/pricing
- Google Geocoding policies: https://developers.google.com/maps/documentation/geocoding/policies
- Google Controller-Controller Data Protection Terms: https://cloud.google.com/maps-platform/terms/maps-controller-terms
- Mapbox Product Terms (2026-07-21 PDF, linked from): https://www.mapbox.com/legal/product-terms
- Mapbox pricing: https://www.mapbox.com/pricing
- Mapbox Geocoding API docs (temporary vs permanent): https://docs.mapbox.com/api/search/geocoding/
- Mapbox DPA: https://www.mapbox.com/legal/dpa · Mapbox telemetry: https://mapbox.com/telemetry
- Stadia pricing: https://stadiamaps.com/pricing/
- Stadia ToS (current, effective 2026-03-18): https://stadiamaps.com/terms-of-service/ · next version (2026-11-09): https://stadiamaps.com/terms-of-service/versions/2026-11-09/
- Stadia privacy policy: https://stadiamaps.com/privacy-policy/ · DPA: https://stadiamaps.com/legal/data-processing-addendum/
- Stadia traffic-influenced routing announcement: https://stadiamaps.com/news/traffic-influenced-routing-in-public-preview/
- Geocode Earth plans and storage: https://geocode.earth/cloud · comparison: https://geocode.earth/alternatives/google-maps/
- MapLibre React Native: https://maplibre.org/maplibre-react-native/docs/setup/getting-started · Expo setup: https://maplibre.org/maplibre-react-native/docs/setup/expo · no web support: https://github.com/maplibre/maplibre-react-native/issues/1346
- rnmapbox Expo note and partial web: https://github.com/rnmapbox/maps
- Expo react-native-maps (no web listed): https://docs.expo.dev/versions/latest/sdk/map-view/
- Protomaps basemap downloads/licence: https://docs.protomaps.com/basemaps/downloads
- Valhalla Docker: https://github.com/valhalla/valhalla/tree/master/docker · Geofabrik NorCal: https://download.geofabrik.de/north-america/us/california/norcal.html
- Apple Maps Server API (25k calls/day): https://developer.apple.com/documentation/applemapsserverapi
- HERE permanent geocoding KB: https://docs.here.com/here-kb/docs/permanent-geocoding-overview-licensing-and-usage-rules (404 on direct fetch; content via search snippet)
- TomTom FAQ (free tier): https://developer.tomtom.com/platform/documentation/status-and-support/faqs · terms: https://docs.tomtom.com/legal/terms-and-conditions (text not retrievable)
- OpenRouteService terms/plans: https://openrouteservice.org/?p=940 · https://account.heigit.org/info/plans

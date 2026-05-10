'use strict';

/* ═══════════════════════════════════════════════
   PRECIPRADAR · PMTILES BUILD
   MapLibre GL JS + PMTiles — no tile server needed
   ═══════════════════════════════════════════════ */

/* ── CONFIG ──────────────────────────────────── */
const CFG = {
    pmtilesPath:     'pmtiles/weather.pmtiles',
    mapCenter:       [78, 20],          // MapLibre uses [lng, lat]
    mapZoom:         4,
    defaultInterval: 1200,
    defaultOpacity:  0.55,

    // These must exactly match the 'intensity' property values
    // stored inside your PMTiles features
    rainColors: {
        very_light: '#81d4fa',
        light:      '#29b6f6',
        moderate:   '#039be5',
        heavy:      '#0277bd',
        very_heavy: '#01579b',
        extreme:    '#0d2f6e'
    }
};

/* ── STATE ───────────────────────────────────── */
const state = {
    timesteps:     [],      // sorted array of forecast_hour numbers
    stepIndex:     0,
    playing:       false,
    looping:       true,
    interval:      CFG.defaultInterval,
    opacity:       CFG.defaultOpacity,
    lastFrameTime: 0,
    dataLoaded:    false,
    rafId:         null,
    // Metadata keyed by forecast_hour for timestamp display
    // { hour -> { timestamp_utc, timestamp_ist } }
    hourMeta:      new Map()
};

/* ── DOM ─────────────────────────────────────── */
const $ = id => document.getElementById(id);
const dom = {
    btnPlay:       $('btnPlayPause'),
    btnPrev:       $('btnPrev'),
    btnNext:       $('btnNext'),
    btnLoop:       $('btnLoop'),
    slider:        $('timeSlider'),
    opacitySlider: $('opacitySlider'),
    tsUTCTime:     $('tsUTCTime'),
    tsUTCDate:     $('tsUTCDate'),
    tsISTTime:     $('tsISTTime'),
    tsISTDate:     $('tsISTDate'),
    tsFhour:       $('tsFhour'),
    loadOverlay:   $('loadOverlay'),
    loadText:      $('loadText'),
    dataStatus:    $('dataStatus')
};

/* ── REGISTER PMTILES PROTOCOL ───────────────── */
// This is the key piece: tells MapLibre how to handle pmtiles:// URLs
// by fetching byte ranges from the static file — no server needed.
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

/* ── MAP INIT ────────────────────────────────── */
const map = new maplibregl.Map({
    container: 'map',
    // Lightweight OSM-based style — no API key required
    style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pb',
        sources: {
            osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
        },
        layers: [
            {
                id: 'osm-tiles',
                type: 'raster',
                source: 'osm',
                minzoom: 0,
                maxzoom: 19
            }
        ]
    },
    center: CFG.mapCenter,
    zoom:   CFG.mapZoom
});

/* ── TIMESTAMP FORMATTER ─────────────────────── */
// Unchanged from your original — same logic, same output
function parseTimestamps(utcStr, istStr) {
    function fmt(str) {
        if (!str || str === '—') return { time: '—', date: '—' };
        let d = new Date(str.replace(' ', 'T').replace(/(?<!\+\d{2})$/, 'Z').replace('Z Z', 'Z'));
        if (isNaN(d.getTime())) {
            const parts = str.trim().split(/[\s T]+/);
            const datePart = parts[0] || '';
            const timePart = parts[1] ? parts[1].slice(0, 5) : '—';
            const dp = datePart.split('-');
            const dateFormatted = dp.length === 3 ? `${dp[2]}/${dp[1]}/${dp[0]}` : datePart;
            return { time: timePart, date: dateFormatted };
        }
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
        const yy = d.getUTCFullYear();
        return { time: `${hh}:${mm}`, date: `${dd}/${mo}/${yy}` };
    }

    function fmtIST(str) {
        if (!str || str === '—') return { time: '—', date: '—' };
        let d = new Date(str.replace(' ', 'T').replace('IST', '+05:30').replace(/\s+\+/, '+'));
        if (isNaN(d.getTime())) {
            const parts = str.trim().split(/[\s T]+/);
            const datePart = parts[0] || '';
            const timePart = parts[1] ? parts[1].slice(0, 5) : '—';
            const dp = datePart.split('-');
            const dateFormatted = dp.length === 3 ? `${dp[2]}/${dp[1]}/${dp[0]}` : datePart;
            return { time: timePart, date: dateFormatted };
        }
        const istMs = d.getTime() + (330 * 60 * 1000);
        const ist   = new Date(istMs);
        const hh = String(ist.getUTCHours()).padStart(2, '0');
        const mm = String(ist.getUTCMinutes()).padStart(2, '0');
        const dd = String(ist.getUTCDate()).padStart(2, '0');
        const mo = String(ist.getUTCMonth() + 1).padStart(2, '0');
        const yy = ist.getUTCFullYear();
        return { time: `${hh}:${mm}`, date: `${dd}/${mo}/${yy}` };
    }

    return {
        utc: fmt(utcStr),
        ist: fmtIST(istStr || utcStr)
    };
}

/* ── UPDATE TIMESTAMP UI ─────────────────────── */
function updateTimestampUI(hour) {
    const meta = state.hourMeta.get(hour);
    if (!meta) {
        if (dom.tsUTCTime) dom.tsUTCTime.textContent = '—';
        if (dom.tsUTCDate) dom.tsUTCDate.textContent = '—';
        if (dom.tsISTTime) dom.tsISTTime.textContent = '—';
        if (dom.tsISTDate) dom.tsISTDate.textContent = '—';
        if (dom.tsFhour)   dom.tsFhour.textContent   = 'F+—h';
        return;
    }
    const { utc, ist } = parseTimestamps(meta.timestamp_utc, meta.timestamp_ist);
    if (dom.tsUTCTime) dom.tsUTCTime.textContent = utc.time;
    if (dom.tsUTCDate) dom.tsUTCDate.textContent = utc.date;
    if (dom.tsISTTime) dom.tsISTTime.textContent = ist.time;
    if (dom.tsISTDate) dom.tsISTDate.textContent = ist.date;
    if (dom.tsFhour)   dom.tsFhour.textContent   = `F+${hour}h`;
}

/* ── ADD PMTILES SOURCE + LAYERS ─────────────── */
// Called once after map loads. Adds one vector source pointing at
// the .pmtiles file, then one fill-layer per intensity class.
// Timestep filtering is done via setFilter() — no redraws, no canvas.
function addPrecipLayers() {
    // Vector source — MapLibre fetches byte ranges on demand
    map.addSource('precipitation', {
        type:  'vector',
        url:   `pmtiles://${CFG.pmtilesPath}`,
    });

    // One fill layer per intensity — grouped draws = better GPU batching
    for (const [intensity, color] of Object.entries(CFG.rainColors)) {
        map.addLayer({
            id:           `precip-${intensity}`,
            type:         'fill',
            source:       'precipitation',
            'source-layer': 'precipitation_timeseries',
            paint: {
                'fill-color':   color,
                'fill-opacity': state.opacity
            },
            // Initial filter: show nothing until renderStep() is called
            filter: ['==', ['get', 'intensity'], '']
        });
    }
}

/* ── RENDER STEP ─────────────────────────────── */
// Core of the new approach: instead of clearing + redrawing canvas,
// we just update a filter expression. MapLibre's WebGL engine handles
// the rest — only tiles in the viewport are even fetched.
function renderStep(i) {
    state.stepIndex = Math.max(0, Math.min(i, state.timesteps.length - 1));
    const hour = state.timesteps[state.stepIndex];

    // Update each intensity layer's filter to show only current timestep
    for (const intensity of Object.keys(CFG.rainColors)) {
        map.setFilter(`precip-${intensity}`, [
            'all',
            ['==', ['get', 'forecast_hour'], hour],
            ['==', ['get', 'intensity'],     intensity]
        ]);
    }

    updateTimestampUI(hour);

    if (dom.slider) dom.slider.value = state.stepIndex;
}

/* ── OPACITY UPDATE ──────────────────────────── */
// MapLibre paint properties update instantly without re-rendering
function updateOpacity(opacity) {
    state.opacity = opacity;
    for (const intensity of Object.keys(CFG.rainColors)) {
        map.setPaintProperty(`precip-${intensity}`, 'fill-opacity', opacity);
    }
}

/* ── PLAY / PAUSE ───────────────────────────── */
function updatePlayBtn() {
    if (!dom.btnPlay) return;
    if (state.playing) {
        dom.btnPlay.textContent = '⏸';
        dom.btnPlay.classList.add('playing');
    } else {
        dom.btnPlay.textContent = '▶';
        dom.btnPlay.classList.remove('playing');
    }
}

function animate(t) {
    if (!state.playing) return;
    if (t - state.lastFrameTime >= state.interval) {
        state.lastFrameTime = t;
        let next = state.stepIndex + 1;
        if (next >= state.timesteps.length) {
            if (state.looping) {
                next = 0;
            } else {
                pause();
                return;
            }
        }
        renderStep(next);
    }
    state.rafId = requestAnimationFrame(animate);
}

function play() {
    if (state.playing || !state.dataLoaded) return;
    state.playing = true;
    updatePlayBtn();
    state.rafId = requestAnimationFrame(animate);
}

function pause() {
    state.playing = false;
    updatePlayBtn();
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
}

/* ── TOAST ───────────────────────────────────── */
let _toastTimer;
function showToast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ── DISCOVER TIMESTEPS FROM PMTILES ─────────── */
// PMTiles stores vector tiles — we can't iterate all features upfront
// like we did with the full GeoJSON. Instead we query a small sample
// of tiles to discover what forecast_hour values exist, then build
// the timesteps array. We use the PMTiles JS API directly for this.
async function discoverTimesteps() {
    if (dom.loadText) dom.loadText.textContent = 'Reading PMTiles metadata…';

    const p = new pmtiles.PMTiles(CFG.pmtilesPath);
    const header = await p.getHeader();

    // Strategy: read tiles at a low zoom where few tiles cover the globe,
    // sample their features, collect unique forecast_hour values.
    // Zoom 2 = 16 tiles total, fast to read.
    const sampleZoom = Math.min(2, header.maxZoom);

    if (dom.loadText) dom.loadText.textContent = 'Discovering forecast timesteps…';

    const hoursSet  = new Set();
    const hourMeta  = new Map();

    // Get tile range at sample zoom from the PMTiles header bounds
    const minTile = pmtiles.tileToXYZ(header.minLon, header.maxLat, sampleZoom);
    const maxTile = pmtiles.tileToXYZ(header.maxLon, header.minLat, sampleZoom);

    const promises = [];
    for (let x = minTile.x; x <= maxTile.x; x++) {
        for (let y = minTile.y; y <= maxTile.y; y++) {
            promises.push(p.getZxy(sampleZoom, x, y));
        }
    }

    const tiles = await Promise.all(promises);

    for (const tile of tiles) {
        if (!tile || !tile.data) continue;
        try {
            // Decode the vector tile using the MVT spec
            // MapLibre includes the vector-tile decoder internally,
            // but we can use a lightweight inline decoder here.
            const view = new DataView(tile.data);
            // Simple scan: look for forecast_hour values in the binary MVT
            // by decoding the tile with a lightweight approach.
            // We leverage the fact that the pmtiles library exposes
            // decodeMvt if available, otherwise fall back to metadata.
            if (typeof pmtiles.decodeMvt === 'function') {
                const features = pmtiles.decodeMvt(tile.data);
                for (const f of features) {
                    const h   = Number(f.properties?.forecast_hour);
                    const utc = f.properties?.timestamp_utc || '';
                    const ist = f.properties?.timestamp_ist || '';
                    if (!isNaN(h)) {
                        hoursSet.add(h);
                        if (!hourMeta.has(h)) hourMeta.set(h, { timestamp_utc: utc, timestamp_ist: ist });
                    }
                }
            }
        } catch (_) { /* skip malformed tiles */ }
    }

    // If tile scanning didn't work (decodeMvt not available),
    // fall back to reading the PMTiles metadata JSON which tippecanoe
    // writes into the archive. This is always present.
    if (hoursSet.size === 0) {
        if (dom.loadText) dom.loadText.textContent = 'Reading metadata fallback…';
        try {
            const meta = await p.getMetadata();
            // tippecanoe writes attribute stats under tilestats
            const tilestats = meta?.tilestats;
            const layer = tilestats?.layers?.find(l => l.layer === 'precipitation_timeseries');
            const attr  = layer?.attributes?.find(a => a.attribute === 'forecast_hour');
            if (attr?.values) {
                for (const v of attr.values) {
                    hoursSet.add(Number(v));
                }
            }
            // Also try to get timestamp info from the first layer attribute
            // (tippecanoe may or may not store string values in tilestats)
        } catch (_) { /* ignore */ }
    }

    return { hoursSet, hourMeta };
}

/* ── MAIN INIT ───────────────────────────────── */
async function init() {
    if (dom.loadText) dom.loadText.textContent = 'Initializing map…';

    // Wait for MapLibre to finish loading the base style
    await new Promise(resolve => {
        if (map.isStyleLoaded()) resolve();
        else map.once('load', resolve);
    });

    try {
        const { hoursSet, hourMeta } = await discoverTimesteps();

        // Sort timesteps numerically
        state.timesteps = Array.from(hoursSet).sort((a, b) => a - b);
        state.hourMeta  = hourMeta;

        if (state.timesteps.length === 0) {
            throw new Error('No forecast timesteps found in PMTiles. Check that forecast_hour property exists in your features.');
        }

        // Add the precipitation vector layers to the map
        if (dom.loadText) dom.loadText.textContent = 'Adding precipitation layers…';
        addPrecipLayers();

        // Wait for the source to be loaded before rendering first frame
        await new Promise(resolve => {
            const check = () => {
                if (map.isSourceLoaded('precipitation')) resolve();
                else map.once('sourcedata', check);
            };
            check();
        });

        state.dataLoaded = true;

        if (dom.slider) {
            dom.slider.max   = state.timesteps.length - 1;
            dom.slider.value = 0;
        }

        if (dom.dataStatus) dom.dataStatus.textContent = `${state.timesteps.length} TIMESTEPS`;
        if (dom.loadOverlay) dom.loadOverlay.style.display = 'none';

        renderStep(0);
        play();

    } catch (e) {
        console.error('PMTiles load failed:', e);
        if (dom.loadOverlay) dom.loadOverlay.classList.add('error');
        if (dom.loadText)    dom.loadText.textContent = `Failed to load data — ${e.message}`;
        if (dom.dataStatus)  dom.dataStatus.textContent = 'ERROR';
    }
}

/* ── EVENT HANDLERS ─────────────────────────── */
if (dom.btnPlay)  dom.btnPlay.onclick  = () => state.playing ? pause() : play();
if (dom.btnPrev)  dom.btnPrev.onclick  = () => { pause(); renderStep(state.stepIndex - 1); };
if (dom.btnNext)  dom.btnNext.onclick  = () => { pause(); renderStep(state.stepIndex + 1); };

if (dom.slider) {
    dom.slider.oninput = () => { pause(); renderStep(Number(dom.slider.value)); };
}

if (dom.opacitySlider) {
    dom.opacitySlider.oninput = () => {
        updateOpacity(Number(dom.opacitySlider.value) / 100);
    };
}

if (dom.btnLoop) {
    dom.btnLoop.onclick = () => {
        state.looping = !state.looping;
        dom.btnLoop.classList.toggle('active', state.looping);
        showToast(state.looping ? 'Loop ON' : 'Loop OFF');
    };
}

/* ── START ───────────────────────────────────── */
init();

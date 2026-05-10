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
    timesteps:     [],
    stepIndex:     0,
    playing:       false,
    looping:       true,
    interval:      CFG.defaultInterval,
    opacity:       CFG.defaultOpacity,
    lastFrameTime: 0,
    dataLoaded:    false,
    rafId:         null,
    hourMeta:      new Map()   // forecast_hour → { timestamp_utc, timestamp_ist }
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
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

/* ── MAP INIT ────────────────────────────────── */
const map = new maplibregl.Map({
    container: 'map',
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
        layers: [{
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19
        }]
    },
    center: CFG.mapCenter,
    zoom:   CFG.mapZoom
});

/* ── TIMESTAMP FORMATTER ─────────────────────── */
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

    return { utc: fmt(utcStr), ist: fmtIST(istStr || utcStr) };
}

/* ── UPDATE TIMESTAMP UI ─────────────────────── */
function updateTimestampUI(hour) {
    const meta = state.hourMeta.get(hour);
    if (!meta) {
        if (dom.tsUTCTime) dom.tsUTCTime.textContent = '—';
        if (dom.tsUTCDate) dom.tsUTCDate.textContent = '—';
        if (dom.tsISTTime) dom.tsISTTime.textContent = '—';
        if (dom.tsISTDate) dom.tsISTDate.textContent = '—';
        if (dom.tsFhour)   dom.tsFhour.textContent   = `F+${hour}h`;
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
function addPrecipLayers() {
    map.addSource('precipitation', {
        type: 'vector',
        url:  `pmtiles://${CFG.pmtilesPath}`
    });

    for (const [intensity, color] of Object.entries(CFG.rainColors)) {
        map.addLayer({
            id:             `precip-${intensity}`,
            type:           'fill',
            source:         'precipitation',
            'source-layer': 'precipitation_timeseries',
            paint: {
                'fill-color':   color,
                'fill-opacity': state.opacity
            },
            filter: ['==', ['get', 'intensity'], '']   // show nothing until renderStep
        });
    }
}

/* ── RENDER STEP ─────────────────────────────── */
function renderStep(i) {
    state.stepIndex = Math.max(0, Math.min(i, state.timesteps.length - 1));
    const hour = state.timesteps[state.stepIndex];

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
            if (state.looping) { next = 0; }
            else { pause(); return; }
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

/* ── DISCOVER TIMESTEPS ──────────────────────── */
// Reads the JSON metadata baked into the .pmtiles archive by tippecanoe.
// Uses only p.getMetadata() — a single small HTTP range request.
// No tile coordinate math, no tile decoding.
async function discoverTimesteps() {
    if (dom.loadText) dom.loadText.textContent = 'Reading PMTiles metadata…';

    const p = new pmtiles.PMTiles(CFG.pmtilesPath);
    const hoursSet = new Set();
    const hourMeta = new Map();

    // ── Strategy 1: tippecanoe tilestats ─────────────────────────────
    // tippecanoe writes a `tilestats` block in the metadata JSON that
    // contains every unique attribute value per layer. One small fetch,
    // no tile decoding needed at all.
    try {
        const meta = await p.getMetadata();
        console.debug('[PrecipRadar] Raw PMTiles metadata:', meta);

        const layers = meta?.tilestats?.layers ?? [];
        const layer  = layers.find(l => l.layer === 'precipitation_timeseries');
        const attr   = layer?.attributes?.find(a => a.attribute === 'forecast_hour');

        if (attr) {
            if (Array.isArray(attr.values) && attr.values.length > 0) {
                // Full unique-values list present
                for (const v of attr.values) hoursSet.add(Number(v));
                console.debug('[PrecipRadar] Timesteps from tilestats.values:', [...hoursSet]);
            } else if (attr.min != null && attr.max != null) {
                // Only min/max stored — reconstruct with standard GFS 3-hour step
                for (let h = Number(attr.min); h <= Number(attr.max); h += 3) {
                    hoursSet.add(h);
                }
                console.debug('[PrecipRadar] Timesteps from tilestats min/max:', [...hoursSet]);
            }
        } else {
            console.warn('[PrecipRadar] forecast_hour attribute not found in tilestats. Layer found:', layer);
        }
    } catch (e) {
        console.warn('[PrecipRadar] getMetadata() failed:', e);
    }

    // ── Strategy 2: query MapLibre rendered features after map loads ──
    // This runs after init() adds the layers. We do a queryRenderedFeatures
    // call across the full map canvas to sample forecast_hour values from
    // whatever tiles are already loaded. Registered as a one-time callback
    // via a promise stored on the state object for init() to await.
    // (This path only triggers if Strategy 1 gave us nothing.)

    // ── Strategy 3: standard GFS fallback ────────────────────────────
    // If metadata gave us nothing, assume a standard 3-hourly GFS run:
    // F+3 through F+72 (3-day forecast). The layers will still render
    // correctly as long as forecast_hour values in the tiles match.
    if (hoursSet.size === 0) {
        console.warn('[PrecipRadar] No timesteps from metadata. Using GFS default schedule F+3…F+72.');
        console.warn('[PrecipRadar] To fix: re-run tippecanoe without --no-tile-stats-attributes flag.');
        for (let h = 3; h <= 72; h += 3) hoursSet.add(h);
    }

    return { hoursSet, hourMeta };
}

/* ── POST-LOAD TIMESTEP DISCOVERY VIA MAP QUERY ── */
// If the GFS fallback was used (hourMeta is empty), we query rendered
// features once the first tile loads to harvest real timestamp strings.
function enrichTimestampsFromMap() {
    if (state.hourMeta.size > 0) return; // already populated from metadata

    const layers = Object.keys(CFG.rainColors).map(k => `precip-${k}`);
    const features = map.queryRenderedFeatures({ layers });

    for (const f of features) {
        const h   = Number(f.properties?.forecast_hour);
        const utc = f.properties?.timestamp_utc || '';
        const ist = f.properties?.timestamp_ist || '';
        if (!isNaN(h) && !state.hourMeta.has(h)) {
            state.hourMeta.set(h, { timestamp_utc: utc, timestamp_ist: ist });
        }
    }

    if (state.hourMeta.size > 0) {
        console.debug('[PrecipRadar] Timestamps enriched from rendered features:', state.hourMeta.size);
        updateTimestampUI(state.timesteps[state.stepIndex]); // refresh display
        map.off('idle', enrichTimestampsFromMap);            // unregister once done
    }
}

/* ── MAIN INIT ───────────────────────────────── */
async function init() {
    if (dom.loadText) dom.loadText.textContent = 'Initializing map…';

    await new Promise(resolve => {
        if (map.isStyleLoaded()) resolve();
        else map.once('load', resolve);
    });

    try {
        const { hoursSet, hourMeta } = await discoverTimesteps();

        state.timesteps = Array.from(hoursSet).sort((a, b) => a - b);
        state.hourMeta  = hourMeta;

        if (state.timesteps.length === 0) {
            throw new Error('No forecast timesteps found. Check browser console for details.');
        }

        if (dom.loadText) dom.loadText.textContent = 'Adding precipitation layers…';
        addPrecipLayers();

        // Wait for the PMTiles source to be recognised by MapLibre
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

        // Register idle-time enrichment to pick up timestamp strings
        // from rendered features (runs only if metadata had no values)
        map.on('idle', enrichTimestampsFromMap);

    } catch (e) {
        console.error('[PrecipRadar] Init failed:', e);
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

'use strict';

/* ═══════════════════════════════════════════════
   PRECIPRADAR · PRODUCTION BUILD

/* ── CONFIG ──────────────────────────────────── */
const CFG = {
    geojsonPath: 'precipitation_timeseries.geojson',
    mapCenter:   [20, 78],
    mapZoom:     4,
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
    allFeatures:   [],
    timesteps:     [],
    index:         new Map(),
    stepIndex:     0,
    playing:       false,
    looping:       true,
    interval:      CFG.defaultInterval,
    opacity:       CFG.defaultOpacity,
    lastFrameTime: 0,
    dataLoaded:    false,
    rafId:         null
};

/* ── DOM ─────────────────────────────────────── */
const $ = id => document.getElementById(id);
const dom = {
    btnPlay:      $('btnPlayPause'),
    btnPrev:      $('btnPrev'),
    btnNext:      $('btnNext'),
    btnLoop:      $('btnLoop'),
    slider:       $('timeSlider'),
    opacitySlider:$('opacitySlider'),
    tsUTC:        $('tsUTC'),
    tsIST:        $('tsIST'),
    tsFhour:      $('tsFhour'),
    loadOverlay:  $('loadOverlay'),
    loadText:     $('loadText'),
    dataStatus:   $('dataStatus'),
    statFeatures: $('statFeatures'),
    statStep:     $('statStep'),
    statSteps:    $('statSteps')
};

/* ── MAP ─────────────────────────────────────── */
const map = L.map('map', {
    center: CFG.mapCenter,
    zoom:   CFG.mapZoom
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

/* ── CANVAS — attached to mapPane to avoid double-offset ── */
// mapPane has NO CSS transform applied by Leaflet, so canvas
// pixels stay aligned with latLngToContainerPoint projections.
const mapPane = map.getPane('mapPane');
const canvas  = document.createElement('canvas');
canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:450;';
mapPane.appendChild(canvas);
const ctx = canvas.getContext('2d');

/* ── RESIZE ─────────────────────────────────── */
function resizeCanvas() {
    const size    = map.getSize();
    canvas.width  = size.x;
    canvas.height = size.y;
    if (state.dataLoaded) drawFrame();
}
map.on('resize', resizeCanvas);
window.addEventListener('resize', () => { map.invalidateSize(); resizeCanvas(); });
resizeCanvas();

/* ── PROJECTION ─────────────────────────────── */
function project([lng, lat]) {
    const p = map.latLngToContainerPoint([lat, lng]);
    return p;
}

/* ── CLEAR PROJECTION CACHE ─────────────────── */
// Must be called whenever the map moves/zooms so stored pixel
// coordinates (which are viewport-relative) are recalculated.
function clearProjectionCache() {
    for (const f of state.allFeatures) {
        delete f.geometry._projected;
    }
}

/* ── INDEX BUILD ────────────────────────────── */
function buildIndex(features) {
    state.index.clear();
    for (const f of features) {
        const h = Number(f.properties.forecast_hour);
        if (!state.index.has(h)) state.index.set(h, []);
        state.index.get(h).push(f);
    }
    return Array.from(state.index.keys()).sort((a, b) => a - b);
}

/* ── DRAW HELPERS ───────────────────────────── */
function drawRings(rings) {
    for (const ring of rings) {
        if (!ring.length) continue;
        ctx.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
        ctx.closePath();
    }
}

// Cache rgba strings to avoid repeated string building
const _rgbaCache = Object.create(null);
function hexToRgba(hex, alpha) {
    const key = hex + '|' + alpha;
    if (_rgbaCache[key]) return _rgbaCache[key];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (_rgbaCache[key] = `rgba(${r},${g},${b},${alpha})`);
}

/* ── DRAW FRAME ─────────────────────────────── */
// FIX: one beginPath/fill/stroke cycle PER COLOR GROUP
// so each intensity renders with its own colour correctly.
function drawFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.dataLoaded) return;

    const features = state.index.get(state.timesteps[state.stepIndex]) || [];

    // 1. Ensure projections are computed (or taken from cache)
    for (const f of features) {
        const g = f.geometry;
        if (!g._projected) {
            if (g.type === 'Polygon') {
                g._projected = g.coordinates.map(ring => ring.map(project));
            } else if (g.type === 'MultiPolygon') {
                g._projected = g.coordinates.map(poly => poly.map(ring => ring.map(project)));
            }
        }
    }

    // 2. Group by intensity key for batched same-colour drawing
    const groups = Object.create(null);
    for (const f of features) {
        const key = f.properties.intensity;
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
    }

    // 3. Draw each colour group in one path
    for (const [intensity, group] of Object.entries(groups)) {
        const color = CFG.rainColors[intensity] || '#29b6f6';
        ctx.fillStyle   = hexToRgba(color, state.opacity);
        ctx.strokeStyle = hexToRgba(color, Math.min(state.opacity + 0.15, 1));
        ctx.lineWidth   = 0.4;

        ctx.beginPath();

        for (const f of group) {
            const g = f.geometry;
            if (!g._projected) continue;
            if (g.type === 'Polygon') {
                drawRings(g._projected);
            } else if (g.type === 'MultiPolygon') {
                g._projected.forEach(poly => drawRings(poly));
            }
        }

        ctx.fill('evenodd');
        ctx.stroke();
    }

    // 4. Update UI
    const first = features[0];
    if (dom.tsUTC)        dom.tsUTC.textContent    = first?.properties.timestamp_utc  || '—';
    if (dom.tsIST)        dom.tsIST.textContent    = first?.properties.timestamp_ist  || '—';
    if (dom.tsFhour)      dom.tsFhour.textContent  = `F+${first?.properties.forecast_hour ?? '—'}h`;
    if (dom.statFeatures) dom.statFeatures.textContent = features.length;
    if (dom.statStep)     dom.statStep.textContent     = state.stepIndex + 1;
    if (dom.statSteps)    dom.statSteps.textContent    = state.timesteps.length;

    // Sync slider thumb
    if (dom.slider) dom.slider.value = state.stepIndex;
}

/* ── RENDER STEP ────────────────────────────── */
function renderStep(i) {
    state.stepIndex = Math.max(0, Math.min(i, state.timesteps.length - 1));
    drawFrame();
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

/* ── DATA LOAD ──────────────────────────────── */
async function loadData() {
    if (dom.loadText) dom.loadText.textContent = 'Fetching GeoJSON data…';
    try {
        const res = await fetch(CFG.geojsonPath);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        if (dom.loadText) dom.loadText.textContent = 'Parsing features…';
        const data = await res.json();

        state.allFeatures = data.features || [];
        state.timesteps   = buildIndex(state.allFeatures);
        state.dataLoaded  = true;

        // Fix: set slider max AFTER data loads
        if (dom.slider) {
            dom.slider.max   = state.timesteps.length - 1;
            dom.slider.value = 0;
        }

        if (dom.dataStatus) dom.dataStatus.textContent = `${state.allFeatures.length} FEATURES`;
        if (dom.loadOverlay) dom.loadOverlay.style.display = 'none';

        resizeCanvas();
        renderStep(0);
        play();

    } catch (e) {
        console.error('GeoJSON load failed:', e);
        if (dom.loadOverlay) dom.loadOverlay.classList.add('error');
        if (dom.loadText)    dom.loadText.textContent = `Failed to load data — ${e.message}`;
        if (dom.dataStatus)  dom.dataStatus.textContent = 'ERROR';
    }
}

/* ── EVENT HANDLERS ─────────────────────────── */

// Play / Pause
if (dom.btnPlay) {
    dom.btnPlay.onclick = () => state.playing ? pause() : play();
}

// Step back
if (dom.btnPrev) {
    dom.btnPrev.onclick = () => { pause(); renderStep(state.stepIndex - 1); };
}

// Step forward
if (dom.btnNext) {
    dom.btnNext.onclick = () => { pause(); renderStep(state.stepIndex + 1); };
}

// Time slider
if (dom.slider) {
    dom.slider.oninput = () => { pause(); renderStep(Number(dom.slider.value)); };
}

// Opacity — slider range 10–90, divide by 100 for 0.1–0.9
if (dom.opacitySlider) {
    dom.opacitySlider.oninput = () => {
        state.opacity = Number(dom.opacitySlider.value) / 100;
        // Clear rgba cache so colours are rebuilt with new alpha
        Object.keys(_rgbaCache).forEach(k => delete _rgbaCache[k]);
        drawFrame();
    };
}

// Loop toggle
if (dom.btnLoop) {
    dom.btnLoop.onclick = () => {
        state.looping = !state.looping;
        dom.btnLoop.classList.toggle('active', state.looping);
        showToast(state.looping ? 'Loop ON' : 'Loop OFF');
    };
}

/* ── MAP EVENTS ─────────────────────────────── */

// Clear projection cache and canvas immediately on zoom/pan start
map.on('zoomstart movestart', () => {
    clearProjectionCache();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// Redraw with fresh projections once movement ends
map.on('zoomend moveend', () => {
    resizeCanvas();
    drawFrame();
});

/* ── INIT ───────────────────────────────────── */
loadData();

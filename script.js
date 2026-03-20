'use strict';

/* ═══════════════════════════════════════════════
   PRECIPRADAR · PRODUCTION BUILD
   ═══════════════════════════════════════════════ */

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

/* ── TIMESTAMP FORMATTER ─────────────────────── */
/**
 * Parses a timestamp string (e.g. "2024-06-01 12:00 UTC" or ISO)
 * and returns { time: "HH:MM", date: "DD/MM/YYYY" } for UTC and IST.
 */
function parseTimestamps(utcStr, istStr) {
    function fmt(str) {
        if (!str || str === '—') return { time: '—', date: '—' };

        // Try to extract date/time parts from common GFS formats
        // e.g. "2024-06-01 12:00" or "2024-06-01T12:00:00Z"
        let d = new Date(str.replace(' ', 'T').replace(/(?<!\+\d{2})$/, 'Z').replace('Z Z', 'Z'));

        if (isNaN(d.getTime())) {
            // Fallback: just display the raw string split on space
            const parts = str.trim().split(/[\s T]+/);
            const datePart = parts[0] || '';
            const timePart = parts[1] ? parts[1].slice(0, 5) : '—';
            // datePart might be YYYY-MM-DD, convert to DD/MM/YYYY
            const dp = datePart.split('-');
            const dateFormatted = dp.length === 3
                ? `${dp[2]}/${dp[1]}/${dp[0]}`
                : datePart;
            return { time: timePart, date: dateFormatted };
        }

        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
        const yy = d.getUTCFullYear();
        return { time: `${hh}:${mm}`, date: `${dd}/${mo}/${yy}` };
    }

    // For IST string: if it contains offset or "IST", parse accordingly
    function fmtIST(str) {
        if (!str || str === '—') return { time: '—', date: '—' };

        // Try direct parse first (IST strings may include +05:30)
        let d = new Date(str.replace(' ', 'T').replace('IST', '+05:30').replace(/\s+\+/, '+'));

        if (isNaN(d.getTime())) {
            // Fallback raw split
            const parts = str.trim().split(/[\s T]+/);
            const datePart = parts[0] || '';
            const timePart = parts[1] ? parts[1].slice(0, 5) : '—';
            const dp = datePart.split('-');
            const dateFormatted = dp.length === 3
                ? `${dp[2]}/${dp[1]}/${dp[0]}`
                : datePart;
            return { time: timePart, date: dateFormatted };
        }

        // Use local time parts if offset was parsed, else UTC+5:30 manually
        // Safest: convert UTC to IST by adding 330 minutes
        const istMs = d.getTime() + (330 * 60 * 1000);
        const ist = new Date(istMs);
        const hh = String(ist.getUTCHours()).padStart(2, '0');
        const mm = String(ist.getUTCMinutes()).padStart(2, '0');
        const dd = String(ist.getUTCDate()).padStart(2, '0');
        const mo = String(ist.getUTCMonth() + 1).padStart(2, '0');
        const yy = ist.getUTCFullYear();
        return { time: `${hh}:${mm}`, date: `${dd}/${mo}/${yy}` };
    }

    return {
        utc: fmt(utcStr),
        ist: fmtIST(istStr || utcStr) // if no IST string, derive from UTC
    };
}

/* ── MAP ─────────────────────────────────────── */
const map = L.map('map', {
    center: CFG.mapCenter,
    zoom:   CFG.mapZoom
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

/* ── CANVAS ─────────────────────────────────── */
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
    return map.latLngToContainerPoint([lat, lng]);
}

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
function drawFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.dataLoaded) return;

    const features = state.index.get(state.timesteps[state.stepIndex]) || [];

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

    const groups = Object.create(null);
    for (const f of features) {
        const key = f.properties.intensity;
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
    }

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

    // Update timestamp UI
    const first = features[0];
    if (first) {
        const utcRaw = first.properties.timestamp_utc || '';
        const istRaw = first.properties.timestamp_ist || '';
        const { utc, ist } = parseTimestamps(utcRaw, istRaw);

        if (dom.tsUTCTime) dom.tsUTCTime.textContent = utc.time;
        if (dom.tsUTCDate) dom.tsUTCDate.textContent = utc.date;
        if (dom.tsISTTime) dom.tsISTTime.textContent = ist.time;
        if (dom.tsISTDate) dom.tsISTDate.textContent = ist.date;
        if (dom.tsFhour)   dom.tsFhour.textContent   = `F+${first.properties.forecast_hour ?? '—'}h`;
    } else {
        if (dom.tsUTCTime) dom.tsUTCTime.textContent = '—';
        if (dom.tsUTCDate) dom.tsUTCDate.textContent = '—';
        if (dom.tsISTTime) dom.tsISTTime.textContent = '—';
        if (dom.tsISTDate) dom.tsISTDate.textContent = '—';
        if (dom.tsFhour)   dom.tsFhour.textContent   = 'F+—h';
    }

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

if (dom.btnPlay)  dom.btnPlay.onclick  = () => state.playing ? pause() : play();
if (dom.btnPrev)  dom.btnPrev.onclick  = () => { pause(); renderStep(state.stepIndex - 1); };
if (dom.btnNext)  dom.btnNext.onclick  = () => { pause(); renderStep(state.stepIndex + 1); };

if (dom.slider) {
    dom.slider.oninput = () => { pause(); renderStep(Number(dom.slider.value)); };
}

if (dom.opacitySlider) {
    dom.opacitySlider.oninput = () => {
        state.opacity = Number(dom.opacitySlider.value) / 100;
        Object.keys(_rgbaCache).forEach(k => delete _rgbaCache[k]);
        drawFrame();
    };
}

if (dom.btnLoop) {
    dom.btnLoop.onclick = () => {
        state.looping = !state.looping;
        dom.btnLoop.classList.toggle('active', state.looping);
        showToast(state.looping ? 'Loop ON' : 'Loop OFF');
    };
}

/* ── MAP EVENTS ─────────────────────────────── */
map.on('zoomstart movestart', () => {
    clearProjectionCache();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

map.on('zoomend moveend', () => {
    resizeCanvas();
    drawFrame();
});

/* ── INIT ───────────────────────────────────── */
loadData();

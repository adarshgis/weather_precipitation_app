// ---------------------------
// 1️⃣ Initialize the map (centered on India)
const map = L.map('map').setView([23.0, 80.0], 4);

// 2️⃣ Base layer (OpenStreetMap)
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
}).addTo(map);

// 3️⃣ Forecast timesteps (24 folders f005 → f120)
const timesteps = [
    "gfs.t00z.pgrb2.0p25.f005",
    "gfs.t00z.pgrb2.0p25.f010",
    "gfs.t00z.pgrb2.0p25.f015",
    "gfs.t00z.pgrb2.0p25.f020",
    "gfs.t00z.pgrb2.0p25.f025",
    "gfs.t00z.pgrb2.0p25.f030",
    "gfs.t00z.pgrb2.0p25.f035",
    "gfs.t00z.pgrb2.0p25.f040",
    "gfs.t00z.pgrb2.0p25.f045",
    "gfs.t00z.pgrb2.0p25.f050",
    "gfs.t00z.pgrb2.0p25.f055",
    "gfs.t00z.pgrb2.0p25.f060",
    "gfs.t00z.pgrb2.0p25.f065",
    "gfs.t00z.pgrb2.0p25.f070",
    "gfs.t00z.pgrb2.0p25.f075",
    "gfs.t00z.pgrb2.0p25.f080",
    "gfs.t00z.pgrb2.0p25.f085",
    "gfs.t00z.pgrb2.0p25.f090",
    "gfs.t00z.pgrb2.0p25.f095",
    "gfs.t00z.pgrb2.0p25.f100",
    "gfs.t00z.pgrb2.0p25.f105",
    "gfs.t00z.pgrb2.0p25.f110",
    "gfs.t00z.pgrb2.0p25.f115",
    "gfs.t00z.pgrb2.0p25.f120"
];

// 4️⃣ Preload forecast layers with GitHub Pages URLs
const forecastLayers = timesteps.map(folder =>
    L.tileLayer(`https://adarshgis.github.io/weather_precipitation_app/tiles/${folder}/{z}/{y}/{x}.png`, {
        minZoom: 2,
        maxZoom: 6,
        opacity: 0.7,
        attribution: "GFS Precipitation Forecast"
    })
);

// 5️⃣ Add first layer
let currentLayer = forecastLayers[0];
currentLayer.addTo(map);

// 6️⃣ Update layer and slider label
function showTimestep(index) {
    if (currentLayer) map.removeLayer(currentLayer);
    currentLayer = forecastLayers[index];
    currentLayer.addTo(map);

    // Extract hour from folder name (f005 → 5, f010 → 10 ...)
    const folder = timesteps[index];
    const hourMatch = folder.match(/f(\d+)/);
    const hour = hourMatch ? parseInt(hourMatch[1], 10) : 0;
    document.getElementById("forecast-hour").innerText = `Hour ${hour}`;
}

// 7️⃣ Initialize slider
const slider = document.getElementById("forecast-slider");
slider.min = 0;
slider.max = timesteps.length - 1;
slider.value = 0;

// 8️⃣ Slider change event
slider.addEventListener("input", function() {
    const idx = parseInt(this.value);
    showTimestep(idx);
});

// 9️⃣ Initialize label on load
document.addEventListener("DOMContentLoaded", () => showTimestep(0));

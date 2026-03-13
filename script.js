// 1️⃣ Initialize the map (centered on India)
const map = L.map('map').setView([23.0, 80.0], 4);

// 2️⃣ Optional base layer (OpenStreetMap)
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
}).addTo(map);

// 3️⃣ Forecast timesteps (update this array if you have more folders)
const timesteps = [
    "gfs.t00z.pgrb2.0p25.f005",
    "gfs.t00z.pgrb2.0p25.f010",
    "gfs.t00z.pgrb2.0p25.f015"
];

// 4️⃣ Current tile layer
let currentLayer;

// Function to display a specific timestep
function showTimestep(index) {
    if (currentLayer) map.removeLayer(currentLayer);

    const folder = timesteps[index];
    currentLayer = L.tileLayer(
        `https://adarshgis.github.io/weather_precipitation_app/tiles/${folder}/{z}/{x}/{y}.png`,
        {
            minZoom: 2,
            maxZoom: 6,
            attribution: "GFS Precipitation Forecast"
        }
    ).addTo(map);

    // Update label
    document.getElementById("timestepLabel").innerText = folder.split('.').pop();
}

// 5️⃣ Initialize first timestep
showTimestep(0);

// 6️⃣ Listen to slider changes
document.getElementById("timeSlider").addEventListener("input", function(e) {
    const index = parseInt(e.target.value);
    showTimestep(index);
});

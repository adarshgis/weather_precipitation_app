<script>
    // 1️⃣ Initialize the map
    const map = L.map('map').setView([23.0, 80.0], 4); // Center on India (lat, lon), zoom level 4

    // 2️⃣ Add OpenStreetMap base layer (optional, can be removed later)
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    // 3️⃣ Add first forecast tile layer (f005)
    const forecastLayer = L.tileLayer(
        'https://adarshgis.github.io/weather_precipitation_app/tiles/gfs.t00z.pgrb2.0p25.f005/{z}/{x}/{y}.png',
        {
            minZoom: 2,
            maxZoom: 6,
            attribution: 'GFS Precipitation Forecast'
        }
    ).addTo(map);

</script>

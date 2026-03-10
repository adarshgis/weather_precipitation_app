# Weather Precipitation App

A geospatial weather application that downloads precipitation forecast data from the NOAA Global Forecast System (GFS), processes GRIB2 files into Cloud Optimized GeoTIFF (COG), and visualizes precipitation forecasts on an interactive web map.

The project demonstrates a complete open-source geospatial pipeline for weather data acquisition, processing, storage, and visualization.

---

## Features

- Automated download of GFS precipitation forecast data
- Processing of GRIB2 files into Cloud Optimized GeoTIFF (COG)
- Efficient raster visualization using web mapping libraries
- Time-based precipitation forecast visualization
- Modular and scalable project architecture
- Automation-ready pipeline for scheduled updates

---

## Technology Stack

**Data Processing**
- Python
- GDAL
- xarray
- rasterio

**Data Format**
- GRIB2 (source forecast data)
- Cloud Optimized GeoTIFF (processed raster)

**Web Visualization**
- Leaflet / OpenLayers
- JavaScript
- HTML / CSS

**Automation**
- GitHub Actions

---

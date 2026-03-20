import rasterio
from rasterio.features import shapes
import numpy as np
import os
import json
import re
import logging
from datetime import datetime, timedelta
from logging.handlers import RotatingFileHandler
import subprocess

# -----------------------------
# CONFIGURATION
# -----------------------------
INPUT_DIR = os.getenv("GFS_COG", "./cogs")
OUTPUT_FILE = os.getenv("GEOJSON_OUT", "./geojson/precipitation_timeseries.geojson")

os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

# -----------------------------
# LOGGING SETUP
# -----------------------------
logger = logging.getLogger("GFS_PIPELINE")
logger.setLevel(logging.INFO)

formatter = logging.Formatter(
    "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

if not logger.handlers:
    file_handler = RotatingFileHandler(
        "pipeline_log.log",
        maxBytes=10 * 1024 * 1024,
        backupCount=5
    )
    file_handler.setFormatter(formatter)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

# -----------------------------
# MODEL RUN TIME
# -----------------------------
model_run_time = (
    datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    - timedelta(days=1)
)

# -----------------------------
# CLASSIFICATION
# -----------------------------
class_info = {
    1: {"name": "very_light", "min": 0.5, "max": 3},
    2: {"name": "light", "min": 3, "max": 10},
    3: {"name": "moderate", "min": 10, "max": 25},
    4: {"name": "heavy", "min": 25, "max": 60},
    5: {"name": "very_heavy", "min": 60, "max": 120},
    6: {"name": "extreme", "min": 120, "max": 999}
}

# -----------------------------
# HELPERS
# -----------------------------
def get_forecast_hour(filename):
    match = re.search(r"\.f(\d+)", filename)
    return int(match.group(1)) if match else None

# -----------------------------
# GIT COMMIT FUNCTION
# -----------------------------
def commit_and_push(file_path):
    try:
        subprocess.run(["git", "config", "--global", "user.name", "github-actions"], check=True)
        subprocess.run(["git", "config", "--global", "user.email", "actions@github.com"], check=True)

        subprocess.run(["git", "add", file_path], check=True)

        subprocess.run([
            "git", "commit", "-m",
            "Update precipitation GeoJSON (automated)"
        ], check=True)

        subprocess.run(["git", "push"], check=True)

        logger.info("GeoJSON committed and pushed to repository")

    except subprocess.CalledProcessError as e:
        logger.warning(f"Git commit skipped or failed: {e}")

# -----------------------------
# FILE SORTING
# -----------------------------
files = sorted(
    [f for f in os.listdir(INPUT_DIR) if f.endswith(".tif")],
    key=lambda x: get_forecast_hour(x) or 0
)

features = []
previous_data = None
processing_success = True

# -----------------------------
# PROCESS LOOP
# -----------------------------
for file in files:
    try:
        forecast_hour = get_forecast_hour(file)

        if forecast_hour is None:
            logger.warning(f"Invalid filename: {file}")
            continue

        filepath = os.path.join(INPUT_DIR, file)
        logger.info(f"Processing: {file}")

        # -----------------------------
        # READ RASTER
        # -----------------------------
        with rasterio.open(filepath) as src:
            band_index = 2 if src.count >= 2 else 1
            data = src.read(band_index).astype(np.float32)
            transform = src.transform

        data[data < 0] = 0

        # -----------------------------
        # BASE FRAME
        # -----------------------------
        if previous_data is None:
            previous_data = data.copy()
            logger.info(f"Baseline set (no output): {file}")
            continue

        # -----------------------------
        # INTERVAL CALCULATION
        # -----------------------------
        interval = data - previous_data
        interval[interval < 0] = 0
        interval[interval < 0.5] = 0

        previous_data = data.copy()

        if np.all(interval == 0):
            logger.info(f"No rainfall: {file}")
            continue

        # -----------------------------
        # TIME HANDLING
        # -----------------------------
        forecast_time_utc = model_run_time + timedelta(hours=forecast_hour)
        forecast_time_ist = forecast_time_utc + timedelta(hours=5, minutes=30)

        # -----------------------------
        # CLASSIFICATION
        # -----------------------------
        classified = np.zeros(interval.shape, dtype=np.uint8)

        classified[(interval >= 0.5) & (interval < 3)] = 1
        classified[(interval >= 3) & (interval < 10)] = 2
        classified[(interval >= 10) & (interval < 25)] = 3
        classified[(interval >= 25) & (interval < 60)] = 4
        classified[(interval >= 60) & (interval < 120)] = 5
        classified[interval >= 120] = 6

        mask = classified > 0

        # -----------------------------
        # POLYGON EXTRACTION
        # -----------------------------
        poly_count = 0

        for geom, value in shapes(classified, mask=mask, transform=transform):
            value = int(value)

            if value not in class_info:
                continue

            info = class_info[value]

            features.append({
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "forecast_hour": forecast_hour,
                    "timestamp_utc": forecast_time_utc.strftime("%Y-%m-%d %H:%M:%S"),
                    "timestamp_ist": forecast_time_ist.strftime("%Y-%m-%d %H:%M:%S"),
                    "rain_class": value,
                    "intensity": info["name"],
                    "min_mm": info["min"],
                    "max_mm": info["max"],
                    "class_range": f"{info['min']}-{info['max']}"
                }
            })

            poly_count += 1

        logger.info(f"Polygons created: {poly_count}")

    except Exception as e:
        logger.error(f"Failed processing {file}: {e}")
        processing_success = False

# -----------------------------
# SAVE GEOJSON
# -----------------------------
geojson_created = False

try:
    geojson_dict = {
        "type": "FeatureCollection",
        "features": features
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(geojson_dict, f)

    logger.info(f"GeoJSON created: {OUTPUT_FILE}")
    logger.info(f"Total polygons: {len(features)}")

    geojson_created = True

except Exception as e:
    logger.error(f"Failed to write GeoJSON: {e}")

# -----------------------------
# COMMIT GEOJSON TO REPO
# -----------------------------
if geojson_created:
    commit_and_push(OUTPUT_FILE)

# -----------------------------
# CLEANUP COG FILES
# -----------------------------
if geojson_created and processing_success:
    logger.info("Starting cleanup of COG files")

    for file in os.listdir(INPUT_DIR):
        if file.endswith(".tif"):
            filepath = os.path.join(INPUT_DIR, file)

            try:
                os.remove(filepath)
                logger.info(f"Deleted: {file}")
            except Exception as e:
                logger.warning(f"Failed to delete {file}: {e}")

    logger.info("COG cleanup completed")

else:
    logger.warning("Skipping cleanup due to pipeline errors")

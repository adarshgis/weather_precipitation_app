import requests
from datetime import datetime, timedelta
import os
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from time import sleep

# -----------------------------
# CONFIGURATION
# -----------------------------
BASE_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
OUTPUT_DIR = os.getenv("GFS_OUTPUT", "./data")

MAX_WORKERS = 5
RETRY_COUNT = 3
TIMEOUT = 120

CYCLE = "00"
DATE = (datetime.utcnow() - timedelta(days=1)).strftime("%Y%m%d")

FORECAST_HOURS = list(range(14, 90, 5))

PARAMS = {
    "dir": f"/gfs.{DATE}/{CYCLE}/atmos",
    "var_APCP": "on",
    "lev_surface": "on"
}

# -----------------------------
# LOGGING SETUP
# -----------------------------
os.makedirs(OUTPUT_DIR, exist_ok=True)

logging.basicConfig(
    filename="pipeline_log.log",
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

# -----------------------------
# DOWNLOAD FUNCTION
# -----------------------------
def download_file(forecast_hour):
    fhr = f"{forecast_hour:03d}"
    filename = f"gfs.t{CYCLE}z.pgrb2.0p25.f{fhr}"
    filepath = os.path.join(OUTPUT_DIR, filename)

    # Skip if already exists
    if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
        logging.info(f"Skipped (exists): {filename}")
        return f"Skipped {filename}"

    params = PARAMS.copy()
    params["file"] = filename

    for attempt in range(RETRY_COUNT):
        try:
            response = requests.get(BASE_URL, params=params, stream=True, timeout=TIMEOUT)

            if response.status_code == 200:
                with open(filepath, "wb") as f:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            f.write(chunk)

                # Validate file size
                if os.path.getsize(filepath) < 1000:
                    raise Exception("File too small, possible corruption")

                logging.info(f"Downloaded: {filename}")
                return f"Downloaded {filename}"

            else:
                raise Exception(f"HTTP {response.status_code}")

        except Exception as e:
            logging.warning(f"Retry {attempt+1} failed for {filename}: {e}")
            sleep(2)

    logging.error(f"Failed: {filename}")
    return f"Failed {filename}"

# -----------------------------
# PARALLEL EXECUTION
# -----------------------------
def run_downloads():
    results = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(download_file, fh) for fh in FORECAST_HOURS]

        for future in as_completed(futures):
            result = future.result()
            print(result)
            results.append(result)

    return results

# -----------------------------
# MAIN
# -----------------------------
if __name__ == "__main__":
    logging.info("Download started")
    run_downloads()
    logging.info("Download completed")
    print("All downloads completed")

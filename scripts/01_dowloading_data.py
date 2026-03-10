import requests
import logging
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ---------------- CONFIG ---------------- #

BASE_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"

OUTPUT_DIR = Path("downloaded_data")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

FORECAST_HOURS = list(range(5,121,5))
CYCLE = "00"

DATE = datetime.utcnow().strftime("%Y%m%d")

PARAMS = {
    "dir": f"/gfs.{DATE}/{CYCLE}/atmos",
    "var_APCP": "on",
    "lev_surface": "on"
}

MAX_THREADS = 6

# ---------------- LOGGING ---------------- #

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

# ---------------- SESSION WITH RETRIES ---------------- #

session = requests.Session()

retry = Retry(
    total=5,
    backoff_factor=2,
    status_forcelist=[500,502,503,504]
)

adapter = HTTPAdapter(max_retries=retry)
session.mount("http://", adapter)
session.mount("https://", adapter)

# ---------------- DOWNLOAD FUNCTION ---------------- #

def download_file(forecast_hour):

    fhr = f"{forecast_hour:03d}"
    filename = f"gfs.t{CYCLE}z.pgrb2.0p25.f{fhr}"
    filepath = OUTPUT_DIR / filename

    if filepath.exists():
        logging.info(f"{filename} already exists, skipping")
        return

    p = PARAMS.copy()
    p["file"] = filename

    try:

        logging.info(f"Downloading {filename}")

        r = session.get(BASE_URL, params=p, stream=True, timeout=120)

        if r.status_code != 200:
            logging.error(f"Failed {filename} - HTTP {r.status_code}")
            return

        with open(filepath, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024*1024):
                if chunk:
                    f.write(chunk)

        logging.info(f"Downloaded {filename}")

    except Exception as e:
        logging.error(f"Error downloading {filename}: {e}")

# ---------------- MAIN ---------------- #

def main():

    with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
        executor.map(download_file, FORECAST_HOURS)

    logging.info("All downloads complete")


if __name__ == "__main__":
    main()

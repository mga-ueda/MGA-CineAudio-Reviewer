"""Capture guide screenshots from the running local server."""
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "images"
BASE = "http://127.0.0.1:8765"

SHOTS = [
    ("01-overview.png", "/", 1400, 900, False),
    ("02-drop-zone.png", "/", 1400, 420, False),
    ("03-player-markers.png", "/", 1400, 720, False),
    ("04-waveform-transport.png", "/", 1400, 1100, False),
    ("05-monitor.png", "/", 1400, 1600, False),
]


def clip_page(page, path, y, height):
    data = page.screenshot(clip={"x": 0, "y": y, "width": 1400, "height": height})
    path.write_bytes(data)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 2400})
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_timeout(800)

        page.screenshot(path=str(OUT / "01-overview.png"), full_page=False)
        clip_page(page, OUT / "02-drop-zone.png", 0, 380)
        clip_page(page, OUT / "03-player-markers.png", 380, 520)
        clip_page(page, OUT / "04-waveform-transport.png", 900, 620)
        clip_page(page, OUT / "05-monitor.png", 1520, 480)

        browser.close()
    print("Saved screenshots to", OUT)


if __name__ == "__main__":
    main()

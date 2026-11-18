"""End-to-end check of the built app (and doc/ screenshots).

    npm run build && npx vite preview --port 4789 --strictPort &
    uv run --with playwright==1.58.0 python scripts/e2e-route.py [--chrome PATH] [--screenshots doc]
"""
import argparse
import sys

from playwright.sync_api import expect, sync_playwright

URL = "http://localhost:4789/"
VICTORIA_PARK = (828, 560)  # pixel at the default view (1440x900); Joondalup is off-screen at zoom 12


def wait_ready(page) -> None:
    page.wait_for_function("document.querySelectorAll('.leaflet-bands-pane path').length > 0", timeout=30000)
    expect(page.get_by_role("status")).to_have_count(0, timeout=30000)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chrome", help="Chromium executable (default: Playwright's)")
    ap.add_argument("--screenshots", help="directory to save desktop/mobile screenshots into")
    args = ap.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chrome)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.goto(URL, wait_until="networkidle")
        wait_ready(page)

        page.get_by_role("radio", name="Saturday").click()
        hour = page.get_by_role("slider", name="Arrival hour")
        hour.focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        expect(page.get_by_text("Arrive 10:00–11:00")).to_be_visible()
        wait_ready(page)

        page.mouse.click(*VICTORIA_PARK)
        panel = page.get_by_label("Route", exact=True)
        expect(panel).to_contain_text("Best", timeout=15000)
        expect(panel).to_contain_text("(Saturday)")
        expect(panel.get_by_role("listitem").first).to_be_visible()
        assert page.locator(".leaflet-route-pane path").count() > 0, "route not drawn"
        if args.screenshots:
            page.screenshot(path=f"{args.screenshots}/img.png")

        page.keyboard.press("Escape")
        expect(panel).to_have_count(0)

        if args.screenshots:
            mobile = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, device_scale_factor=2)
            mobile.goto(URL, wait_until="networkidle")
            wait_ready(mobile)
            mobile.screenshot(path=f"{args.screenshots}/img-mobile.png")
        browser.close()

    if errors:
        sys.exit(f"console errors: {errors}")
    print("e2e ok")


if __name__ == "__main__":
    main()

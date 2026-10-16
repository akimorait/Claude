#!/usr/bin/env python3
"""Build the newsletter popup.

  python3 build.py                       -> pocket-newsletter-popup.liquid + preview.html
  python3 build.py --inline-images DIR   -> also embeds DIR's images into the preview
                                            (for hosts that block outside images)

The popup's CSS and JS live once in src/ and are inlined into both outputs.
"""
import argparse
import base64
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "src"

# Store images used by the preview (served from the Pocket Picked It CDN).
CDN = "https://cdn.shopify.com/s/files/1/0848/5647/1856/files/"
IMAGES = {
    "logo": ("logo_s.png", "https://pocketpickedit.com/cdn/shop/files/Landscape_Logo_59f44437-0490-4d6b-8e08-e9cf9c3a9cc6.png?width=360"),
    "limoncello": ("limoncello_s.jpg", CDN + "4A37B146-F98C-47A2-ABA5-2567BC11B8EA.jpg?width=900"),
    "limoncello_t": ("limoncello_t.jpg", CDN + "4A37B146-F98C-47A2-ABA5-2567BC11B8EA.jpg?width=400"),
    "mocha": ("mocha_t.jpg", CDN + "product-studio-41j4mc.png?width=400"),
    "bubble": ("bubble_t.jpg", CDN + "IMG-1511.jpg?width=400"),
    "astro": ("astro_t.jpg", CDN + "493A2CEF-9A7B-4E90-844C-D1F28908C7AE.jpg?width=400"),
}


def data_uri(path: pathlib.Path) -> str:
    mime = "image/png" if path.suffix == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inline-images", metavar="DIR")
    ap.add_argument("--preview-out", default=str(HERE / "preview.html"))
    args = ap.parse_args()

    css = (SRC / "popup.css").read_text()
    js = (SRC / "popup.js").read_text()
    for needle in ("{%", "{{", "endraw"):
        assert needle not in css + js, f"{needle!r} would break the Liquid file"

    section = (SRC / "section.liquid").read_text()
    section = section.replace("/*__CSS__*/", css).replace("/*__JS__*/", js)
    (HERE / "pocket-newsletter-popup.liquid").write_text(section)

    preview = (SRC / "preview.html").read_text()
    preview = preview.replace("/*__CSS__*/", css).replace("/*__JS__*/", js)
    for key, (local, url) in IMAGES.items():
        src = data_uri(pathlib.Path(args.inline_images) / local) if args.inline_images else url
        preview = preview.replace(f"__IMG_{key}__", src)
    if not args.inline_images:
        preview = ('<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n'
                   '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
                   + preview + "\n</html>\n")
    pathlib.Path(args.preview_out).write_text(preview)
    print("built", HERE / "pocket-newsletter-popup.liquid", "and", args.preview_out)


if __name__ == "__main__":
    main()

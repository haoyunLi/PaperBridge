"""Create a one-page image PDF with no selectable text for the opt-in OCR test."""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    destination = Path(sys.argv[1])
    destination.parent.mkdir(parents=True, exist_ok=True)
    page = Image.new("RGB", (1300, 1800), "white")
    draw = ImageDraw.Draw(page)
    regular = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 37)
    heading = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 54)
    lines = [
        ("SCANNED RESEARCH PAGE", heading),
        ("Experimental observation", heading),
        ("Researchers measured how a ceramic sample reacted", regular),
        ("to a changing magnetic field. The field was raised", regular),
        ("from zero to two tesla over several trials.", regular),
        ("At room temperature, the response increased", regular),
        ("smoothly as the field became stronger.", regular),
        ("These observations suggest that the material", regular),
        ("can be studied with a simple calibration curve.", regular),
    ]
    y = 145
    for index, (line, font) in enumerate(lines):
        if index in (1, 2, 5, 7):
            y += 45
        draw.text((115, y), line, fill="black", font=font)
        y += 70
    page.save(destination, "PDF", resolution=150.0)


if __name__ == "__main__":
    main()

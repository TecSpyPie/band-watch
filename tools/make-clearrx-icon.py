"""Draws ClearRX's icon (clearrx/winres/clearrx.ico): a metal tile with a cyan sound wave."""
from PIL import Image, ImageDraw, ImageFilter
import sys

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
for y in range(16, S - 16):  # metal gradient
    t = (y - 16) / (S - 32)
    c = tuple(int(a + (b - a) * t) for a, b in zip((86, 99, 108), (24, 30, 35)))
    d.line([(16, y), (S - 16, y)], fill=c + (255,))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([16, 16, S - 16, S - 16], radius=104, fill=255)
tile = Image.new("RGBA", (S, S), (0, 0, 0, 0)); tile.paste(img, (0, 0), mask)
d = ImageDraw.Draw(tile)
d.rounded_rectangle([16, 16, S - 16, S - 16], radius=104, outline=(69, 224, 245, 255), width=14)
pts = [(64, 272), (128, 272), (160, 176), (200, 368), (240, 112), (280, 400), (320, 208), (352, 304), (384, 272), (448, 272)]
glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(glow).line(pts, fill=(69, 224, 245, 200), width=52, joint="curve")
tile = Image.alpha_composite(tile, glow.filter(ImageFilter.GaussianBlur(18)))
ImageDraw.Draw(tile).line(pts, fill=(190, 248, 255, 255), width=30, joint="curve")
tile.save(sys.argv[1], sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
tile.resize((256, 256), Image.LANCZOS).save(sys.argv[1].replace(".ico", "-256.png"))

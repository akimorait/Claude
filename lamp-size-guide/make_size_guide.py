import base64, io, math
from PIL import Image
import numpy as np

SIZE = 2160; MARGIN = 110
INK = "#2B2825"; BG = "#F5F1EB"; DIM = "#A59D93"; SUB = "#857C72"; MUG = "#B3AAA0"
RES = 4.2   # cm reserved left of each lamp for the height line
GAP = 2.4   # cm between items

DECABLE = {"palermo_07", "palermotall_08", "pleaty_00", "shortstack_10", "superpleaty_16", "cloud_00", "matcha_09", "limtall_00", "limoncello_07", "mocha_00", "bubble_11", "minibubble_00"}

def decable(im, k=25):
    from scipy import ndimage
    arr = np.array(im)
    m = arr[:, :, 3] > 40
    opened = ndimage.binary_opening(m, structure=np.ones((k, k)))
    lab, n = ndimage.label(opened)
    if n:
        sizes = ndimage.sum(opened, lab, range(1, n + 1))
        opened = lab == (1 + int(np.argmax(sizes)))
    keep = ndimage.binary_dilation(opened, structure=np.ones((5, 5)))
    arr[:, :, 3] = np.where(keep, arr[:, :, 3], 0)
    return Image.fromarray(arr)

def load(name, pendant=False):
    im = Image.open(f"cut2/{name}.png").convert("RGBA")
    if name in DECABLE:
        im = decable(im)
    a = np.array(im)[:, :, 3]
    m = a > 40
    rows = np.where(m.any(1))[0]; cols = np.where(m.any(0))[0]
    y0, y1, x0, x1 = rows[0], rows[-1], cols[0], cols[-1]
    if pendant:  # drop the hanging cord above the housing
        w = m.sum(1); mx = w.max()
        while y0 < y1 and w[y0] < 0.12 * mx:
            y0 += 1
    else:        # drop thin cables lying beside the lamp
        h = m[y0:y1+1].sum(0); hmax = y1 - y0
        while x0 < x1 and h[x0] < 0.05 * hmax: x0 += 1
        while x1 > x0 and h[x1] < 0.05 * hmax: x1 -= 1
    arr = np.array(im)
    arr[:y0, :, 3] = 0; arr[:, :x0, 3] = 0; arr[:, x1+1:, 3] = 0
    im = Image.fromarray(arr).crop((x0, y0, x1 + 1, y1 + 1))
    return im

def b64(im):
    buf = io.BytesIO(); im.save(buf, "PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()

def fmt(v): return f"{v:g} cm"

def height_line(x, ytop, ybot, label):
    mid = (ytop + ybot) / 2
    return [f'<line x1="{x}" y1="{ytop}" x2="{x}" y2="{ybot}" stroke="{DIM}" stroke-width="2"/>',
            f'<line x1="{x-8}" y1="{ytop}" x2="{x+8}" y2="{ytop}" stroke="{DIM}" stroke-width="2"/>',
            f'<line x1="{x-8}" y1="{ybot}" x2="{x+8}" y2="{ybot}" stroke="{DIM}" stroke-width="2"/>',
            f'<text x="{x-14}" y="{mid}" transform="rotate(-90 {x-14} {mid})" text-anchor="middle" font-size="27" fill="{SUB}">{label}</text>']

def width_line(x0, x1, y, label):
    return [f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="{DIM}" stroke-width="2"/>',
            f'<line x1="{x0}" y1="{y-8}" x2="{x0}" y2="{y+8}" stroke="{DIM}" stroke-width="2"/>',
            f'<line x1="{x1}" y1="{y-8}" x2="{x1}" y2="{y+8}" stroke="{DIM}" stroke-width="2"/>',
            f'<text x="{(x0+x1)/2}" y="{y+40}" text-anchor="middle" font-size="27" fill="{SUB}">{label}</text>']

def mug_svg(cx, base, S):
    def P(pts): return " ".join(f"{cx + x*S:.1f},{base - y*S:.1f}" for x, y in pts)
    body = [(-3.5, 0), (3.5, 0), (4, 0.6), (4, 9.5), (-4, 9.5), (-4, 0.6)]
    st = f'fill="none" stroke="{MUG}" stroke-width="3" stroke-dasharray="9 7" stroke-linejoin="round" stroke-linecap="round"'
    return [f'<polygon points="{P(body)}" {st}/>',
            f'<path d="M{cx+4*S},{base-7.9*S} C{cx+7.6*S},{base-7.9*S} {cx+7.6*S},{base-2.5*S} {cx+4*S},{base-2.5*S}" {st}/>',
            f'<path d="M{cx+4*S},{base-6.6*S} C{cx+6.2*S},{base-6.6*S} {cx+6.2*S},{base-3.8*S} {cx+4*S},{base-3.8*S}" {st}/>']

class Item:
    def __init__(self, name, sub, img, H, W, pendant=False):
        self.name, self.sub, self.H, self.W = name, sub, H, W
        self.mug = img is None
        self.im = None if self.mug else load(img, pendant)
        self.aspect = 8.6 / 9.5 if self.mug else self.im.width / self.im.height  # mug body+handle ≈ 11.6 wide
        if not self.mug:
            self.photo_w = H * self.aspect
            if abs(self.photo_w - W) / W <= 0.16:   # small camera-angle difference: match the listed width
                self.aspect = W / H
    def width_cm(self):
        return 11.6 if self.mug else max(self.H * self.aspect, self.W)
    def footprint(self):
        return (1.0 if self.mug else RES) + self.width_cm()

def row_width(items):
    return sum(i.footprint() for i in items) + GAP * (len(items) - 1)

def place(items, S, left, base_y, name_y=None, hang_top=None, ceiling=None):
    o = []; x = left
    for it in items:
        x += (1.0 if it.mug else RES) * S
        wpx = it.width_cm() * S
        cx = x + wpx / 2
        if it.mug:
            o += mug_svg(cx - 1.8 * S, base_y, S)
            ny = name_y or base_y + 125
            o.append(f'<text x="{cx}" y="{ny}" text-anchor="middle" font-size="29" fill="{SUB}">Mug</text>')
            o.append(f'<text x="{cx}" y="{ny+36}" text-anchor="middle" font-size="27" fill="{SUB}">{fmt(it.H)}</text>')
        else:
            hp = it.H * S; iw = hp * it.aspect
            top = hang_top if hang_top is not None else base_y - hp
            bot = top + hp
            if ceiling is not None:
                o.append(f'<line x1="{cx}" y1="{ceiling}" x2="{cx}" y2="{top+2}" stroke="{INK}" stroke-width="2.2"/>')
            img = it.im.resize((max(1, round(iw * 1.0)), max(1, round(hp * 1.0))), Image.LANCZOS)
            o.append(f'<image x="{cx - iw/2:.1f}" y="{top:.1f}" width="{iw:.1f}" height="{hp:.1f}" href="data:image/png;base64,{b64(img)}"/>')
            o += height_line(x - 16, top, bot, fmt(it.H))
            o += width_line(cx - it.W * S / 2, cx + it.W * S / 2, bot + 32, fmt(it.W))
            ny = name_y or bot + 127
            o.append(f'<text x="{cx}" y="{ny}" text-anchor="middle" font-size="31" font-weight="600" fill="{INK}">{it.name}</text>')
            if it.sub:
                o.append(f'<text x="{cx}" y="{ny+34}" text-anchor="middle" font-size="25" fill="{SUB}">{it.sub}</text>')
        x += wpx + GAP * S
    return o

def header(title, subtitle):
    return [f'<text x="{MARGIN}" y="{MARGIN+70}" font-size="76" font-weight="600" fill="{INK}" letter-spacing="-1">{title}</text>',
            f'<text x="{MARGIN}" y="{MARGIN+130}" font-size="32" fill="{SUB}">{subtitle}</text>']

def svg(body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}" '
            f'font-family="Inter, sans-serif"><rect width="100%" height="100%" fill="{BG}"/>' + "".join(body) + "</svg>")

SUBTITLE = "Size guide · all lamps shown to scale · measurements in cm"

def table():
    r1 = [Item("Big Lamp", "Yellow · Brown", "big_00", 60, 25), Item("Super Pleaty", "", "superpleaty_16", 36, 24),
          Item("Limoncello Tall", "", "limtall_00", 35, 16), Item("Mocha", "", "mocha_00", 31.5, 16),
          Item("Matcha", "", "matcha_09", 30, 15), Item("Limoncello", "", "limoncello_07", 30, 16),
          Item("Palermo Tall", "", "palermotall_08", 30, 25)]
    r2 = [Item("Pleaty", "", "pleaty_00", 26, 24), Item("Palermo", "", "palermo_07", 25, 25),
          Item("Bubble", "", "bubble_11", 23, 15), Item("Cloud", "", "cloud_00", 21, 15),
          Item("Short Stack", "", "shortstack_10", 18, 16), Item("Mini Bubble", "", "minibubble_00", 17, 13),
          Item("Mug", "", None, 9.5, 8)]
    for it in r1 + r2:
        if not it.mug:
            print(f"{it.name:16s} photo width {it.H*it.aspect:5.1f} cm vs listed {it.W}")
    avail = SIZE - 2 * MARGIN
    w1, w2 = row_width(r1), row_width(r2)
    S = avail / max(w1, w2)
    labels = 175
    block = 60 * S + labels + 130 + 26 * S + labels
    top = MARGIN + 230 + (SIZE - MARGIN - (MARGIN + 230) - block) / 2
    b1 = top + 60 * S; b2 = b1 + labels + 130 + 26 * S
    o = header("Table Lamps", SUBTITLE)
    for b in (b1, b2):
        o.append(f'<line x1="{MARGIN}" y1="{b}" x2="{SIZE-MARGIN}" y2="{b}" stroke="{INK}" stroke-opacity="0.18" stroke-width="2"/>')
    o += place(r1, S, MARGIN + (avail - w1 * S) / 2, b1)
    o += place(r2, S, MARGIN + (avail - w2 * S) / 2, b2)
    return svg(o), S

def pendants():
    global GAP
    GAP = 6
    row = [Item("Cosmo", "", "cosmo_02", 29, 21, True), Item("Astro", "", "astro_00", 27, 26, True),
           Item("Otto", "", "otto_01", 25, 15, True)]
    for it in row:
        print(f"{it.name:16s} photo width {it.H*it.aspect:5.1f} cm vs listed {it.W}")
    mug = [Item("Mug", "", None, 9.5, 8)]
    avail = SIZE - 2 * MARGIN
    w = row_width(row) + GAP + row_width(mug)
    S = min(avail / w, 19)
    ceiling = MARGIN + 360; hang = ceiling + 560
    low = hang + 29 * S
    name_y = low + 150
    o = header("Pendant Lamps", SUBTITLE)
    o.append(f'<line x1="{MARGIN}" y1="{ceiling}" x2="{SIZE-MARGIN}" y2="{ceiling}" stroke="{INK}" stroke-opacity="0.18" stroke-width="2"/>')
    left = MARGIN + (avail - w * S) / 2
    o += place(row, S, left, None, name_y=name_y, hang_top=hang, ceiling=ceiling)
    mleft = left + (row_width(row) + GAP) * S
    o.append(f'<line x1="{mleft}" y1="{low}" x2="{mleft + row_width(mug)*S + 30}" y2="{low}" stroke="{INK}" stroke-opacity="0.18" stroke-width="2"/>')
    o += place(mug, S, mleft, low, name_y=name_y)
    o.append(f'<text x="{MARGIN}" y="{SIZE-MARGIN}" font-size="26" fill="{SUB}">Height includes the white housing on top.</text>')
    return svg(o), S

if __name__ == "__main__":
    s, S = table(); open("out/table2.svg", "w").write(s); print("table scale", S)
    s, S = pendants(); open("out/pendant2.svg", "w").write(s); print("pendant scale", S)

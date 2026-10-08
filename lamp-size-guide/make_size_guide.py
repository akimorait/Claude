import math, sys

# ---------- geometry helpers (cm, y up, origin = bottom centre) ----------
def cr(points, n=14):
    if len(points) < 3:
        return list(points)
    P = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i-1], P[i], P[i+1], P[i+2]
        for k in range(n):
            t = k / n; t2 = t*t; t3 = t2*t
            out.append(tuple(0.5*((2*p1[j]) + (-p0[j]+p2[j])*t + (2*p0[j]-5*p1[j]+4*p2[j]-p3[j])*t2
                                  + (-p0[j]+3*p1[j]-3*p2[j]+p3[j])*t3) for j in range(2)))
    out.append(points[-1])
    return out

def mirror(side):
    return [(-x, y) for x, y in side]

def part(right, left=None, top=None, bottom=None, ribs=0, rib_inset=(0.4, 0.4), style="solid", rib_u=None):
    if left is None:
        left = mirror(right)
    return dict(right=right, left=left, top=top, bottom=bottom, ribs=ribs,
                rib_inset=rib_inset, style=style, rib_u=rib_u)

def sym(profile, **kw):
    return part(cr(profile), **kw)

def rect(w, y0, y1, **kw):
    return part([(w, y0), (w, y1)], **kw)

def wave_side(W, y0, y1, n, a, phase=0.0, p=1.6, sign=1, N=160):
    pts = []
    for i in range(N + 1):
        t = i / N
        x = W/2 - a * (1 - abs(math.sin(math.pi * (n*t + phase)))) ** p
        pts.append((sign * x, y0 + (y1 - y0) * t))
    return pts

def stacked(W, y0, y1, n, a, p=1.6, ribs=12, **kw):
    r = wave_side(W, y0, y1, n, a, 0, p)
    return part(r, mirror(r), ribs=ribs, **kw)

def smooth_side(W, y0, y1, n, a, phase, sign=1, N=160):
    return [(sign*(W/2 - a/2*(1 - math.cos(2*math.pi*(n*i/N + phase)))), y0 + (y1-y0)*i/N) for i in range(N+1)]

def organic(W, y0, y1, n, a, ph_r, ph_l, p=None, ribs=12, **kw):
    r = smooth_side(W, y0, y1, n, a, ph_r)
    l = smooth_side(W, y0, y1, n, a, ph_l, sign=-1)
    return part(r, l, ribs=ribs, **kw)

def edge(x0, x1, f, N=120):
    return [(x0 + (x1-x0)*i/N, f(x0 + (x1-x0)*i/N)) for i in range(N + 1)]

def interp(side, y):
    s = sorted(side, key=lambda p: p[1])
    if y <= s[0][1]: return s[0][0]
    if y >= s[-1][1]: return s[-1][0]
    for (xa, ya), (xb, yb) in zip(s, s[1:]):
        if ya <= y <= yb:
            return xa if yb == ya else xa + (xb-xa)*(y-ya)/(yb-ya)
    return s[-1][0]

def skirt(y0, y1, wtop, wbot, petals, crowns, ribs=True):
    # flared petal shade (Palermo)
    N = 80
    r = [(wtop + (wbot-wtop)*(1 - i/N)**1.6, y0 + (y1-y0)*i/N) for i in range(N+1)]
    bot = edge(-wbot, wbot, lambda x: y0 + 1.6*(1 - abs(math.cos(math.pi*petals*(x+wbot)/(2*wbot)))))
    top = edge(-wtop, wtop, lambda x: y1 - 0.9*(1 - abs(math.cos(math.pi*crowns*(x+wtop)/(2*wtop)))))
    u = [(k+0.5)/petals for k in range(petals)]
    return part(r, mirror(r), top=top, bottom=bot, ribs=len(u), rib_u=u, rib_inset=(1.0, 0.9))

def cone(y0, y1, wtop, wbot, pleats, ribs=15):
    prof = cr([(wbot, y0), (wbot*0.82, y0+(y1-y0)*0.18), (wbot*0.55, y0+(y1-y0)*0.52),
               (wtop + (wbot-wtop)*0.18, y0+(y1-y0)*0.85), (wtop, y1)])
    bot = edge(-wbot, wbot, lambda x: y0 + 0.45*abs(math.sin(math.pi*pleats*(x+wbot)/(2*wbot))))
    return part(prof, mirror(prof), bottom=bot, ribs=ribs, rib_inset=(0.5, 0.2))

# ---------- lamps ----------
def big():
    base = sym([(12.5, 0), (12.4, 1.0), (10, 1.9), (4, 2.3), (1.8, 2.4)])
    shade = stacked(25, 41, 60, 3, 1.7, ribs=16)
    return [base, rect(1.5, 2.4, 5.5), rect(0.6, 5.5, 37.5), rect(1.7, 37.5, 41), shade], \
           [[(1.15, 38.5), (1.15, 33.2)]]

def super_pleaty():
    base = sym([(5.8, 0), (5.3, 8), (4.2, 18), (2.9, 27), (2.3, 31)], ribs=9)
    return [base, cone(28.6, 36, 2.8, 12, 22, ribs=17)], []

def lim_tall():
    base = sym([(3.3, 0), (4.3, 2.8), (4.5, 6), (4.0, 10.5), (3.0, 14.5), (2.5, 17.3)], ribs=9)
    return [base, stacked(16, 17, 35, 4, 1.4)], []

def limoncello():
    base = sym([(3.2, 0), (4.5, 3.2), (4.1, 6.5), (3.0, 9.5), (2.4, 11.8)], ribs=9)
    return [base, stacked(16, 11.5, 30, 4, 1.4)], []

def matcha():
    base = sym([(3.6, 0), (4.7, 3.8), (4.2, 7), (2.6, 10.3)], ribs=9)
    return [base, stacked(15, 10, 30, 4, 1.25)], []

def mocha():
    base = sym([(4, 0), (5.7, 4), (5.2, 8.5), (3.3, 11.8)], ribs=10)
    return [base, organic(16, 11.5, 31.5, 2.3, 2.0, 0.05, 0.3)], []

def palermo_tall():
    base = sym([(4, 0), (5.3, 4), (5.4, 8), (4.5, 12), (3.2, 15)], ribs=9)
    return [base, skirt(13.5, 30, 8.2, 12.5, 5, 4)], []

def palermo():
    base = sym([(4.6, 0), (5.8, 2.8), (5.3, 6), (3.6, 9)], ribs=10)
    return [base, skirt(8, 25, 7.6, 12.5, 5, 4)], []

def pleaty():
    base = sym([(4.8, 0), (5.4, 3.5), (5.5, 7), (5.0, 11), (4.6, 12.2)], ribs=11)
    return [base, cone(11.5, 26, 2.8, 12, 26, ribs=17)], []

def bubble():
    b = organic(15, 0, 23, 2.0, 1.8, 0.1, 0.35, ribs=14)
    b["top"] = edge(interp(b["left"], 23), interp(b["right"], 23), lambda x: 23 - 0.35*(1-abs(math.cos(math.pi*3*x/7.5))))
    return [b], []

def mini_bubble():
    b = organic(13, 0.8, 17, 2.0, 1.5, 0.1, 0.35, ribs=12)
    return [rect(5.2, 0, 0.8), b], []

def cloud():
    b = organic(15, 0, 21, 1.5, 2.2, 0.0, 0.2, ribs=13)
    xl, xr = interp(b["left"], 21), interp(b["right"], 21)
    b["top"] = edge(xl, xr, lambda x: 21 - 0.8*(1-abs(math.cos(math.pi*4*(x-xl)/(xr-xl)))))
    return [b], []

def flora():
    chrome = sym([(5, 0), (5, 2.6), (4.4, 3.8), (2.6, 5.2), (2.2, 5.8), (3.4, 6.6), (6.2, 8.3), (7.6, 10.5), (8, 13)])
    shade = sym([(8, 13), (8.3, 15.5), (8.6, 18), (9, 20)], ribs=15)
    return [chrome, shade], []

def short_stack():
    return [rect(6, 0, 0.7), stacked(16, 0.7, 18, 3, 1.3, ribs=13)], []

def cosmo():
    def side(sign, ph, ystart):
        pts = []
        for i in range(161):
            y = ystart + (20 - ystart)*i/160
            tt = y/20
            e = 11.4 - 7.6*tt
            x = e - 1.3*(1 - abs(math.sin(math.pi*(3*tt + ph))))**1.6
            pts.append((sign*x, y))
        return pts
    r, l = side(1, 0.1, 0.6), side(-1, -0.05, 2.0)
    (x0, y0), (x1, y1) = l[0], r[0]
    bot = [(x0 + (x1-x0)*i/60, y0 + (y1-y0)*i/60 - 0.7*math.sin(math.pi*i/60)) for i in range(61)]
    sh = part(r, l, bottom=bot, ribs=11, rib_inset=(2.2, 0.3))
    return [sh, rect(2.2, 20, 29)], []

def astro():
    shell = sym([(8.5, 0), (11.2, 1.5), (12.8, 4.5), (13, 7.5), (12.2, 11.5), (9.5, 16.5), (6, 20.2), (3.2, 22)])
    inner = stacked(13, 2.5, 19.5, 3, 1.0, ribs=10, style="faint")
    return [shell, inner, rect(2, 22, 27)], []

def otto():
    r = wave_side(15, 0, 16, 4, 0.9, 0.5, 1.6)
    r += [(2.6 + 4.9*math.sqrt(max(0, 1-((y-16)/4)**2)), y) for y in [16 + 4*i/40 for i in range(1, 41)]]
    return [part(r, mirror(r), ribs=12), rect(2.4, 20, 25)], []

def mug():
    body = sym([(3.5, 0), (3.95, 0.5), (4, 1.5), (4, 9.5)], style="mug")
    return [body], [cr([(4, 7.9), (6.4, 7.6), (7.4, 5.4), (6.6, 3.0), (4, 2.5)]),
                    cr([(4, 6.6), (5.6, 6.3), (6.0, 5.2), (5.5, 4.0), (4, 3.8)])]

# ---------- rendering ----------
INK = "#2B2825"; FILL = "#FFFDF9"; BG = "#F5F1EB"; DIM = "#A59D93"; SUB = "#857C72"; MUG = "#B3AAA0"

def pts_str(pts, X, Y):
    return " ".join(f"{X(x):.1f},{Y(y):.1f}" for x, y in pts)

def draw_item(parts, extra, X, Y):
    o = []
    for p in parts:
        loop = list(p["right"])
        loop += list(reversed(p["top"])) if p["top"] else []
        loop += list(reversed(p["left"]))
        loop += list(p["bottom"]) if p["bottom"] else []
        if p["style"] == "mug":
            o.append(f'<polygon points="{pts_str(loop, X, Y)}" fill="none" stroke="{MUG}" stroke-width="3" stroke-dasharray="9 7" stroke-linejoin="round"/>')
            continue
        if p["style"] == "faint":
            o.append(f'<polygon points="{pts_str(loop, X, Y)}" fill="none" stroke="{INK}" stroke-opacity="0.35" stroke-width="2.2" stroke-linejoin="round"/>')
        else:
            o.append(f'<polygon points="{pts_str(loop, X, Y)}" fill="{FILL}" stroke="{INK}" stroke-width="3.4" stroke-linejoin="round"/>')
        if p["ribs"]:
            ys = [q[1] for q in p["right"]] + [q[1] for q in p["left"]]
            y0, y1 = min(ys) + p["rib_inset"][0], max(ys) - p["rib_inset"][1]
            us = p["rib_u"] or [(1 - math.cos(math.pi*(k+1)/(p["ribs"]+1)))/2 for k in range(p["ribs"])]
            for u in us:
                line = []
                for i in range(41):
                    y = y0 + (y1-y0)*i/40
                    xl, xr = interp(p["left"], y), interp(p["right"], y)
                    line.append((xl + (xr-xl)*u, y))
                o.append(f'<polyline points="{pts_str(line, X, Y)}" fill="none" stroke="{INK}" stroke-opacity="0.22" stroke-width="1.6"/>')
    for e in extra:
        col = MUG if parts[0]["style"] == "mug" else INK
        dash = ' stroke-dasharray="9 7"' if parts[0]["style"] == "mug" else ""
        o.append(f'<polyline points="{pts_str(e, X, Y)}" fill="none" stroke="{col}" stroke-width="3" stroke-linecap="round"{dash}/>')
    return o

def bounds(parts, extra):
    xs = [q[0] for p in parts for k in ("right", "left") for q in p[k]] + [q[0] for e in extra for q in e]
    return min(xs), max(xs)

def height_line(xpx, ytop, ybot, label):
    mid = (ytop + ybot)/2
    return [f'<line x1="{xpx}" y1="{ytop}" x2="{xpx}" y2="{ybot}" stroke="{DIM}" stroke-width="2"/>',
            f'<line x1="{xpx-8}" y1="{ytop}" x2="{xpx+8}" y2="{ytop}" stroke="{DIM}" stroke-width="2"/>',
            f'<line x1="{xpx-8}" y1="{ybot}" x2="{xpx+8}" y2="{ybot}" stroke="{DIM}" stroke-width="2"/>',
            f'<text x="{xpx-14}" y="{mid}" transform="rotate(-90 {xpx-14} {mid})" text-anchor="middle" font-size="27" fill="{SUB}">{label}</text>']

def width_line(x0, x1, y, label):
    return [f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="{DIM}" stroke-width="2"/>',
            f'<line x1="{x0}" y1="{y-8}" x2="{x0}" y2="{y+8}" stroke="{DIM}" stroke-width="2"/>',
            f'<line x1="{x1}" y1="{y-8}" x2="{x1}" y2="{y+8}" stroke="{DIM}" stroke-width="2"/>',
            f'<text x="{(x0+x1)/2}" y="{y+40}" text-anchor="middle" font-size="27" fill="{SUB}">{label}</text>']

def fmt(v):
    return f"{v:g} cm"

SIZE = 2160; MARGIN = 110; RES = 3.8; GAP = 2.6

def layout_row(items, S):
    """items: (name, sub, fn, H, W). returns list of (item, cx_px) given left start"""
    geo = []
    for it in items:
        parts, extra = it[2]()
        xmin, xmax = bounds(parts, extra)
        lres = 1.5 if it[2] is mug else RES
        geo.append((it, parts, extra, xmin, xmax, lres))
    total = sum((g[4]-g[3]) + g[5] for g in geo) + GAP*(len(geo)-1)
    return geo, total

def header(title, subtitle):
    return [f'<text x="{MARGIN}" y="{MARGIN+70}" font-size="76" font-weight="600" fill="{INK}" letter-spacing="-1">{title}</text>',
            f'<text x="{MARGIN}" y="{MARGIN+130}" font-size="32" fill="{SUB}">{subtitle}</text>']

def place_row(geo, S, left_px, base_y, name_y=None, hang_top=None):
    o = []
    x = left_px
    for (name, sub, fn, H, W), parts, extra, xmin, xmax, lres in geo:
        x += lres*S
        cx = x - xmin*S
        if hang_top is None:
            by = base_y
        else:
            by = hang_top + H*S
            o.append(f'<line x1="{cx}" y1="{base_y}" x2="{cx}" y2="{hang_top}" stroke="{INK}" stroke-width="2.2"/>')
        X = lambda v, cx=cx: cx + v*S
        Y = lambda v, by=by: by - v*S
        o += draw_item(parts, extra, X, Y)
        ny = name_y if name_y else by + 125
        if fn is mug:
            o.append(f'<text x="{X((xmin+xmax)/2)}" y="{ny}" text-anchor="middle" font-size="29" fill="{SUB}">Mug</text>')
            o.append(f'<text x="{X((xmin+xmax)/2)}" y="{ny+36}" text-anchor="middle" font-size="27" fill="{SUB}">{fmt(H)}</text>')
        else:
            o += height_line(X(xmin) - 14, Y(H), by, fmt(H))
            o += width_line(X(-W/2), X(W/2), by + 30, fmt(W))
            o.append(f'<text x="{cx}" y="{ny}" text-anchor="middle" font-size="31" font-weight="600" fill="{INK}">{name}</text>')
            if sub:
                o.append(f'<text x="{cx}" y="{ny+34}" text-anchor="middle" font-size="25" fill="{SUB}">{sub}</text>')
        x = cx + xmax*S + GAP*S
    return o

def svg(body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}" '
            f'font-family="Inter, sans-serif"><rect width="100%" height="100%" fill="{BG}"/>' + "".join(body) + "</svg>")

def table_image():
    row1 = [("Big Lamp", "Yellow · Brown", big, 60, 25), ("Super Pleaty", "", super_pleaty, 36, 24),
            ("Limoncello Tall", "", lim_tall, 35, 16), ("Mocha", "", mocha, 31.5, 16),
            ("Matcha", "", matcha, 30, 15), ("Limoncello", "", limoncello, 30, 16),
            ("Palermo Tall", "", palermo_tall, 30, 25)]
    row2 = [("Pleaty", "", pleaty, 26, 24), ("Palermo", "", palermo, 25, 25), ("Bubble", "", bubble, 23, 15),
            ("Cloud", "", cloud, 21, 15), ("Flora", "", flora, 20, 18), ("Short Stack", "", short_stack, 18, 16),
            ("Mini Bubble", "", mini_bubble, 17, 13), ("Mug", "", mug, 9.5, 8)]
    g1, t1 = layout_row(row1, 1); g2, t2 = layout_row(row2, 1)
    avail = SIZE - 2*MARGIN
    S = avail / max(t1, t2)
    labels = 175
    block = 60*S + labels + 130 + 26*S + labels
    top = MARGIN + 230 + (SIZE - MARGIN - (MARGIN + 230) - block)/2
    b1 = top + 60*S; b2 = b1 + labels + 130 + 26*S
    o = header("Table Lamps", "Size guide · all lamps drawn to scale · measurements in cm")
    for b in (b1, b2):
        o.append(f'<line x1="{MARGIN}" y1="{b}" x2="{SIZE-MARGIN}" y2="{b}" stroke="{INK}" stroke-opacity="0.18" stroke-width="2"/>')
    o += place_row(g1, S, MARGIN + (avail - t1*S)/2, b1)
    o += place_row(g2, S, MARGIN + (avail - t2*S)/2, b2)
    return svg(o), S

def pendant_image():
    global GAP
    GAP = 6
    row = [("Cosmo", "", cosmo, 29, 21), ("Astro", "", astro, 27, 26), ("Otto", "", otto, 25, 15)]
    g, t = layout_row(row, 1)
    mg, mt = layout_row([("Mug", "", mug, 9.5, 8)], 1)
    avail = SIZE - 2*MARGIN
    S = avail / (t + GAP + mt)
    S = min(S, 19)
    cord = 560
    ceiling = MARGIN + 360
    hang = ceiling + cord
    name_y = hang + 29*S + 150
    o = header("Pendant Lamps", "Size guide · all lamps drawn to scale · measurements in cm")
    o.append(f'<line x1="{MARGIN}" y1="{ceiling}" x2="{SIZE-MARGIN}" y2="{ceiling}" stroke="{INK}" stroke-opacity="0.18" stroke-width="2"/>')
    left = MARGIN + (avail - (t + GAP + mt)*S)/2
    o += place_row(g, S, left, ceiling, name_y=name_y, hang_top=hang)
    mleft = left + (t + GAP)*S
    mug_base = hang + 29*S
    o.append(f'<line x1="{mleft-30}" y1="{mug_base}" x2="{mleft + mt*S + 30}" y2="{mug_base}" stroke="{INK}" stroke-opacity="0.18" stroke-width="2"/>')
    o += place_row(mg, S, mleft, mug_base, name_y=name_y)
    o.append(f'<text x="{MARGIN}" y="{SIZE-MARGIN}" font-size="26" fill="{SUB}">Height includes the white housing on top.</text>')
    return svg(o), S

if __name__ == "__main__":
    out = sys.argv[1]
    s1, S1 = table_image(); open(f"{out}/table.svg", "w").write(s1)
    s2, S2 = pendant_image(); open(f"{out}/pendant.svg", "w").write(s2)
    print("scales", S1, S2)

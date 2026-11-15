# Kroniky Popola – maľované textúry v štýle referencie (teplá dlažba, šťavnatá tráva, lístie)
# Výstup: PNG do priečinka textures (prefix r_). Všetko je bezšvové (tileable).
import numpy as np, math, os, sys
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from scipy.spatial import cKDTree

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)

def tnoise(size, cells, seed):
    """tileable value noise, cells = (cy, cx) or int"""
    if isinstance(cells, int): cells = (cells, cells)
    r = np.random.RandomState(seed).rand(cells[0], cells[1])
    return np.clip(ndimage.zoom(r, (size[0] / cells[0], size[1] / cells[1]), order=3, mode='grid-wrap'), 0, 1)

def fbm(size, cells, octaves, seed, gain=0.5):
    if isinstance(size, int): size = (size, size)
    if isinstance(cells, int): cells = (cells, cells)
    out = np.zeros(size); amp = 1.0; tot = 0.0
    for o in range(octaves):
        c = (min(size[0], cells[0] * 2 ** o), min(size[1], cells[1] * 2 ** o))
        out += tnoise(size, c, seed + o * 17) * amp; tot += amp; amp *= gain
    return out / tot

def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def worley(size, n, seed, jitter=0.42, drop=0.1):
    """tileable worley on a jittered n×n grid → F1, F2 (in cell units), id, per-point random table"""
    if isinstance(size, int): size = (size, size)
    if isinstance(n, int): n = (n, n)
    rs = np.random.RandomState(seed)
    gy, gx = np.mgrid[0:n[0], 0:n[1]]
    pts = np.stack([(gx + 0.5 + (rs.rand(*gx.shape) - 0.5) * 2 * jitter) / n[1], (gy + 0.5 + (rs.rand(*gy.shape) - 0.5) * 2 * jitter) / n[0]], -1).reshape(-1, 2)
    keep = rs.rand(len(pts)) > drop; pts = pts[keep] % 1.0
    tree = cKDTree(pts, boxsize=1.0)
    yy, xx = np.mgrid[0:size[0], 0:size[1]]
    q = np.stack([(xx + 0.5) / size[1], (yy + 0.5) / size[0]], -1).reshape(-1, 2)
    # anisotropic domains: scale distances so that cells stay round
    d, idx = tree.query(q, k=2)
    f1 = d[:, 0].reshape(size) * n[1]; f2 = d[:, 1].reshape(size) * n[1]
    return f1, f2, idx[:, 0].reshape(size), rs.rand(len(pts), 4)

def normal_map(h, strength=4.0):
    """DirectX-style (hra otáča Y cez normalScale)"""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5

def save(name, rgb, alpha=None):
    a = np.clip(rgb, 0, 1)
    if alpha is not None: a = np.concatenate([a, np.clip(alpha, 0, 1)[..., None]], -1)
    im = Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGBA' if alpha is not None else 'RGB')
    im.save(os.path.join(OUT, name + '.png'), optimize=True); print(name, im.size)
    return im

def mix(a, b, t):
    t = t[..., None] if t.ndim == 2 else t
    return a * (1 - t) + b * t

def col(*c): return np.array(c, dtype=float)

def paint(rgb, amount=1.0, seed=0):
    """jemný maliarsky filter: zmäkčenie + plátno"""
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
    sm = np.asarray(im.filter(ImageFilter.MedianFilter(5)), dtype=float) / 255
    out = rgb * (1 - 0.6 * amount) + sm * 0.6 * amount
    g = fbm(rgb.shape[:2], 96, 2, 900 + seed) - 0.5
    return out * (1 + g[..., None] * 0.07)

# ============================================================== dlažba (teplá, zaoblené kamene, mach v škárach)
def cobble(name, size=1024, n=13, seed=3, warm=1.0, moss=0.5):
    f1, f2, idx, rt = worley(size, n, seed, jitter=0.44, drop=0.13)
    e = f2 - f1
    m0 = ndimage.gaussian_filter((e > 0.11).astype(float), size / 1024 * 5.5, mode='wrap')
    m = sstep(0.42, 0.62, m0)                                  # maska kameňa (zaoblené rohy)
    dome = sstep(0.03, 0.55, e) ** 0.7                         # zaoblený vrch
    tiltx = (rt[idx, 0] - 0.5); tilty = (rt[idx, 1] - 0.5)
    yy, xx = np.mgrid[0:size, 0:size] / size
    h = dome * (0.75 + 0.25 * rt[idx, 2]) + (np.sin(xx * 40 * tiltx) + np.cos(yy * 40 * tilty)) * 0.015 + fbm(size, 64, 3, seed + 5) * 0.12
    # paleta: teplý piesok / okrová / sivohnedá / chladná sivofialová / olivová
    pal = np.array([[0.74, 0.60, 0.42], [0.66, 0.52, 0.36], [0.58, 0.50, 0.40], [0.70, 0.63, 0.50], [0.55, 0.49, 0.43], [0.56, 0.54, 0.38], [0.80, 0.68, 0.48], [0.50, 0.46, 0.44], [0.69, 0.56, 0.40]])
    pi = (rt[idx, 3] * len(pal)).astype(int) % len(pal)
    base = pal[pi] * (0.86 + 0.28 * rt[idx, 2][..., None])
    if warm != 1.0: base = base * np.array([1.0 + 0.12 * (warm - 1), 1.0, 1.0 - 0.18 * (warm - 1)])
    # maľovaná fazeta: svetlo zľava-zhora teplé, tieň vpravo-dole chladný
    gx = np.roll(h, -1, 1) - np.roll(h, 1, 1); gy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    lit = np.clip((-gx * 0.7 - gy * 0.8) * 9, -1, 1)
    stone = base * (1 + 0.20 * np.clip(lit, 0, 1)[..., None] * col(1.15, 1.0, 0.75)) * (1 - 0.30 * np.clip(-lit, 0, 1)[..., None] * col(1.0, 0.95, 0.75))
    stone *= (0.88 + 0.24 * fbm(size, 48, 4, seed + 9))[..., None]            # škvrny
    stone *= (0.93 + 0.14 * dome)[..., None]
    wear = fbm(size, 5, 3, seed + 21)                                           # veľké tónové plochy (nenápadné)
    stone = stone * (0.94 + 0.12 * wear[..., None]) * mix(col(1.03, 1.0, 0.95), col(0.96, 1.0, 1.03), sstep(0.35, 0.65, fbm(size, 4, 2, seed + 31)))
    gapn = fbm(size, 40, 4, seed + 13)
    gap = mix(col(0.20, 0.15, 0.10), col(0.36, 0.28, 0.17), gapn)
    mossm = sstep(0.52 - 0.25 * moss, 0.75 - 0.2 * moss, fbm(size, 9, 4, seed + 17))
    gap = mix(gap, col(0.24, 0.36, 0.12) * (0.7 + 0.6 * gapn[..., None]), mossm * 0.9)
    edge_moss = (1 - sstep(0.17, 0.42, e)) * mossm * 0.55 * moss               # mach lezie na okraj kameňa
    stone = mix(stone, col(0.30, 0.40, 0.15), edge_moss)
    rgb = mix(gap, stone, m)
    rgb = paint(rgb, 0.8, seed)
    save(name, rgb)
    hh = m * (0.35 + 0.65 * dome) + fbm(size, 128, 2, seed + 40) * 0.05
    save(name + '_n', normal_map(ndimage.gaussian_filter(hh, 1.2, mode='wrap'), 5.0))
    return rgb, m, idx, rt, e

# ============================================================== tráva (šťavnatá, ťahy štetcom)
def strokes(size, n, seed, colfn, lmin=8, lmax=20, w=(1, 3), ang=(-math.pi / 2, 0.6), ss=2):
    S = size * ss; im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im); rs = np.random.RandomState(seed)
    for i in range(n):
        x, y = rs.rand() * S, rs.rand() * S; L = rs.uniform(lmin, lmax) * ss; a = ang[0] + rs.randn() * ang[1]
        c = colfn(rs, x / S, y / S); wd = int(rs.uniform(*w) * ss)
        bend = rs.randn() * 0.5; pts = []
        for k in range(4):
            t = k / 3; aa = a + bend * t; pts.append((x + math.cos(aa) * L * t, y + math.sin(aa) * L * t))
        for ox in (-S, 0, S):
            for oy in (-S, 0, S):
                if -L < x + ox < S + L and -L < y + oy < S + L:
                    d.line([(px + ox, py + oy) for px, py in pts], fill=c, width=max(1, wd), joint='curve')
    return np.asarray(im.resize((size, size), Image.LANCZOS), dtype=float) / 255

def grass(name, size=1024, seed=11, lush=1.0):
    big = fbm(size, 4, 4, seed); mid = fbm(size, 14, 4, seed + 3)
    deep, midc, sun = col(0.09, 0.22, 0.10), col(0.20, 0.38, 0.10), col(0.46, 0.56, 0.14)
    rgb = mix(deep, midc, sstep(0.25, 0.65, big * 0.6 + mid * 0.4))
    rgb = mix(rgb, sun, sstep(0.55, 0.9, mid * 0.55 + big * 0.45) * 0.55)
    def cf(rs, u, v):
        k = rs.rand(); b = big[int(v * size) % size, int(u * size) % size]
        if k < 0.35: c = (0.07, 0.19, 0.09)
        elif k < 0.75: c = (0.22 + 0.1 * b, 0.42 + 0.1 * b, 0.11)
        else: c = (0.50 + 0.12 * b, 0.62 + 0.08 * b, 0.18)
        return tuple(int(255 * x) for x in c) + (int(rs.uniform(110, 220)),)
    for i, (n, lm, lx) in enumerate([(5200, 10, 26), (5200, 8, 20), (3000, 6, 14)]):
        st = strokes(size, n, seed + 50 + i, cf, lm, lx, (1.2, 2.8))
        rgb = mix(rgb, st[..., :3], st[..., 3] * 0.85)
    # drobné kvietky / suché steblá
    def cf2(rs, u, v): return (int(235), int(225), int(150), int(rs.uniform(120, 200)))
    st = strokes(size, 260, seed + 99, cf2, 2, 4, (1.5, 2.5)); rgb = mix(rgb, st[..., :3], st[..., 3] * 0.6)
    rgb = paint(rgb, 0.5, seed) * 1.22
    save(name, rgb)

# ============================================================== piesková cesta
def dirt(name, size=1024, seed=21):
    a = fbm(size, 5, 5, seed); b = fbm(size, 28, 4, seed + 4)
    rgb = mix(col(0.52, 0.37, 0.20), col(0.74, 0.57, 0.33), sstep(0.2, 0.8, a * 0.55 + b * 0.45))
    rgb = mix(rgb, col(0.42, 0.30, 0.17), sstep(0.6, 0.85, fbm(size, 9, 4, seed + 8)) * 0.5)
    f1, f2, idx, rt = worley(size, 22, seed + 2, jitter=0.5, drop=0.72)
    peb = (1 - sstep(0.10, 0.2 + 0.12 * rt[idx, 0], f1)) * (rt[idx, 1] > 0.3)
    pc = np.array([[0.58, 0.50, 0.40], [0.48, 0.40, 0.32], [0.68, 0.58, 0.44]])[(rt[idx, 2] * 3).astype(int) % 3]
    gx = np.roll(f1, -1, 1) - np.roll(f1, 1, 1); gy = np.roll(f1, -1, 0) - np.roll(f1, 1, 0)
    pc = pc * (1 + np.clip((gx + gy) * 6, -0.35, 0.35))[..., None]
    rgb = mix(rgb, pc, peb * 0.9)
    def cf(rs, u, v): return (int(rs.uniform(90, 130)), int(rs.uniform(60, 90)), int(rs.uniform(30, 50)), int(rs.uniform(40, 110)))
    st = strokes(size, 1500, seed + 60, cf, 6, 22, (1, 2.5), ang=(0, 3.0)); rgb = mix(rgb, st[..., :3], st[..., 3] * 0.5)
    rgb = paint(rgb, 0.7, seed)
    save(name, rgb)
    return rgb

# ============================================================== cesta ako pás (RGBA, u pozdĺž, v naprieč – kraje sa rozpadajú do trávy)
def road(name, cob_rgb, cob_m, cob_idx, cob_rt, dirt_rgb, seed=31, tint=(1.08, 0.97, 0.80)):
    H, W = 512, 1024
    # stred pásu textúry dlažby 1024×512 (bezšvové v u)
    rgb = cob_rgb[256:768, :, :] * np.array(tint); m = cob_m[256:768]; idx = cob_idx[256:768]; rt = cob_rt
    vv = (np.mgrid[0:H, 0:W][0] + 0.5) / H
    edge = np.minimum(vv, 1 - vv) * 2                                   # 0 na kraji, 1 v strede
    n1 = tnoise((H, W), (6, 12), seed); n2 = tnoise((H, W), (20, 40), seed + 3)
    # prítomnosť kameňa: podľa stredu kameňa (aby kameň nebol preseknutý)
    cy = ndimage.mean(vv, labels=idx, index=np.arange(rt.shape[0]))
    cy = np.nan_to_num(cy, nan=0.5); ce = np.minimum(cy, 1 - cy) * 2
    present = (ce + (rt[:, 0] - 0.5) * 0.30) > 0.34
    stone_a = present[idx] * m
    dirt_a = sstep(0.20, 0.55, edge + (n1 - 0.5) * 0.45 + (n2 - 0.5) * 0.2)
    d = dirt_rgb[:H, :W] * np.array([0.92, 0.88, 0.80])
    out = mix(d, rgb, stone_a)
    alpha = np.maximum(stone_a * sstep(0.10, 0.22, edge + (n2 - 0.5) * 0.1), dirt_a * 0.96)
    alpha = np.clip(ndimage.gaussian_filter(alpha, 1.5, mode=('nearest', 'wrap')), 0, 1)
    save(name, out, alpha)

def blob_decal(name, src_rgb, seed, size=512, power=1.0, tint=(1, 1, 1)):
    yy, xx = (np.mgrid[0:size, 0:size] + 0.5) / size - 0.5
    r = np.hypot(xx, yy) * 2; ang = np.arctan2(yy, xx)
    rs = np.random.RandomState(seed); wob = sum(rs.uniform(0.03, 0.09) * np.sin(ang * k + rs.rand() * 6.28) for k in (2, 3, 5, 7))
    a = 1 - sstep(0.45, 0.92, r + wob + (fbm(size, 10, 4, seed) - 0.5) * 0.35)
    step = src_rgb.shape[0] // size
    save(name, src_rgb[::step, ::step][:size, :size] * np.array(tint), a ** power)

# ============================================================== lístie (nepriehľadné) + atlas rastlín (RGBA)
LEAF_PAL = [(18, 52, 30), (26, 74, 34), (40, 98, 36), (62, 122, 40), (96, 150, 44), (140, 176, 56), (176, 196, 70)]
def leaf_poly(cx, cy, L, W, a, n=9):
    pts = []
    for i in range(n * 2):
        t = i / (n * 2) * 2 * math.pi; x = math.cos(t) * L * 0.5; y = math.sin(t) * W * 0.5 * (1 - 0.35 * math.cos(t))
        pts.append((cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)))
    return pts
def draw_leaves(d, S, rs, n, region, wrap=True, lmin=22, lmax=46, pal=LEAF_PAL, light_bias=0.0, a0=None):
    for i in range(n):
        x, y, ok = region(rs)
        if not ok: continue
        L = rs.uniform(lmin, lmax); W = L * rs.uniform(0.38, 0.55); a = rs.uniform(0, 6.283) if a0 is None else a0(x, y) + rs.randn() * 0.5
        t = min(1.0, max(0.0, i / n * 0.85 + rs.randn() * 0.14 + light_bias)); c = pal[min(len(pal) - 1, int(t * len(pal)))]
        c = tuple(int(min(255, v * rs.uniform(0.9, 1.1))) for v in c)
        offs = [(-S, 0), (S, 0), (0, -S), (0, S), (0, 0), (-S, -S), (S, S), (-S, S), (S, -S)] if wrap else [(0, 0)]
        for ox, oy in offs:
            if -L < x + ox < S + L and -L < y + oy < S + L:
                p = leaf_poly(x + ox, y + oy, L, W, a); d.polygon(p, fill=c + (255,))
                dk = tuple(int(v * 0.72) for v in c)
                d.line([(x + ox - math.cos(a) * L * 0.45, y + oy - math.sin(a) * L * 0.45), (x + ox + math.cos(a) * L * 0.45, y + oy + math.sin(a) * L * 0.45)], fill=dk + (255,), width=2)

GOLD_PAL = [(70, 44, 16), (120, 70, 18), (170, 104, 22), (214, 140, 30), (236, 176, 44), (246, 206, 70), (250, 226, 110)]
def leaves(name, size=512, seed=41, pal=LEAF_PAL, bg=(14, 40, 24, 255), gain=1.32):
    S = size * 2; im = Image.new('RGBA', (S, S), bg); d = ImageDraw.Draw(im); rs = np.random.RandomState(seed)
    draw_leaves(d, S, rs, 2600, lambda r: (r.rand() * S, r.rand() * S, True), pal=pal)
    rgb = np.asarray(im.resize((size, size), Image.LANCZOS), dtype=float)[..., :3] / 255
    rgb *= (0.86 + 0.28 * fbm(size, 6, 3, seed + 2))[..., None] * gain
    save(name, paint(rgb, 0.35, seed))

def bleed(rgba, iters=24):
    """rozleje farbu do priehľadných pixelov (žiadne tmavé okraje pri mipmapách)"""
    rgb = rgba[..., :3].copy(); a = (rgba[..., 3] > 0.05).astype(float); w = a.copy(); acc = rgb * a[..., None]
    for _ in range(iters):
        acc2 = ndimage.uniform_filter(acc, (3, 3, 1), mode='nearest'); w2 = ndimage.uniform_filter(w, 3, mode='nearest')
        fill = (w < 0.01) & (w2 > 0.001)
        acc[fill] = (acc2[fill] / w2[fill][..., None]); w[fill] = 1.0
    out = rgba.copy(); m = a < 0.5; out[..., :3][m] = acc[m]
    return out

def atlas(name, seed=51):
    C = 512; S = C * 2; SS = 2; rs = np.random.RandomState(seed)
    big = Image.new('RGBA', (S * SS, S * SS), (0, 0, 0, 0)); d = ImageDraw.Draw(big); c = C * SS
    # [0,0] zhluk lístia (okrúhly, rozstrapkaný)
    def reg_cluster(r):
        a = r.rand() * 6.283; rad = math.sqrt(r.rand()) * 0.40 * c * (0.8 + 0.25 * math.sin(a * 5 + 1) * r.rand())
        return c * 0.5 + math.cos(a) * rad, c * 0.5 + math.sin(a) * rad, True
    draw_leaves(d, c, rs, 520, reg_cluster, wrap=False, lmin=30 * SS, lmax=58 * SS, a0=lambda x, y: math.atan2(y - c * 0.5, x - c * 0.5))
    # [1,0] trs trávy (steblá z dolného stredu)
    ox = c
    for i in range(110):
        t = i / 110; bx = ox + c * 0.5 + rs.randn() * c * 0.10; by = c * 0.99; a = -math.pi / 2 + rs.randn() * 0.42; L = c * rs.uniform(0.35, 0.92); bend = rs.randn() * 0.5
        pal = LEAF_PAL[1 + int(min(0.999, max(0, t * 0.9 + rs.randn() * 0.15)) * 5)]; col_ = tuple(int(v * rs.uniform(0.9, 1.15)) for v in pal)
        w0 = rs.uniform(7, 13) * SS; left, right = [], []
        for k in range(9):
            u = k / 8; aa = a + bend * u * u; px = bx + math.cos(aa) * L * u + bend * 20 * u * u; py = by + math.sin(aa) * L * u; w = w0 * (1 - u) ** 0.8 + 1
            nx, ny = -math.sin(aa), math.cos(aa); left.append((px + nx * w / 2, py + ny * w / 2)); right.append((px - nx * w / 2, py - ny * w / 2))
        d.polygon(left + right[::-1], fill=col_ + (255,))
    # [0,1] papraď / široké listy z dolného stredu
    oy = c
    for i in range(15):
        a = -math.pi / 2 + (i / 14 - 0.5) * 2.5 + rs.randn() * 0.08; L = c * rs.uniform(0.55, 0.9) * (1 - 0.25 * abs(i / 14 - 0.5) * 2)
        bx, by = c * 0.5, oy + c * 0.98; droop = (i / 14 - 0.5) * 1.0
        pal = LEAF_PAL[2 + (i * 7) % 4]; spine = []
        for k in range(15):
            u = k / 14; aa = a + droop * u; spine.append((bx + math.cos(aa) * L * u, by + math.sin(aa) * L * u + abs(droop) * 60 * u * u, aa))
        for k in range(2, 15):
            px, py, aa = spine[k]; u = k / 14; ll = c * 0.16 * math.sin(u * math.pi) ** 0.7 + 8
            for sgn in (-1, 1):
                la = aa + sgn * 1.05; col_ = tuple(int(v * rs.uniform(0.85, 1.2)) for v in pal)
                d.polygon(leaf_poly(px + math.cos(la) * ll * 0.5, py + math.sin(la) * ll * 0.5, ll, ll * 0.36, la), fill=col_ + (255,))
        d.line([(p[0], p[1]) for p in spine], fill=(30, 60, 26, 255), width=3 * SS)
    # [1,1] kvety: stonky + kvety (biele, žlté, fialové, červené)
    for i in range(46):
        bx = ox + c * 0.5 + rs.randn() * c * 0.16; by = oy + c * 0.99; a = -math.pi / 2 + rs.randn() * 0.3; L = c * rs.uniform(0.3, 0.85)
        tx, ty = bx + math.cos(a) * L, by + math.sin(a) * L
        d.line([(bx, by), ((bx + tx) / 2 + rs.randn() * 8, (by + ty) / 2), (tx, ty)], fill=(44, 96, 36, 255), width=int(3.5 * SS), joint='curve')
        for k in range(3):
            u = rs.uniform(0.2, 0.7); la = a + rs.choice([-1, 1]) * 0.9; ll = c * 0.10
            d.polygon(leaf_poly(bx + (tx - bx) * u + math.cos(la) * ll * 0.5, by + (ty - by) * u + math.sin(la) * ll * 0.5, ll, ll * 0.4, la), fill=LEAF_PAL[3 + k % 3] + (255,))
        pc = [(250, 244, 230), (252, 214, 70), (176, 120, 232), (232, 84, 70), (255, 170, 60)][i % 5]; R0 = rs.uniform(9, 15) * SS
        for k in range(6):
            pa = k / 6 * 6.283 + rs.rand(); d.ellipse([tx + math.cos(pa) * R0 - R0 * 0.62, ty + math.sin(pa) * R0 - R0 * 0.62, tx + math.cos(pa) * R0 + R0 * 0.62, ty + math.sin(pa) * R0 + R0 * 0.62], fill=pc + (255,))
        d.ellipse([tx - R0 * 0.5, ty - R0 * 0.5, tx + R0 * 0.5, ty + R0 * 0.5], fill=(250, 190, 50, 255))
    arr = np.asarray(big.resize((S, S), Image.LANCZOS), dtype=float) / 255
    arr[..., :3] *= (0.9 + 0.2 * fbm(S, 12, 3, seed + 7))[..., None] * 1.18
    arr = bleed(arr)
    save(name, arr[..., :3], arr[..., 3])

# ============================================================== kôra, skala, murivo, šindeľ, dosky, močiar
def bark(name, size=512, seed=61):
    r = fbm(size, (4, 28), 4, seed); r2 = fbm(size, (10, 70), 3, seed + 3)
    h = np.abs(r - 0.5) * 2 * 0.7 + r2 * 0.3
    rgb = mix(col(0.13, 0.09, 0.06), col(0.44, 0.31, 0.19), sstep(0.1, 0.75, h))
    rgb = mix(rgb, col(0.60, 0.46, 0.28), sstep(0.7, 0.95, h) * 0.6)
    moss = sstep(0.60, 0.80, fbm(size, 5, 4, seed + 9)); rgb = mix(rgb, col(0.26, 0.38, 0.14), moss * 0.55)
    save(name, paint(rgb, 0.5, seed)); save(name + '_n', normal_map(ndimage.gaussian_filter(h, 1, mode='wrap'), 3.5))

def rock(name, size=512, seed=71):
    a = fbm(size, 4, 5, seed); b = fbm(size, 18, 4, seed + 2)
    f1, f2, idx, rt = worley(size, 5, seed + 4, jitter=0.5, drop=0.0)
    facet = rt[idx, 0] * 0.5 + a * 0.5
    rgb = mix(col(0.27, 0.27, 0.30), col(0.52, 0.48, 0.42), sstep(0.2, 0.8, facet))
    rgb = mix(rgb, col(0.70, 0.64, 0.52), sstep(0.62, 0.92, b * 0.6 + facet * 0.4) * 0.6)
    crack = 1 - sstep(0.0, 0.05, f2 - f1); rgb = mix(rgb, col(0.12, 0.11, 0.11), crack * 0.75)
    f1b, f2b, _, _ = worley(size, 14, seed + 6, jitter=0.5, drop=0.3); crack2 = (1 - sstep(0.0, 0.035, f2b - f1b)) * sstep(0.45, 0.6, fbm(size, 6, 3, seed + 8))
    rgb = mix(rgb, col(0.16, 0.15, 0.14), crack2 * 0.5)
    lich = sstep(0.66, 0.8, fbm(size, 22, 3, seed + 11)); rgb = mix(rgb, col(0.52, 0.56, 0.24), lich * 0.45)
    save(name, paint(rgb, 0.7, seed))
    h = facet * 0.6 + b * 0.3 - crack * 0.5 - crack2 * 0.2
    save(name + '_n', normal_map(ndimage.gaussian_filter(h, 1.2, mode='wrap'), 4.0))

def masonry(name, size=512, rows=6, seed=81):
    rs = np.random.RandomState(seed); im = np.zeros((size, size, 3)); hmap = np.zeros((size, size)); rh = size // rows
    yy, xx = np.mgrid[0:size, 0:size]
    pal = np.array([[0.56, 0.50, 0.42], [0.48, 0.44, 0.40], [0.62, 0.56, 0.46], [0.44, 0.42, 0.42], [0.58, 0.54, 0.40]])
    im[:] = col(0.17, 0.14, 0.11)
    for j in range(rows):
        x = int(rs.uniform(-0.5, 0) * rh * 2)
        while x < size:
            w = int(rh * rs.uniform(1.1, 2.4)); c = pal[rs.randint(len(pal))] * rs.uniform(0.85, 1.15); pad = rs.randint(3, 6)
            x0, x1, y0, y1 = x + pad, x + w - pad, j * rh + pad, (j + 1) * rh - pad
            cx, cy, hw, hh = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
            for ox in (-size, 0, size):
                dx = np.abs(xx - cx - ox) - hw + 9; dy = np.abs(yy - cy) - hh + 9
                dd = np.hypot(np.maximum(dx, 0), np.maximum(dy, 0)) + np.minimum(np.maximum(dx, dy), 0) - 9
                msk = 1 - sstep(-1.5, 1.5, dd)
                if msk.max() <= 0: continue
                dome = np.clip(-dd / 12, 0, 1) ** 0.6
                im[:] = mix(im, np.broadcast_to(c, im.shape) * (0.82 + 0.25 * dome[..., None]), msk); hmap = np.maximum(hmap, msk * (0.5 + 0.5 * dome))
            x += w
    gx = np.roll(hmap, -1, 1) - np.roll(hmap, 1, 1); gy = np.roll(hmap, -1, 0) - np.roll(hmap, 1, 0); lit = np.clip((-gx - gy) * 5, -1, 1)
    im = im * (1 + 0.22 * lit[..., None]) * (0.86 + 0.28 * fbm(size, 40, 4, seed + 5))[..., None]
    moss = sstep(0.62, 0.82, fbm(size, 7, 4, seed + 9)) * (1 - hmap * 0.6); im = mix(im, col(0.26, 0.36, 0.14), moss * 0.7)
    save(name, paint(im, 0.6, seed)); save(name + '_n', normal_map(ndimage.gaussian_filter(hmap, 1.2, mode='wrap'), 4.5))

def shingles(name, size=512, rows=8, seed=91, pal=None):
    rs = np.random.RandomState(seed); im = np.zeros((size, size, 3)); hmap = np.zeros((size, size)); rh = size // rows
    yy, xx = np.mgrid[0:size, 0:size]
    pal = np.array(pal or [[0.42, 0.24, 0.14], [0.50, 0.29, 0.15], [0.36, 0.22, 0.15], [0.56, 0.34, 0.17], [0.44, 0.30, 0.22], [0.32, 0.20, 0.14]])
    for j in range(rows):
        x = int(rs.uniform(-1, 0) * rh)
        while x < size:
            w = int(rh * rs.uniform(0.55, 1.05)); c = pal[rs.randint(len(pal))] * rs.uniform(0.85, 1.18); drop_ = rs.randint(0, 7)
            for ox in (-size, 0, size):
                msk = ((xx >= x + ox + 1) & (xx < x + ox + w - 1) & (yy >= j * rh) & (yy < (j + 1) * rh + drop_ - 2)).astype(float)
                if msk.max() <= 0: continue
                v = np.clip((yy - j * rh) / rh, 0, 1)                      # 0 hore (v tieni horného radu) → 1 dole (svetlá hrana)
                tone = 0.55 + 0.6 * v ** 0.8
                im[:] = mix(im, np.broadcast_to(c, im.shape) * tone[..., None], msk); hmap = np.where(msk > 0, 0.3 + 0.7 * v, hmap)
            x += w
    grain = fbm(size, (90, 6), 3, seed + 3); im *= (0.85 + 0.3 * grain)[..., None]
    moss = sstep(0.64, 0.84, fbm(size, 6, 4, seed + 7)); im = mix(im, col(0.30, 0.38, 0.14), moss * 0.55)
    save(name, paint(im, 0.45, seed)); save(name + '_n', normal_map(ndimage.gaussian_filter(hmap, 0.8, mode='wrap'), 3.0))

def planks(name, size=512, n=6, seed=101, base=(0.40, 0.27, 0.15)):
    rs = np.random.RandomState(seed); yy, xx = np.mgrid[0:size, 0:size]; pw = size / n
    pid = (xx // pw).astype(int); tone = rs.uniform(0.8, 1.15, n)[pid]; off = rs.rand(n)[pid]
    g = fbm(size, (3, 60), 4, seed + 2); g2 = np.sin((yy / size * 6.283 * 3 + off * 30) + g * 9) * 0.5 + 0.5
    rgb = np.broadcast_to(col(*base), (size, size, 3)) * (tone * (0.72 + 0.4 * g) * (0.9 + 0.14 * g2))[..., None]
    gap = np.minimum(xx % pw, pw - xx % pw); rgb = rgb * sstep(0.0, 3.0, gap)[..., None] ** 0.7
    rgb = mix(rgb, col(0.62, 0.48, 0.30), sstep(0.72, 0.95, g) * 0.35)
    kn = worley(size, 4, seed + 5, jitter=0.5, drop=0.6); rgb = mix(rgb, col(0.16, 0.10, 0.06), (1 - sstep(0.03, 0.09, kn[0])) * 0.8)
    save(name, paint(rgb, 0.45, seed))

def swamp(name, size=512, seed=111):
    a = fbm(size, 4, 5, seed); b = fbm(size, 16, 4, seed + 3)
    rgb = mix(col(0.05, 0.12, 0.11), col(0.12, 0.25, 0.20), sstep(0.25, 0.75, a))
    alg = sstep(0.55, 0.72, b * 0.6 + a * 0.4); rgb = mix(rgb, col(0.30, 0.42, 0.14), alg * 0.75)
    rgb = mix(rgb, col(0.45, 0.60, 0.50), sstep(0.80, 0.95, fbm(size, 30, 3, seed + 6)) * 0.3)
    save(name, paint(rgb, 0.8, seed))

def plaster(name, size=512, seed=121):
    a = fbm(size, 5, 5, seed); b = fbm(size, 30, 4, seed + 2)
    rgb = mix(col(0.70, 0.60, 0.44), col(0.90, 0.82, 0.64), sstep(0.2, 0.8, a * 0.6 + b * 0.4))
    rgb = mix(rgb, col(0.52, 0.44, 0.32), sstep(0.62, 0.9, fbm(size, 8, 4, seed + 5)) * 0.45)
    def cf(rs, u, v): return (int(rs.uniform(110, 150)), int(rs.uniform(90, 120)), int(rs.uniform(60, 80)), int(rs.uniform(30, 90)))
    st = strokes(size, 500, seed + 60, cf, 10, 40, (1, 3), ang=(0, 3.0)); rgb = mix(rgb, st[..., :3], st[..., 3] * 0.4)
    save(name, paint(rgb, 0.6, seed))

def thatch(name, size=512, seed=131):
    r = fbm(size, (70, 5), 3, seed); a = fbm(size, 5, 4, seed + 2)
    rgb = mix(col(0.34, 0.25, 0.11), col(0.72, 0.58, 0.28), sstep(0.2, 0.85, r * 0.7 + a * 0.3))
    yy = (np.mgrid[0:size, 0:size][0] % (size // 5)) / (size // 5); rgb *= (0.7 + 0.4 * yy ** 0.6)[..., None]
    moss = sstep(0.62, 0.82, fbm(size, 5, 4, seed + 7)); rgb = mix(rgb, col(0.30, 0.40, 0.14), moss * 0.5)
    save(name, paint(rgb, 0.4, seed))

if __name__ == '__main__':
    cr, cm, ci, crt, ce = cobble('r_cobble', 1024, 13, seed=3)
    grass('r_grass', 1024)
    dr = dirt('r_dirt', 1024)
    road('DECAL_r_road', cr, cm, ci, crt, dr)
    blob_decal('DECAL_r_dirt', dr, 201)
    gimg = np.asarray(Image.open(os.path.join(OUT, 'r_grass.png')), dtype=float) / 255
    blob_decal('DECAL_r_grass', gimg, 202, tint=(1.0, 1.02, 0.95))
    leaves('r_leaves'); leaves('r_leaves_gold', seed=43, pal=GOLD_PAL, bg=(60, 36, 14, 255), gain=1.1); atlas('r_plants')
    bark('r_bark'); rock('r_rock'); masonry('r_stonewall'); shingles('r_roof'); planks('r_planks'); swamp('r_swamp'); plaster('r_plaster'); thatch('r_thatch')

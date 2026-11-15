# =====================================================================================
#  Mapa 2 – DUNGEON (Zabudnutá krypta)
# =====================================================================================
reset_scene()
R = random.Random(77)
rr = lambda a, b: a + R.random() * (b - a)
C_ASSET = collection('assets (zdroje)', True); C_ENV = collection('Krypta'); C_MARK = collection('znacky (hra)')

M_FLOOR = material('M_FLOOR_STONE', 'floor_stone', 'floor_stone_n', rough=0.82)
M_BRICK = material('M_BRICK', 'brick', 'brick_n', rough=0.9)
M_STONE = material('M_STONE', 'rock', 'rock_n', color=(0.85, 0.8, 0.74), rough=0.88)
M_TRIM = material('M_TRIM', 'rock', 'rock_n', color=(0.55, 0.5, 0.46), rough=0.85)
M_IRON = material('M_IRON', 'iron', None, rough=0.55, metal=0.8)
M_WOOD = material('M_WOOD', 'wood', None, rough=0.75)
M_BONE = material('M_BONE', 'bone', None, rough=0.7)
M_CLOTH = material('M_BANNER', 'banner', None, rough=0.95)
M_WAX = material('M_WAX', None, color=(0.9, 0.85, 0.72), rough=0.6, vcol=False)
M_VOID = material('M_GROUND_VOID', None, color=(0.01, 0.01, 0.01), rough=1, vcol=False)
M_RUNE = material('M_RUNE_RED', None, color=(0.2, 0.05, 0.08), emis_color=(1.0, 0.15, 0.35), emis_strength=2.0, vcol=False)

X0, X1, Z0, Z1 = -17, 17, -56, 52
CROSS = [22, -14]; DOOR = 4.0
START, PORTAL = (0, 46), (0, -50.5)
PACKS = [(0, 32, 'skeleton,skeleton,cultist'), (-7, 9, 'skeleton,skeleton'), (7, -1, 'cultist,cultist,skeleton'), (0, -28, 'skeleton,skeleton,skeleton,cultist,cultist'), (-9, -44, 'cultist'), (9, -44, 'cultist')]
stone_vc = lambda h=5: ao_moss(top=(0.42, 0.5, 0.32), h0=0, h1=h, dark=0.45, moss=0.35)

# ---------------------------------------------------------------- floor + void
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=34, y_segments=108, size=1)
for v in bm.verts:
    gx = (v.co.x + 1) / 2 * (X1 - X0) + X0; gz = (v.co.y + 1) / 2 * (Z1 - Z0) + Z0; v.co.x = gx; v.co.y = -gz
box_uv(bm, 1 / 4)
def floor_ao(co, n):
    gx, gz = co.x, -co.y; d = min(gx - X0, X1 - gx, *[abs(gz - c) if abs(gx) > DOOR else 9 for c in CROSS]); k = 0.45 + 0.55 * min(1, d / 3.5)
    k *= 0.9 + 0.12 * noise.noise(Vector((gx * 0.15, gz * 0.15, 0.5))); return (k, k * 0.97, k * 0.93)
vcolor(bm, floor_ao)
floor = obj_from_bm('floor', bm, M_FLOOR, C_ENV, props={'ground': 1})
void = obj_from_bm('void', bm_box(260, 260, 0.1, -0.2), M_VOID, C_ENV, props={'ground': 1, 'noshadow': 1})

# ---------------------------------------------------------------- wall module (4 m) with plinth, cornice and pilaster
def wall_module(h, name, pil=True):
    bm = bmesh.new()
    add_box(bm, 4.0, 1.4, h, 0, 0, h / 2)
    b2 = bmesh.new(); add_box(b2, 4.02, 1.75, 0.45, 0, 0, 0.225, 0, 0.05); add_box(b2, 4.02, 1.7, 0.35, 0, 0, h - 0.1, 0, 0.05); add_box(b2, 4.02, 1.95, 0.22, 0, 0, h + 0.15, 0, 0.04)
    if pil:
        add_box(b2, 0.85, 1.85, h - 0.4, 2.0, 0, (h - 0.4) / 2 + 0.2, 0, 0.06); add_box(b2, 1.1, 2.0, 0.35, 2.0, 0, h - 0.3, 0, 0.05)
    finalize(bm); finalize(b2); box_uv(bm, 1 / 4); box_uv(b2, 1 / 3)
    vcolor(bm, stone_vc(h)); vcolor(b2, stone_vc(h))
    nb = len(bm.faces); merge(bm, b2)
    o = obj_from_bm(name, bm, [M_BRICK, M_TRIM], C_ASSET)
    for i, p in enumerate(o.data.polygons):
        if i >= nb: p.material_index = 1
    o['occ'] = 1; return o
WALL_S = wall_module(5.2, 'wall_side'); WALL_X = wall_module(3.8, 'wall_cross'); WALL_N = wall_module(7.0, 'wall_north'); WALL_LOW = wall_module(2.0, 'wall_low', False)

def place_wall(src, x0, x1, z, rot=0.0, step=4.0):
    n = max(1, round(abs(x1 - x0) / step))
    for k in range(n):
        t = (k + 0.5) / n; x = x0 + (x1 - x0) * t
        if rot: instance(src, src.name, P(z, x, 0), rot, 1, C_ENV)
        else: instance(src, src.name, P(x, z, 0), 0, 1, C_ENV)
# side walls run along z (rotate 90°): positioned at x = ±17.7
for sx in (-1, 1):
    n = int((Z1 - Z0 + 4) / 4)
    for k in range(n):
        z = Z1 + 2 - 4 * k - 2; instance(WALL_S, 'wall_side', P(sx * 17.7, z, 0), math.pi / 2, 1, C_ENV)
for k in range(9): instance(WALL_N, 'wall_north', P(-16 + 4 * k, Z0 - 0.7, 0), 0, 1, C_ENV)
for k in range(9): instance(WALL_LOW, 'wall_low', P(-16 + 4 * k, Z1 + 0.7, 0), 0, 1, C_ENV)
for z in CROSS:
    for sx in (-1, 1):
        for k in range(3): instance(WALL_X, 'wall_cross', P(sx * (DOOR + 2.75 + 4 * k), z, 0), 0, 1, C_ENV)
    for sx in (-1, 1): marker('COLBOX', P(sx * (DOOR + 0.5 + 6.6), z), C_MARK, w=13.6, d=1.5)
for sx in (-1, 1): marker('COLBOX', P(sx * 18.2, (Z0 + Z1) / 2), C_MARK, w=2.4, d=Z1 - Z0 + 6)
marker('COLBOX', P(0, Z0 - 0.9), C_MARK, w=40, d=1.8); marker('COLBOX', P(0, Z1 + 0.9), C_MARK, w=40, d=1.8)

# ---------------------------------------------------------------- arched doorway
def arch(span=8.4, h=3.3, thick=1.9, k=0.5):
    bm = bmesh.new()
    for s in (-1, 1):
        add_box(bm, 1.3, thick, h, s * (span / 2 + 0.65), 0, h / 2, 0, 0.06)
        add_box(bm, 1.7, thick + 0.4, 0.5, s * (span / 2 + 0.65), 0, 0.25, 0, 0.06)
        add_box(bm, 1.6, thick + 0.3, 0.35, s * (span / 2 + 0.65), 0, h - 0.1, 0, 0.05)
    n = 13; R0, R1 = span / 2, span / 2 + 1.1
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n; g = 0.012
        vb = bmesh.new(); vs = []
        for (a, r) in [(a0 + g, R0), (a1 - g, R0), (a1 - g, R1 + (0.25 if i == n // 2 else 0)), (a0 + g, R1 + (0.25 if i == n // 2 else 0))]:
            for y in (-thick / 2, thick / 2): vs.append(vb.verts.new((math.cos(a) * r, y, h + math.sin(a) * r * k)))
        f = lambda *ix: vb.faces.new([vs[k] for k in ix])
        f(0, 2, 4, 6); f(1, 7, 5, 3); f(0, 1, 3, 2); f(4, 5, 7, 6); f(0, 6, 7, 1); f(2, 3, 5, 4)
        finalize(vb); merge(bm, vb)
    add_box(bm, span + 3.2, thick + 0.1, 0.8, 0, 0, h + R1 * k + 0.3, 0, 0.06)
    finalize(bm); box_uv(bm, 1 / 3); vcolor(bm, stone_vc(h + 4))
    o = obj_from_bm('arch', bm, M_TRIM, C_ASSET); o['occ'] = 1
    rb = bmesh.new(); add_box(rb, 1.2, 0.05, 0.25, 0, -thick / 2 - 0.08, h + R1 * k + 0.3)
    r = obj_from_bm('arch_runes', rb, M_RUNE, C_ASSET); r.parent = o; r['noshadow'] = 1
    return o
ARCH = arch()
for z in CROSS:
    instance(ARCH, 'arch', P(0, z, 0), 0, 1, C_ENV); instance(ARCH.children[0], 'arch_runes', P(0, z, 0), 0, 1, C_ENV)
    for sx in (-1, 1): marker('COL', P(sx * 4.85, z), C_MARK, col='circle', r=1.0)

# ---------------------------------------------------------------- columns
def column(h=5.8, broken=False, seed=0):
    bm = bmesh.new()
    add_box(bm, 2.0, 2.0, 0.45, 0, 0, 0.225, 0, 0.05)
    merge(bm, lathe([(0.95, 0.45), (0.95, 0.6), (0.78, 0.72), (0.78, 0.8)], 24))
    top = h * (0.55 if broken else 1.0) - 0.8
    seg = 32; sh = bmesh.new(); rings = []
    for zi in range(2):
        z = 0.8 + (top - 0.8) * zi; ring = []
        for i in range(seg):
            a = i / seg * TAU; r = 0.66 if i % 2 == 0 else 0.6
            ring.append(sh.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        rings.append(ring)
    for i in range(seg): sh.faces.new((rings[0][i], rings[0][(i + 1) % seg], rings[1][(i + 1) % seg], rings[1][i]))
    sh.faces.new(rings[1])
    if broken:
        for v in rings[1]: v.co.z += 0.5 * math.cos(math.atan2(v.co.y, v.co.x)) + 0.15 * noise.noise(v.co * 3)
    finalize(sh); merge(bm, sh)
    if not broken:
        merge(bm, lathe([(0.62, top), (0.8, top + 0.25), (0.95, top + 0.45), (0.95, top + 0.55)], 24))
        add_box(bm, 2.1, 2.1, 0.4, 0, 0, top + 0.75, 0, 0.05)
    finalize(bm); cyl_uv(bm, 3, 1 / 3); vcolor(bm, stone_vc(h))
    o = obj_from_bm('column_broken' if broken else 'column', bm, M_STONE, C_ASSET); o['col'] = 'circle'; o['r'] = 1.05; o['occ'] = 1; return o
COL = column(); COLB = column(broken=True)
for z in [44, 31, 13, 2, -8, -24, -36, -46]:
    for sx in (-1, 1):
        src = COLB if (z, sx) in [(13, 1), (-36, -1)] else COL
        instance(src, src.name, P(sx * 10.5, z, 0), rr(0, TAU), 1, C_ENV)
        if src is COLB:
            for k in range(3):
                ch = instance(COLB, 'column_chunk', P(sx * 10.5 + rr(-2.5, 2.5), z + rr(-2.5, 2.5), -0.1), rr(0, TAU), (0.55, 0.55, 0.18), C_ENV, {'col': 'none', 'occ': 0})

# ---------------------------------------------------------------- sarcophagus, altar, coffins, barrels
def sarcophagus():
    bm = bmesh.new(); add_box(bm, 2.5, 4.6, 0.3, 0, 0, 0.15, 0, 0.05); add_box(bm, 2.2, 4.3, 1.0, 0, 0, 0.8, 0, 0.04); add_box(bm, 2.45, 4.55, 0.18, 0, 0, 1.35, 0, 0.04)
    lid = bmesh.new(); add_box(lid, 2.3, 4.4, 0.32, 0, 0, 1.6, 0, 0.06)
    for v in lid.verts:
        if v.co.z > 1.7 and abs(v.co.x) < 0.5: v.co.z += 0.15
    merge(bm, lid)
    add_box(bm, 0.28, 2.6, 0.12, 0, 0.2, 1.86, 0, 0.03); add_box(bm, 1.4, 0.28, 0.12, 0, 0.9, 1.86, 0, 0.03)
    for sy in (-1, 1):
        for sx in (-1, 1): add_box(bm, 0.35, 0.35, 1.0, sx * 1.12, sy * 2.15, 0.8, 0, 0.04)
    finalize(bm); box_uv(bm, 1 / 2.5); vcolor(bm, stone_vc(2))
    o = obj_from_bm('sarcophagus', bm, M_STONE, C_ASSET); o['col'] = 'box'; o['occ'] = 1; return o
SARC = sarcophagus()
for (x, z, r) in [(-5, 40, 0), (5, 40, 0), (0, 4, 0), (-13.8, -2, math.pi / 2), (13.8, 8, math.pi / 2), (-13.8, -40, math.pi / 2), (13.8, -30, math.pi / 2)]:
    instance(SARC, 'sarcophagus', P(x, z, 0), r, 1, C_ENV)

def altar():
    bm = bmesh.new()
    for k, (w, d) in enumerate([(8, 5.2), (6.6, 4.0), (5.2, 2.9)]): add_box(bm, w, d, 0.3, 0, 0, 0.15 + k * 0.3, 0, 0.05)
    add_box(bm, 3.6, 1.8, 1.25, 0, 0, 1.5, 0, 0.06); add_box(bm, 4.0, 2.1, 0.22, 0, 0, 2.2, 0, 0.05)
    for sx in (-1, 1): add_box(bm, 0.5, 0.5, 2.6, sx * 2.6, 0.6, 2.2, 0, 0.04)
    finalize(bm); box_uv(bm, 1 / 2.5); vcolor(bm, stone_vc(3))
    o = obj_from_bm('altar', bm, M_TRIM, C_ASSET); o['occ'] = 1
    rb = bmesh.new(); add_box(rb, 2.4, 0.05, 0.12, 0, -0.93, 1.6); add_box(rb, 0.12, 0.05, 0.9, 0, -0.93, 1.6)
    r = obj_from_bm('altar_runes', rb, M_RUNE, C_ASSET); r.parent = o; r['noshadow'] = 1
    return o
ALTAR = altar(); instance(ALTAR, 'altar', P(0, -41, 0), 0, 1, C_ENV); instance(ALTAR.children[0], 'altar_runes', P(0, -41, 0), 0, 1, C_ENV)
marker('COLBOX', P(0, -41), C_MARK, w=6.4, d=3.2)
marker('TORCH', P(0, -41, 2.8), C_MARK, color=0xff3a80, int=30, flame=1.4)

def coffin():
    bm = bmesh.new(); pts = [(-0.35, -1.0), (0.35, -1.0), (0.55, 0.3), (0.42, 1.0), (-0.42, 1.0), (-0.55, 0.3)]
    vb, vt = [bm.verts.new((x, y, 0)) for x, y in pts], [bm.verts.new((x, y, 0.55)) for x, y in pts]
    for i in range(6): j = (i + 1) % 6; bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
    bm.faces.new(list(reversed(vb))); bm.faces.new(vt); finalize(bm); box_uv(bm, 1 / 2); vcolor(bm, ao_moss(h1=0.6, moss=0, dark=0.6))
    o = obj_from_bm('coffin', bm, M_WOOD, C_ASSET); o['col'] = 'circle'; o['r'] = 0.8; return o
def barrel():
    bm = lathe([(0.42, 0), (0.5, 0.35), (0.52, 0.55), (0.5, 0.8), (0.42, 1.1)], 14); finalize(bm); cyl_uv(bm, 2, 0.9); vcolor(bm, ao_moss(h1=1.1, moss=0, dark=0.6))
    nb = len(bm.faces)
    for z in (0.15, 0.95): merge(bm, lathe([(0.47, z), (0.48, z + 0.06)], 14))
    o = obj_from_bm('barrel', bm, [M_WOOD, M_IRON], C_ASSET)
    for i, p in enumerate(o.data.polygons):
        if i >= nb: p.material_index = 1
    o['col'] = 'circle'; o['r'] = 0.55; return o
def crate():
    bm = bmesh.new(); add_box(bm, 1.1, 1.1, 1.1, 0, 0, 0.55, 0, 0.04)
    for s in (-1, 1): add_box(bm, 1.14, 0.12, 1.14, 0, s * 0.5, 0.55); add_box(bm, 0.12, 1.14, 1.14, s * 0.5, 0, 0.55)
    finalize(bm); box_uv(bm, 0.8); vcolor(bm, ao_moss(h1=1.1, moss=0, dark=0.65))
    o = obj_from_bm('crate', bm, M_WOOD, C_ASSET); o['col'] = 'circle'; o['r'] = 0.75; return o
COFFIN, BARREL, CRATE = coffin(), barrel(), crate()
for (x, z, r) in [(-14.5, 26, 0.3), (-14.2, 28.5, -0.1), (14.6, -19, 0.2), (-14.5, -52, 1.2), (14.5, 47, -0.4)]: instance(COFFIN, 'coffin', P(x, z, 0), r, 1, C_ENV)
for (x, z) in [(14.8, 30), (15.2, 31.3), (14.2, 31.0), (-15, 16.5), (-14.6, -47.5), (15.1, -9.5)]: instance(BARREL, 'barrel', P(x, z, 0), rr(0, TAU), rr(0.9, 1.1), C_ENV)
for (x, z) in [(15, 33.4), (-15.2, 18.2), (-15.1, -49.6), (14.9, -11.6)]: instance(CRATE, 'crate', P(x, z, 0), rr(0, 1), rr(0.9, 1.1), C_ENV)

# ---------------------------------------------------------------- bones, skulls, rubble
def skull():
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.2)
    for v in bm.verts: v.co.y *= 1.2; v.co.z *= 0.95; v.co.z += 0.2
    add_box(bm, 0.24, 0.12, 0.1, 0, -0.18, 0.06, 0, 0.03); finalize(bm); box_uv(bm, 2)
    vcolor(bm, lambda co, n: (0.25, 0.22, 0.2) if (co.y < -0.15 and co.z > 0.2 and abs(abs(co.x) - 0.08) < 0.05) else (1, 1, 1))
    return obj_from_bm('skull', bm, M_BONE, C_ASSET)
def bonepile(seed):
    rs = random.Random(seed); bm = bmesh.new()
    for i in range(9):
        a = rs.random() * TAU; L = rs.uniform(0.5, 0.9); add_cyl(bm, 0.04, 0.035, L, 5, rs.uniform(-0.4, 0.4), rs.uniform(-0.4, 0.4), 0.05, Euler((math.pi / 2, 0, a)))
    finalize(bm); box_uv(bm, 2); vcolor(bm, ao_moss(moss=0, dark=0.7, h1=0.3)); o = obj_from_bm(f'bones_{seed}', bm, M_BONE, C_ASSET); o['noshadow'] = 1; return o
def rubble(seed):
    rs = random.Random(seed); bm = bmesh.new()
    for i in range(7):
        s = bmesh.new(); bmesh.ops.create_icosphere(s, subdivisions=1, radius=rs.uniform(0.15, 0.45)); jitter(s, 0.07, 3, seed + i)
        merge(s if False else bm, s, Matrix.Translation((rs.uniform(-0.8, 0.8), rs.uniform(-0.8, 0.8), 0.05)))
    finalize(bm); box_uv(bm, 1); vcolor(bm, stone_vc(0.6)); return obj_from_bm(f'rubble_{seed}', bm, M_STONE, C_ASSET)
SKULL = skull(); BONES = [bonepile(i) for i in range(3)]; RUBBLE = [rubble(10 + i) for i in range(3)]
for i in range(70):
    x, z = (rr(X0 + 0.8, X0 + 4.5) if R.random() < 0.5 else rr(X1 - 4.5, X1 - 0.8)), rr(Z0 + 1, Z1 - 1)
    src = R.choice(RUBBLE + BONES + [SKULL, SKULL]); instance(src, src.name.split('_')[0], P(x, z, 0), rr(0, TAU), rr(0.8, 1.3), C_ENV)
for i in range(40):
    x, z = rr(-9, 9), rr(Z0 + 2, Z1 - 2)
    if any(abs(z - c) < 2 for c in CROSS): continue
    src = R.choice(BONES + [SKULL]); instance(src, src.name.split('_')[0], P(x, z, 0), rr(0, TAU), rr(0.8, 1.2), C_ENV)

# ---------------------------------------------------------------- wall torches, braziers, candles, banners
def sconce():
    bm = bmesh.new(); add_box(bm, 0.3, 0.12, 0.5, 0, 0.05, 0, 0, 0.02); add_cyl(bm, 0.03, 0.03, 0.55, 5, 0, -0.2, -0.1, Euler((0.9, 0, 0)))
    merge(bm, lathe([(0.04, 0), (0.13, 0.08), (0.15, 0.18)], 8), Matrix.Translation((0, -0.42, 0.2)))
    finalize(bm); box_uv(bm, 2); nb = len(bm.faces)
    add_cyl(bm, 0.05, 0.06, 0.45, 6, 0, -0.42, 0.0); finalize(bm)
    o = obj_from_bm('sconce', bm, [M_IRON, M_WOOD], C_ASSET)
    for i, p in enumerate(o.data.polygons):
        if i >= nb: p.material_index = 1
    o['noshadow'] = 1; return o
def brazier():
    bm = lathe([(0.0, 1.05), (0.55, 1.1), (0.75, 1.35), (0.8, 1.45), (0.62, 1.4), (0.0, 1.3)], 16)
    for k in range(3): add_cyl(bm, 0.05, 0.05, 1.25, 5, math.cos(k * TAU / 3) * 0.32, math.sin(k * TAU / 3) * 0.32, 0, Euler((math.sin(k * TAU / 3) * 0.3, -math.cos(k * TAU / 3) * 0.3, 0)))
    finalize(bm); box_uv(bm, 1); o = obj_from_bm('brazier', bm, M_IRON, C_ASSET); o['col'] = 'circle'; o['r'] = 0.8; return o
def candles(seed):
    rs = random.Random(seed); bm = bmesh.new(); tips = []
    for i in range(5):
        x, y, h = rs.uniform(-0.35, 0.35), rs.uniform(-0.35, 0.35), rs.uniform(0.15, 0.5)
        add_cyl(bm, 0.05, 0.045, h, 7, x, y, 0); tips.append((x, y, h))
    finalize(bm); o = obj_from_bm(f'candles_{seed}', bm, M_WAX, C_ASSET); o['noshadow'] = 1; o['tips'] = str(tips); return o, tips
def banner():
    bm = bmesh.new(); W, H = 1.5, 3.2; nx, ny = 4, 10; vs = {}
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = (i / nx - 0.5) * W; z = -j / ny * H
            if j == ny and i not in (0, nx): z += 0.35 * (1 - abs(i / nx - 0.5) * 2)
            vs[i, j] = bm.verts.new((x, -0.05 * math.sin(j / ny * math.pi * 2 + i * 0.5), z))
    uv = bm.loops.layers.uv.verify()
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]))
            for l, (a, b) in zip(f.loops, [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]): l[uv].uv = (a / nx, 1 - b / ny * 0.88)
    add_cyl(bm, 0.05, 0.05, W + 0.4, 6, -(W + 0.4) / 2, 0, 0.05, Euler((0, math.pi / 2, 0)))
    o = obj_from_bm('banner', bm, M_CLOTH, C_ASSET); return o
SCONCE, BRAZ, BAN = sconce(), brazier(), banner()
for k, z in enumerate(range(46, -54, -11)):
    for sx in (-1, 1):
        zz = z + (5.5 if sx > 0 else 0)
        if any(abs(zz - c) < 2.5 for c in CROSS): continue
        x = sx * 16.95; instance(SCONCE, 'sconce', P(x, zz, 3.0), (math.pi / 2 if sx < 0 else -math.pi / 2), 1, C_ENV)
        marker('TORCH', P(x - sx * 0.42, zz, 3.45), C_MARK, color=0xff8a3a, int=26, flame=1)
        if k % 2 == 0: instance(BAN, 'banner', P(sx * 16.9, zz + 2.75, 5.0), (math.pi / 2 if sx < 0 else -math.pi / 2), 1, C_ENV, {'noshadow': 1})
for z in CROSS:
    for sx in (-1, 1):
        instance(SCONCE, 'sconce', P(sx * 6.2, z + 0.72, 3.0), math.pi, 1, C_ENV); marker('TORCH', P(sx * 6.2, z + 1.14, 3.45), C_MARK, color=0xff8a3a, int=26, flame=1)
for (x, z) in [(-6, 47), (6, 47), (-6.5, -46.5), (6.5, -46.5), (-12, 22.5 + 2), (12, -14 + 2.2)]:
    instance(BRAZ, 'brazier', P(x, z, 0), 0, 1, C_ENV); marker('TORCH', P(x, z, 1.75), C_MARK, color=0xff7a2a, int=34, flame=1.6)
CANDLES = [candles(40 + i) for i in range(3)]
for (cx, cz) in [(-3.6, -39.4), (3.6, -39.4), (-3.8, -42.8), (3.8, -42.8), (-5, 37.3), (5, 37.3), (0, 6.8), (-2.8, 1.2)]:
    src, tips = R.choice(CANDLES); a = rr(0, TAU); instance(src, src.name.split('_')[0], P(cx, cz, 0), a, 1, C_ENV)
    for (tx, ty, th) in tips[:3]:
        ca, sa = math.cos(a), math.sin(a); wx, wy = tx * ca - ty * sa, tx * sa + ty * ca
        marker('TORCH', Vector((cx + wx, -cz + wy, th + 0.1)), C_MARK, color=0xffb050, int=0, flame=0.3, nolight=1)

# ---------------------------------------------------------------- iron door on the north wall behind the portal
def iron_door():
    bm = bmesh.new(); add_box(bm, 6.6, 0.6, 6.0, 0, 0, 3.0, 0, 0.05)
    for k in range(7): add_box(bm, 0.16, 0.25, 5.6, -2.7 + k * 0.9, -0.35, 2.9)
    for z in (1.2, 3.0, 4.8): add_box(bm, 6.0, 0.25, 0.18, 0, -0.38, z)
    finalize(bm); box_uv(bm, 0.6); vcolor(bm, ao_moss(moss=0, dark=0.5, h1=6))
    o = obj_from_bm('iron_door', bm, M_IRON, C_ASSET); return o
DOORN = iron_door(); instance(DOORN, 'iron_door', P(0, Z0 + 0.35, 0), 0, 1, C_ENV)

# ---------------------------------------------------------------- markers
marker('SPAWN', P(*START), C_MARK); marker('PORTAL', P(*PORTAL), C_MARK)
for px, pz, types in PACKS: marker('PACK', P(px, pz), C_MARK, types=types)
result = stats()

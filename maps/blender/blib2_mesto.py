# =====================================================================================
#  Kroniky Popola – stavby a mestské rekvizity (knižnica v2)
#  Všetky budovy majú PREDNÚ stenu v rovine y = 0 a telo smerom k +y → pri rot=0 pozerá
#  fasáda na juh (ku kamere), rot=π/2 na východ, rot=−π/2 na západ.
# =====================================================================================
def window(B, x, y, zc, rz=0.0, w=0.66, h=0.9, flower=False, shut=True):
    c, s = math.cos(rz), math.sin(rz)
    def at(dx, out): return (x + dx * c + out * s, y + dx * s - out * c)
    px, py = at(0, 0.0); B.box('glass', w, 0.06, h, px, py, zc, rz)
    for dz, hh in ((-h / 2 - 0.05, 0.1), (h / 2 + 0.04, 0.09)):
        px, py = at(0, 0.05); B.box('timber', w + 0.22, 0.14, hh, px, py, zc + dz, rz)
    for dx in (-w / 2 - 0.04, w / 2 + 0.04, 0):
        px, py = at(dx, 0.04); B.box('timber', 0.07 if dx else 0.05, 0.1, h, px, py, zc, rz)
    px, py = at(0, 0.04); B.box('timber', w, 0.1, 0.05, px, py, zc + 0.05, rz)
    if shut:
        for sgn in (-1, 1):
            px, py = at(sgn * (w / 2 + 0.24), 0.05); B.box('wood', 0.34, 0.06, h + 0.04, px, py, zc, rz)
    if flower:
        px, py = at(0, 0.22); B.box('wood', w + 0.34, 0.26, 0.2, px, py, zc - h / 2 - 0.2, rz)
        for k in range(3):
            px, py = at((k - 1) * 0.3, 0.24); add_cross(B.bm('cut'), 'flower', 0.55, 0.55, 2, px, py, zc - h / 2 - 0.14, rz + k)

def roof_slab(X, Y, ze, zt, th=0.2, uvs=2.4):
    """jedna strešná rovina: od odkvapu (y=−Y, z=ze) po hrebeň (y=0, z=zt), šírka 2X; UV v = od odkvapu hore"""
    q = bmesh.new(); L = math.hypot(Y, zt - ze); nrm = Vector((0, -(zt - ze), Y)).normalized()
    pts = [(-X, -Y, ze), (X, -Y, ze), (X, 0, zt), (-X, 0, zt)]
    top = [q.verts.new(p) for p in pts]; bot = [q.verts.new(Vector(p) - nrm * th) for p in pts]; uv = q.loops.layers.uv.verify()
    faces = [top, bot[::-1]] + [[bot[i], bot[(i + 1) % 4], top[(i + 1) % 4], top[i]] for i in range(4)]
    for vs in faces:
        f = q.faces.new(vs)
        for l in f.loops: c = l.vert.co; l[uv].uv = (c.x / uvs, math.hypot(c.y + Y, c.z - ze) / uvs)
    q.normal_update(); return q

def roof_parts(B, ww, dd, z, roof_h, ridge='x', ov=0.6, key='roof', gable='plaster'):
    """sedlová strecha nad pôdorysom ww×dd (stred v 0,0); ridge = os hrebeňa"""
    T = Parts(); w2, d2 = (ww, dd) if ridge == 'x' else (dd, ww)
    X, Y = w2 / 2 + ov, d2 / 2 + ov; slope = roof_h / (d2 / 2); ze = z - ov * slope; zt = z + roof_h
    for sgn in (1, -1):
        q = roof_slab(X, Y, ze, zt); M = Matrix.Identity(4) if sgn == 1 else Matrix.Rotation(math.pi, 4, 'Z'); merge(T.bm(key), q, M)
    for sx in (-1, 1):
        g = bmesh.new(); a = g.verts.new((sx * w2 / 2, -d2 / 2, z)); b = g.verts.new((sx * w2 / 2, d2 / 2, z)); c = g.verts.new((sx * w2 / 2, 0, zt - 0.15))
        g.faces.new((a, b, c) if sx > 0 else (c, b, a)); merge(T.bm(gable), g)
        T.box('timber', 0.2, 0.2, roof_h - 0.2, sx * (w2 / 2 + 0.03), 0, z + (roof_h - 0.2) / 2)
        T.box('timber', 0.2, d2 * 0.55, 0.16, sx * (w2 / 2 + 0.03), 0, z + roof_h * 0.45)
        for sy in (-1, 1): T.beam('timber', (sx * (X - 0.05), sy * Y, ze + 0.02), (sx * (X - 0.05), 0, zt + 0.04), 0.12, 0.2)   # veterné dosky
    T.box('timber', 2 * X + 0.1, 0.24, 0.24, 0, 0, zt + 0.03)
    B.take(T, None if ridge == 'x' else Matrix.Rotation(math.pi / 2, 4, 'Z'))

def door_parts(B, x, y, z, w=1.15, h=2.05, rz=0.0, arch=True):
    c, s = math.cos(rz), math.sin(rz)
    def at(dx, out): return (x + dx * c + out * s, y + dx * s - out * c)
    px, py = at(0, 0.05); B.box('wood', w, 0.12, h, px, py, z + h / 2, rz)
    for dx in (-w / 2 - 0.09, w / 2 + 0.09):
        px, py = at(dx, 0.07); B.box('timber', 0.18, 0.2, h + 0.1, px, py, z + h / 2, rz)
    px, py = at(0, 0.07); B.box('timber', w + 0.4, 0.22, 0.2, px, py, z + h + 0.1, rz)
    for dz in (0.45, h - 0.45):
        px, py = at(0, 0.12); B.box('iron', w * 0.9, 0.04, 0.08, px, py, z + dz, rz)
    px, py = at(w * 0.32, 0.14); B.box('iron', 0.09, 0.07, 0.09, px, py, z + h * 0.5, rz)

def house(seed, w=7.0, d=6.0, floors=2, fh=2.7, roof_h=3.4, jetty=0.3, ridge='x', chimney=True, door=True, sign=False, boxes=True, porch=False, lean=None, name='house'):
    """hrazdený dom s kamenným soklom; fasáda v y=0"""
    rs = random.Random(seed); B = Parts(); base = 0.9
    B.box('stone', w + 0.3, d + 0.3, base, 0, 0, base / 2, 0, 0.05); z = base; ww, dd = w, d
    for f in range(floors):
        ww, dd = w + f * jetty * 2, d + f * jetty * 2
        B.box('plaster', ww, dd, fh, 0, 0, z + fh / 2)
        for sx in (-1, 1):
            for sy in (-1, 1): B.box('timber', 0.28, 0.28, fh, sx * ww / 2, sy * dd / 2, z + fh / 2)
        for zz in (z + 0.13, z + fh - 0.13):
            for sy in (-1, 1): B.box('timber', ww + 0.12, 0.26, 0.26, 0, sy * (dd / 2 + 0.02), zz)
            for sx in (-1, 1): B.box('timber', 0.26, dd + 0.12, 0.26, sx * (ww / 2 + 0.02), 0, zz)
        n = max(2, int(ww / 1.6)); m = max(2, int(dd / 1.8))
        for k in range(1, n): B.box('timber', 0.18, 0.2, fh, -ww / 2 + ww * k / n, -(dd / 2 + 0.03), z + fh / 2)
        for k in range(n):
            if (k + f + seed) % 3 == 0 and not (f == 0 and door and k == n // 2):
                x0 = -ww / 2 + ww * k / n; x1 = x0 + ww / n; up = (k % 2 == 0)
                B.beam('timber', (x0 + 0.1, -(dd / 2 + 0.05), z + (0.25 if up else fh - 0.25)), (x1 - 0.1, -(dd / 2 + 0.05), z + (fh - 0.25 if up else 0.25)), 0.16, 0.12)
        for sx in (-1, 1):
            for k in range(1, m): B.box('timber', 0.2, 0.18, fh, sx * (ww / 2 + 0.03), -dd / 2 + dd * k / m, z + fh / 2)
        for k in range(n):
            if f == 0 and door and k == n // 2: continue
            if (k + f + seed) % 3 == 0 or rs.random() < 0.12: continue
            window(B, -ww / 2 + ww * (k + 0.5) / n, -(dd / 2 + 0.02), z + fh * 0.56, 0, flower=(boxes and f == 0))
        for sx in (-1, 1):
            for k in range(m):
                if rs.random() < 0.4: continue
                window(B, sx * (ww / 2 + 0.02), -dd / 2 + dd * (k + 0.5) / m, z + fh * 0.56, sx * math.pi / 2, shut=False)
        z += fh
    if door:
        n = max(2, int(w / 1.6)); dx = -w / 2 + w * (n // 2 + 0.5) / n
        door_parts(B, dx, -d / 2, base); B.box('stone', 1.9, 0.9, 0.3, dx, -(d / 2 + 0.5), 0.15, 0, 0.04); B.box('stone', 1.5, 0.5, 0.3, dx, -(d / 2 + 0.3), 0.45, 0, 0.04)
        if porch:
            for sx in (-1, 1): B.box('timber', 0.16, 0.16, 2.5, dx + sx * 1.0, -(d / 2 + 1.1), base + 1.25 - 0.6)
            q = roof_slab(1.3, 1.5, base + 2.0, base + 2.75); merge(B.bm('roof'), q, Matrix.Translation((dx, -(d / 2) + 0.2, 0)))
        if sign:
            B.beam('timber', (dx + 1.2, -(dd / 2), z - fh + 0.6), (dx + 1.2, -(dd / 2 + 1.1), z - fh + 0.6), 0.1); B.box('wood', 0.07, 0.8, 0.6, dx + 1.2, -(dd / 2 + 0.65), z - fh + 0.2)
            dsk = bm_cyl(0.2, 0.2, 0.09, 8, -0.045); B.col(dsk, (0.85, 0.62, 0.2), 0.0, Matrix.Translation((dx + 1.2, -(dd / 2 + 0.65), z - fh + 0.2)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    roof_parts(B, ww, dd, z, roof_h, ridge)
    if chimney:
        cx = rs.choice([-1, 1]) * ww * 0.28; cy = dd * 0.16; B.box('stone', 0.85, 0.85, roof_h + 1.5, cx, cy, z + (roof_h + 1.5) / 2, 0, 0.04); B.box('stone', 1.05, 1.05, 0.22, cx, cy, z + roof_h + 1.55, 0, 0.03)
    if lean:   # prístrešok / drevenica na boku: (strana ±1, šírka)
        sx, lw = lean; lx = sx * (w / 2 + lw / 2)
        B.box('wood', lw, d * 0.7, 2.2, lx, d * 0.1, 1.1); q = roof_slab(d * 0.4, lw + 0.4, 2.1, 3.3)
        merge(B.bm('roof'), q, Matrix.Translation((sx * (w / 2 - 0.05), d * 0.1, 0)) @ Matrix.Rotation(-sx * math.pi / 2, 4, 'Z'))
    B.shift(0, d / 2 + jetty * (floors - 1), 0)
    fin = {'plaster': ao_moss(moss=0, dark=0.66, h1=base + fh * floors, base=(1.0, 0.97, 0.9)), 'roof': ao_moss(top=(0.55, 0.66, 0.36), moss=0.12, dark=0.72, h0=z - 1, h1=z + roof_h)}
    o = B.build(f'{name}_{seed}', finish=fin); setp(o, col='box', occ=1); return o

def stall(seed, col='red', L=3.6, D=2.2):
    """trhový stánok: pult vpredu (y=0), pruhovaná strieška, tovar"""
    rs = random.Random(seed); B = Parts()
    for sx in (-1, 1):
        B.box('timber', 0.14, 0.14, 2.45, sx * (L / 2 - 0.08), 0.1, 1.22); B.box('timber', 0.14, 0.14, 3.0, sx * (L / 2 - 0.08), D - 0.1, 1.5)
        B.beam('timber', (sx * (L / 2 - 0.08), 0.1, 2.4), (sx * (L / 2 - 0.08), D - 0.1, 2.95), 0.1)
    B.box('wood', L, 0.7, 0.1, 0, 0.35, 0.98); B.box('wood', L - 0.1, 0.08, 0.9, 0, 0.06, 0.5); B.box('wood', L, 0.08, 1.6, 0, D - 0.05, 0.8)
    for sx in (-1, 1): B.box('wood', 0.08, D - 0.3, 0.9, sx * (L / 2 - 0.08), D / 2, 0.5)
    B.box('wood', L - 0.3, 0.5, 0.08, 0, D - 0.4, 1.35)
    # strieška: od zadu (vysoko) dopredu (nízko), presah 0,8 m pred pult
    q = bmesh.new(); uv = q.loops.layers.uv.verify(); X = L / 2 + 0.25; y0, y1, z0, z1 = -0.8, D + 0.15, 2.28, 3.12; n = 6; rows = []
    for i in range(n + 1):
        t = i / n; sag = -0.10 * math.sin(t * math.pi); rows.append([q.verts.new((X * (j / 4 * 2 - 1), y0 + (y1 - y0) * t, z0 + (z1 - z0) * t + sag * (1 - abs(j / 4 * 2 - 1) ** 2 * 0.6))) for j in range(5)])
    for i in range(n):
        for j in range(4):
            f = q.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))): l[uv].uv = (jj / 4 * 2.0, ii / n)
    vcolor(q, lambda co, nn: (0.95, 0.93, 0.9)); merge(B.bm('awn_' + col), q)
    # tovar na pulte
    kinds = [((0.80, 0.14, 0.10), 0.09), ((0.95, 0.60, 0.12), 0.09), ((0.35, 0.60, 0.20), 0.13), ((0.86, 0.72, 0.36), 0.11), ((0.55, 0.20, 0.45), 0.08)]
    for k in range(3):
        cx = (k - 1) * (L / 3.3); crate_parts(B, cx, 0.4, 1.03, 0.62, rs.uniform(-0.1, 0.1)); c, r = kinds[(seed + k) % len(kinds)]
        for i in range(9):
            sp = bmesh.new(); bmesh.ops.create_icosphere(sp, subdivisions=1, radius=r * rs.uniform(0.85, 1.1))
            B.col(sp, tuple(v * rs.uniform(0.85, 1.1) for v in c), 0.0, Matrix.Translation((cx + (i % 3 - 1) * 0.17 + rs.uniform(-0.03, 0.03), 0.4 + (i // 3 - 1) * 0.17, 1.03 + 0.62 + r * 0.5)))
    barrel_parts(B, -L / 2 - 0.55, 0.5, 0, 0.9); sack_parts(B, L / 2 + 0.45, 0.4, 0, 1.0); sack_parts(B, L / 2 + 0.55, 1.0, 0, 0.9, (0.55, 0.47, 0.36))
    B.box('iron', 0.03, 0.03, 0.4, L / 2 - 0.5, -0.3, 2.2); B.box('glass', 0.18, 0.18, 0.26, L / 2 - 0.5, -0.3, 1.9)
    o = B.build(f'stall_{seed}'); setp(o, col='box', dest='wood', hp=120, h=3.0); return o

def fountain():
    B = Parts()
    B.add('stone', lathe([(3.0, 0), (3.0, 0.22), (2.75, 0.22), (2.75, 0.75), (2.5, 0.85), (2.3, 0.85), (2.3, 0.3), (0, 0.3)], 16))
    cyl_uv(B.bm('stone'), 8, 0.4)
    B.add('water', lathe([(2.3, 0.62), (0.0, 0.62)], 16, caps=False))
    col_ = lathe([(0.55, 0.3), (0.42, 0.7), (0.3, 0.9), (0.28, 1.5), (0.5, 1.62), (1.05, 1.9), (1.05, 2.02), (0.3, 1.86), (0.22, 2.3), (0.34, 2.42), (0.0, 2.5)], 12); B.add('stone', col_)
    B.add('water', lathe([(0.95, 1.97), (0.0, 1.97)], 12, caps=False))
    o = B.build('fountain', finish={'stone': ao_moss(top=(0.45, 0.62, 0.3), moss=0.3, dark=0.6, h1=2.4)}); setp(o, col='circle', r=3.15); o['v_sh'] = [1.15, 0.0, 2.5]; return o

def waypoint():
    B = Parts(); B.add('stone', lathe([(1.9, 0), (1.9, 0.16), (1.6, 0.16), (1.6, 0.32), (0, 0.32)], 12))
    ob = bmesh.new(); bmesh.ops.create_cube(ob, size=1.0); bmesh.ops.subdivide_edges(ob, edges=ob.edges[:], cuts=2, use_grid_fill=True)
    for v in ob.verts: z = v.co.z + 0.5; k = 1 - 0.42 * z; v.co = Vector((v.co.x * 0.95 * k, v.co.y * 0.75 * k, 0.32 + z * 3.5))
    jitter(ob, 0.04, 1.2, 5); B.add('rock', ob)
    for zz in (1.0, 1.75, 2.5):
        k = 1 - 0.42 * (zz - 0.32) / 3.5; B.box('rune', 0.97 * k + 0.03, 0.78 * k + 0.03, 0.12, 0, 0, zz)
    for k in range(3): B.box('rune', 0.08, 0.05, 0.34, (k - 1) * 0.2, -0.33, 1.38 + (k % 2) * 0.1); B.box('rune', 0.08, 0.05, 0.3, (k - 1) * 0.16, -0.27, 2.1)
    for i in range(8):
        a = i / 8 * TAU; B.box('rune', 0.3, 0.07, 0.03, math.cos(a) * 1.3, math.sin(a) * 1.3, 0.34, a + math.pi / 2)
    o = B.build('waypoint'); setp(o, col='circle', r=1.7); o['v_sh'] = [0.65, 0.0, 5.1]
    cr = bmesh.new(); bmesh.ops.create_icosphere(cr, subdivisions=1, radius=0.34)
    for v in cr.verts: v.co.z *= 1.7
    c = obj_from_bm('waypoint_crystal', cr, MAT['rune']['mat'], C_ASSET); c['float'] = 1; c['noshadow'] = 1
    return o, c

def pedestal():
    B = Parts(); B.add('stone', lathe([(1.35, 0), (1.35, 0.12), (1.18, 0.14), (1.18, 0.3), (1.25, 0.36), (0, 0.36)], 8)); B.add('gold', lathe([(1.2, 0.19), (1.2, 0.26)], 8, caps=False))
    o = B.build('pedestal'); setp(o, col='circle', r=1.2); return o

def parapet(seed=0, L=3.0, post=True):
    rs = random.Random(seed); B = Parts(); B.box('stone', L, 0.5, 0.9, 0, 0, 0.45, 0, 0.03); B.box('stone', L + 0.04, 0.66, 0.14, 0, 0, 0.97, 0, 0.03)
    if post: B.box('stone', 0.62, 0.74, 1.3, -L / 2, 0, 0.65, 0, 0.05); B.box('stone', 0.76, 0.86, 0.14, -L / 2, 0, 1.36, 0, 0.03)
    o = B.build(f'parapet_{seed}'); setp(o, col='box'); return o

def bench(seed=0):
    B = Parts(); B.box('wood', 1.9, 0.42, 0.08, 0, 0, 0.5)
    for sx in (-1, 1): B.box('timber', 0.1, 0.4, 0.5, sx * 0.8, 0, 0.25)
    o = B.build(f'bench_{seed}'); setp(o, dest='wood', hp=25, h=0.6); return o

def table(seed=0):
    B = Parts(); B.box('wood', 1.9, 0.95, 0.09, 0, 0, 0.82)
    for sx in (-1, 1): B.beam('timber', (sx * 0.75, -0.35, 0), (sx * 0.75, 0.35, 0.8), 0.1); B.beam('timber', (sx * 0.75, 0.35, 0), (sx * 0.75, -0.35, 0.8), 0.1)
    for (x, y, c) in ((-0.5, 0.1, (0.75, 0.6, 0.35)), (0.3, -0.2, (0.6, 0.45, 0.3)), (0.6, 0.2, (0.8, 0.75, 0.6))): B.col(bm_cyl(0.07, 0.09, 0.17, 7), c, 0.0, Matrix.Translation((x, y, 0.87)))
    B.col(bm_cyl(0.2, 0.2, 0.04, 9), (0.8, 0.68, 0.4), 0.0, Matrix.Translation((-0.1, -0.1, 0.87)))
    o = B.build(f'table_{seed}'); setp(o, col='circle', r=0.95, dest='wood', hp=35, h=0.9); return o

def haystack(seed=0):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.25); displace_radial(bm, 0.2, 1.4, seed, 3)
    for v in bm.verts: v.co.z = max(0.0, v.co.z * 0.85 + 0.75)
    finalize(bm); box_uv(bm, 0.4); vcolor(bm, ao_moss(moss=0, dark=0.6, h1=1.8)); o = measure(obj_from_bm(f'hay_{seed}', bm, MAT['thatch']['mat'], C_ASSET, smooth=True))
    setp(o, col='circle', r=1.25, dest='bush', hp=30, h=1.8); return o

def banner_pole(h=5.2):
    B = Parts(); B.box('timber', 0.16, 0.16, h, 0, 0, h / 2); B.box('stone', 0.5, 0.5, 0.35, 0, 0, 0.17, 0, 0.04); B.beam('timber', (0, 0, h - 0.35), (1.25, 0, h - 0.35), 0.09)
    q = bmesh.new(); uv = q.loops.layers.uv.verify(); n = 5; rows = []
    for i in range(n + 1):
        t = i / n; rows.append((q.verts.new((0.18, 0.04 * math.sin(t * 5), h - 0.42 - t * 2.3)), q.verts.new((1.22, 0.06 * math.sin(t * 5 + 1), h - 0.42 - t * 2.3)), 1 - t))
    for a, b in zip(rows, rows[1:]):
        f = q.faces.new((a[0], b[0], b[1], a[1]))
        for l, t in zip(f.loops, ((0, a[2]), (0, b[2]), (1, b[2]), (1, a[2]))): l[uv].uv = t
    vcolor(q, lambda co, nn: (1, 1, 1)); merge(B.bm('banner'), q)
    o = B.build('banner_pole'); setp(o, col='circle', r=0.3); o['v_thin'] = 1; return o

def wall_banner(L=3.2, w=1.3):
    """zástava na stenu (visí v rovine y=0 smerom dolu)"""
    q = bmesh.new(); uv = q.loops.layers.uv.verify(); n = 4; rows = []
    for i in range(n + 1):
        t = i / n; rows.append((q.verts.new((-w / 2, -0.05 - 0.05 * math.sin(t * 4), -t * L)), q.verts.new((w / 2, -0.05 - 0.05 * math.sin(t * 4 + 1), -t * L)), 1 - t))
    for a, b in zip(rows, rows[1:]):
        f = q.faces.new((a[0], b[0], b[1], a[1]))
        for l, t in zip(f.loops, ((0, a[2]), (0, b[2]), (1, b[2]), (1, a[2]))): l[uv].uv = t
    vcolor(q, lambda co, nn: (1, 1, 1)); return q

def town_hall(w=16.0, d=9.0):
    """radnica: kamenné prízemie s podlubím, hrazdené poschodie, strmá strecha s vikiermi a hodinovou vežičkou"""
    B = Parts(); g = 3.9; f2 = 3.2; arc = 2.4; rh = 5.2
    B.box('stone', w, d, g, 0, d / 2 + arc, g / 2)                                          # prízemie (za podlubím)
    B.box('dark', w - 1.2, 0.1, g - 0.6, 0, arc - 0.02, (g - 0.6) / 2)
    n = 5; bay = (w - 0.9) / n
    for i in range(n + 1):
        x = -w / 2 + 0.45 + i * bay; B.box('stone', 0.9, 0.9, g, x, 0.45, g / 2, 0, 0.06); B.box('stone', 1.15, 1.15, 0.3, x, 0.45, 0.15, 0, 0.04); B.box('stone', 1.1, 1.1, 0.28, x, 0.45, g - 0.5, 0, 0.04)
        if i < n:
            xc = x + bay / 2
            for sgn in (-1, 1): B.beam('stone', (xc + sgn * (bay / 2 - 0.45), 0.45, g - 1.25), (xc + sgn * 0.5, 0.45, g - 0.2), 0.42, 0.7)   # náznak oblúka
            if i == n // 2:
                door_parts(B, xc, arc, 0.6, 2.0, 2.7); B.box('iron', 0.05, 0.05, 2.7, xc, arc - 0.14, 1.95)
            else: window(B, xc, arc - 0.02, 2.25, 0, 1.0, 1.4, shut=False)
    B.box('stone', w + 0.3, arc + 0.4, 0.35, 0, arc / 2, g - 0.17, 0, 0.04)                 # preklad nad podlubím
    B.box('stone', w + 0.5, arc + 0.3, 0.6, 0, arc / 2 - 0.05, 0.3, 0, 0.04)                # podesta podlubia
    z = g; ww, dd = w + 0.6, d + arc + 0.3; yc = dd / 2 - 0.15
    B.box('plaster', ww, dd, f2, 0, yc, z + f2 / 2)
    for zz in (z + 0.14, z + f2 - 0.14):
        B.box('timber', ww + 0.14, 0.28, 0.28, 0, -0.13, zz)
        for sx in (-1, 1): B.box('timber', 0.28, dd + 0.1, 0.28, sx * (ww / 2), yc, zz)
    m = 10
    for k in range(m + 1):
        x = -ww / 2 + ww * k / m; B.box('timber', 0.22, 0.24, f2, x, -0.14, z + f2 / 2)
        if k < m:
            xc = x + ww / m / 2
            if k in (4, 5): continue
            if k % 2 == 0: window(B, xc, -0.17, z + f2 * 0.56, 0, 0.8, 1.35, flower=True, shut=False)
            else:
                B.beam('timber', (x + 0.12, -0.17, z + 0.3), (x + ww / m - 0.12, -0.17, z + f2 - 0.3), 0.16, 0.12); B.beam('timber', (x + ww / m - 0.12, -0.17, z + 0.3), (x + 0.12, -0.17, z + f2 - 0.3), 0.16, 0.12)
    for sx in (-1, 1):
        for k in range(1, 5): B.box('timber', 0.24, 0.2, f2, sx * (ww / 2 + 0.02), yc - dd / 2 + dd * k / 5, z + f2 / 2)
        for k in (1, 3): window(B, sx * (ww / 2 + 0.03), yc - dd / 2 + dd * (k + 0.5) / 5, z + f2 * 0.56, sx * math.pi / 2, 0.8, 1.3, shut=False)
    # balkón so zástavou
    B.box('wood', 3.6, 1.0, 0.12, 0, -0.5, z + 0.25); B.box('glass', 1.3, 0.06, 2.0, 0, -0.17, z + 1.35); B.box('timber', 1.6, 0.14, 0.14, 0, -0.2, z + 2.42)
    for k in range(9): B.box('timber', 0.07, 0.07, 0.8, -1.7 + k * 0.425, -0.95, z + 0.7)
    B.box('timber', 3.6, 0.1, 0.1, 0, -0.95, z + 1.1)
    merge(B.bm('banner'), wall_banner(2.6, 1.5), Matrix.Translation((0, -1.02, z + 1.0)))
    for sx in (-1, 1): merge(B.bm('banner'), wall_banner(3.4, 1.2), Matrix.Translation((sx * (w / 2 - 1.6), -0.3, z + f2 - 0.2)))
    z += f2
    T = Parts(); roof_parts(T, ww, dd, z, rh, 'x', 0.7); T.shift(0, yc, 0); B.take(T)
    slope = rh / (dd / 2)
    for sx in (-1, 0, 1):                                                                    # vikiere
        dx = sx * 4.6; dy = 1.9; dz = z + (dy + 0.15) * slope - 0.2
        B.box('plaster', 1.5, 1.6, 1.5, dx, dy + 0.5, dz + 0.55); window(B, dx, dy - 0.32, dz + 0.65, 0, 0.7, 0.85, shut=False)
        q = Parts(); roof_parts(q, 1.5, 1.9, dz + 1.3, 0.95, 'y', 0.25); q.shift(dx, dy + 0.6, 0); B.take(q)
    # hodinová vežička
    tz = z + rh - 0.6; B.box('plaster', 2.3, 2.3, 3.2, 0, yc, tz + 1.6)
    for sx in (-1, 1):
        for sy in (-1, 1): B.box('timber', 0.24, 0.24, 3.2, sx * 1.15, yc + sy * 1.15, tz + 1.6)
    for zz in (tz + 0.9, tz + 3.1): B.box('timber', 2.5, 2.5, 0.2, 0, yc, zz)
    cf = bm_cyl(0.78, 0.78, 0.1, 16, -0.05); B.col(cf, (0.93, 0.88, 0.72), 0.0, Matrix.Translation((0, yc - 1.2, tz + 2.1)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    B.add('gold', lathe([(0.86, -0.06), (0.86, 0.06), (0.76, 0.06)], 16, caps=False), Matrix.Translation((0, yc - 1.2, tz + 2.1)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    B.beam('dark', (0, yc - 1.27, tz + 2.1), (0.0, yc - 1.27, tz + 2.62), 0.07, 0.03); B.beam('dark', (0, yc - 1.27, tz + 2.1), (0.36, yc - 1.27, tz + 2.3), 0.07, 0.03)
    py = bmesh.new(); bmesh.ops.create_cone(py, cap_ends=True, segments=4, radius1=2.1, radius2=0.0, depth=3.6)
    uv = py.loops.layers.uv.verify()
    for f in py.faces:
        for l in f.loops: c = l.vert.co; l[uv].uv = ((c.x + c.y) / 2.4, (c.z + 1.8) / 2.0)
    py.normal_update(); merge(B.bm('roof'), py, Matrix.Translation((0, yc, tz + 3.2 + 1.8)) @ Matrix.Rotation(math.pi / 4, 4, 'Z'))
    B.cyl('gold', 0.06, 0.02, 1.3, 6, 0, yc, tz + 6.7); B.add('gold', lathe([(0.0, 0), (0.2, 0.18), (0.0, 0.4)], 8), Matrix.Translation((0, yc, tz + 7.3)))
    # schody pred podlubím
    for k in range(3): B.box('stone', 9.5 + k * 0.9, 0.85, 0.6 - 0.2 * k, 0, -0.42 - k * 0.8, (0.6 - 0.2 * k) / 2, 0, 0.03)
    fin = {'plaster': ao_moss(moss=0, dark=0.7, h1=g + f2 + rh, base=(1.0, 0.97, 0.9)), 'roof': ao_moss(top=(0.55, 0.66, 0.36), moss=0.1, dark=0.72, h0=z - 1, h1=z + rh + 3),
           'stone': ao_moss(top=(0.5, 0.66, 0.3), moss=0.25, dark=0.58, h1=g)}
    o = B.build('town_hall', finish=fin); setp(o, col='box', occ=1); return o

def smithy(w=11.0, d=6.5):
    """kováčska dielňa: otvorený prístrešok s vyhňou; fasáda (otvorená) v y=0"""
    B = Parts(); h = 3.2
    B.box('stone', w, 0.7, h + 0.8, 0, d - 0.35, (h + 0.8) / 2);
    for sx in (-1, 1): B.box('stone', 0.7, d - 1.4, h, sx * (w / 2 - 0.35), d / 2 + 0.7, h / 2)
    for x in (-w / 2 + 0.3, -w / 6, w / 6, w / 2 - 0.3):
        B.box('timber', 0.3, 0.3, h - 0.3, x, 0.3, (h - 0.3) / 2); B.box('stone', 0.6, 0.6, 0.4, x, 0.3, 0.2, 0, 0.04)
        B.beam('timber', (x, 0.3, h - 1.0), (x + 0.7, 0.3, h - 0.35), 0.14); B.beam('timber', (x, 0.3, h - 1.0), (x - 0.7, 0.3, h - 0.35), 0.14)
    B.box('timber', w + 0.4, 0.3, 0.3, 0, 0.3, h - 0.2)
    q = roof_slab(w / 2 + 0.7, d + 1.4, h - 0.45, h + 2.3); merge(B.bm('roof'), q, Matrix.Translation((0, d + 0.4, 0)))
    for k in range(5): B.beam('timber', (-w / 2 + 0.5 + k * (w - 1) / 4, 0.0, h - 0.25), (-w / 2 + 0.5 + k * (w - 1) / 4, d, h + 1.9), 0.14, 0.18)
    B.box('dark', w - 1.4, 0.1, h, 0, d - 0.75, h / 2)
    # vyhňa s komínom
    fx, fy = w * 0.22, d - 1.8; B.box('stone', 2.4, 1.8, 1.0, fx, fy, 0.5, 0, 0.05); B.box('ember', 1.5, 1.0, 0.12, fx, fy - 0.1, 1.04)
    B.box('stone', 1.6, 1.0, 1.2, fx, fy + 0.45, 2.3, 0, 0.04); B.box('stone', 1.1, 0.9, 3.4, fx, fy + 0.5, 4.3, 0, 0.04); B.box('stone', 1.35, 1.15, 0.22, fx, fy + 0.5, 6.05, 0, 0.03)
    # nákova na kláte, sud s vodou, stojan s náradím, mech
    B.cyl('timber', 0.36, 0.42, 0.6, 9, -0.6, 2.2, 0); an = bmesh.new(); add_box(an, 0.75, 0.26, 0.2, 0, 0, 0.88); add_box(an, 0.36, 0.22, 0.18, 0, 0, 0.7); add_box(an, 0.5, 0.3, 0.1, 0, 0, 0.62); add_cyl(an, 0.11, 0.02, 0.4, 6, 0.36, 0, 0.88, Euler((0, math.pi / 2, 0)))
    B.add('iron', an, Matrix.Translation((-0.6, 2.2, 0)) @ Matrix.Rotation(0.3, 4, 'Z'))
    barrel_parts(B, 1.0, 1.4, 0, 1.0); B.col(bm_cyl(0.33, 0.33, 0.03, 10, 0.94), (0.25, 0.45, 0.55), 0.0, Matrix.Translation((1.0, 1.4, 0)))
    B.box('timber', 2.4, 0.12, 0.12, -w * 0.28, d - 0.9, 2.2)
    for k in range(5):
        x = -w * 0.28 - 1.0 + k * 0.5; B.box('iron', 0.05, 0.05, 1.0 + (k % 2) * 0.2, x, d - 0.95, 1.65); B.box('iron', 0.22 if k % 2 else 0.12, 0.08, 0.2, x, d - 0.95, 1.12)
    crate_parts(B, -w / 2 + 1.3, d - 1.6, 0, 0.9, 0.2); sack_parts(B, -w / 2 + 1.2, 2.6, 0, 1.0, (0.2, 0.18, 0.17)); sack_parts(B, -w / 2 + 1.9, 2.3, 0, 0.9, (0.22, 0.2, 0.18))
    fin = {'roof': ao_moss(top=(0.55, 0.66, 0.36), moss=0.15, dark=0.72, h0=h - 1, h1=h + 2.5)}
    o = B.build('smithy', finish=fin); setp(o, col='box', occ=1); o['v_forge'] = (fx, fy - 0.1, 1.3); return o

def gatehouse(w=7.0):
    """zatvorená mestská brána s dvoma vežami; fasáda v y=0"""
    B = Parts(); h = 6.4
    B.box('stone', w, 2.6, h, 0, 1.3, h / 2); B.box('dark', 3.5, 0.2, 4.3, 0, -0.02, 2.15)
    for k in range(6): B.box('wood', 0.56, 0.16, 4.1, -1.46 + k * 0.585, 0.0, 2.05)
    for zz in (0.8, 2.1, 3.4):
        B.box('iron', 3.5, 0.06, 0.12, 0, -0.1, zz)
        for k in range(6): B.box('iron', 0.08, 0.08, 0.08, -1.46 + k * 0.585, -0.13, zz)
    B.box('timber', 0.16, 0.2, 4.2, 0, -0.1, 2.1)
    for sgn in (-1, 1): B.beam('stone', (sgn * 1.9, -0.1, 3.9), (sgn * 0.5, -0.1, 4.75), 0.5, 0.5); B.box('stone', 0.6, 0.5, 4.3, sgn * 2.05, -0.1, 2.15, 0, 0.04)
    B.box('stone', 4.8, 0.5, 0.5, 0, -0.1, 4.75, 0, 0.04)
    for k in range(6): B.box('stone', 0.7, 0.5, 0.7, -w / 2 + 0.6 + k * (w - 1.2) / 5, 0.25, h + 0.35, 0, 0.04)
    merge(B.bm('banner'), wall_banner(2.4, 1.2), Matrix.Translation((0, -0.4, h - 0.3)))
    for sx in (-1, 1):
        tx = sx * (w / 2 + 1.4); tw = lathe([(2.3, 0), (2.15, 0.5), (2.0, 7.4), (2.3, 7.6), (2.3, 8.3), (0, 8.3)], 12); cyl_uv(tw, 6, 0.4); B.add('stone', tw, Matrix.Translation((tx, 1.3, 0)))
        cn = lathe([(2.75, 8.2), (1.5, 10.2), (0.0, 12.6)], 12); cyl_uv(cn, 5, 0.42); merge(B.bm('roof'), cn, Matrix.Translation((tx, 1.3, 0)))
        B.cyl('gold', 0.05, 0.02, 0.9, 5, tx, 1.3, 12.5); window(B, tx, 1.3 - 2.02, 5.2, 0, 0.45, 0.9, shut=False)
    B.bm('stone')   # box_uv sa aplikuje pri build – valcové UV veží prepíše, čo nevadí
    o = B.build('gatehouse', finish={'roof': ao_moss(top=(0.55, 0.66, 0.36), moss=0.12, dark=0.75, h0=8, h1=12.6)}); setp(o, col='box', occ=1); return o

def notice_board():
    B = Parts()
    for sx in (-1, 1): B.box('timber', 0.14, 0.14, 2.3, sx * 0.85, 0, 1.15)
    B.box('wood', 1.8, 0.08, 1.1, 0, 0, 1.55); q = roof_slab(1.15, 0.35, 2.3, 2.5); merge(B.bm('roof'), q); merge(B.bm('roof'), roof_slab(1.15, 0.35, 2.3, 2.5), Matrix.Rotation(math.pi, 4, 'Z'))
    for (x, z, c) in ((-0.45, 1.7, (0.9, 0.85, 0.7)), (0.3, 1.65, (0.85, 0.8, 0.62)), (0.1, 1.25, (0.92, 0.88, 0.75)), (-0.5, 1.25, (0.8, 0.74, 0.6))):
        pb = bmesh.new(); add_box(pb, 0.4, 0.02, 0.32, x, -0.06, z, 0, 0, Euler((0, 0.1 * x, 0))); B.col(pb, c, 0.0)
    o = B.build('notice_board'); setp(o, col='circle', r=0.6, dest='wood', hp=40, h=2.5); return o

def well():
    B = Parts(); wl = lathe([(1.25, 0), (1.25, 0.85), (0.95, 0.85), (0.95, 0.2), (0, 0.2)], 10); cyl_uv(wl, 5, 0.45); B.add('stone', wl); B.add('dark', lathe([(0.95, 0.35), (0, 0.35)], 10, caps=False))
    for sx in (-1, 1): B.box('timber', 0.16, 0.16, 2.6, sx * 1.1, 0, 1.3)
    B.box('timber', 2.5, 0.12, 0.12, 0, 0, 2.05); B.cyl('wood', 0.13, 0.13, 1.6, 8, -0.8, 0, 2.05, Euler((0, math.pi / 2, 0)))
    q = roof_slab(1.6, 0.95, 2.45, 3.2); merge(B.bm('roof'), q); merge(B.bm('roof'), roof_slab(1.6, 0.95, 2.45, 3.2), Matrix.Rotation(math.pi, 4, 'Z'))
    B.box('iron', 0.02, 0.02, 0.9, 0.2, 0, 1.6); B.add('wood', lathe([(0.16, 0), (0.2, 0.3), (0.0, 0.3)], 8), Matrix.Translation((0.2, 0, 0.9)))
    o = B.build('well'); setp(o, col='circle', r=1.45); return o

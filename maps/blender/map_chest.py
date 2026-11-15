# =====================================================================================
#  Truhlica s pokladom – dva objekty: chest_base + chest_lid (pôvod vrchnáka = pánt, hra ho otvára rotáciou okolo X)
#  Predok truhlice smeruje na -Y (v hre +Z).  Mierka v metroch.
# =====================================================================================
reset_scene()
C = collection('Truhlica')
M_WOODC = material('M_CHEST_WOOD', 'wood', rough=0.75, color=(0.85, 0.62, 0.45))
M_IRON = material('M_CHEST_IRON', 'iron', rough=0.5, metal=0.35, color=(0.75, 0.75, 0.8))
M_GOLD = material('M_CHEST_GOLD', None, color=(1.0, 0.72, 0.25), rough=0.3, metal=0.5, emis_color=(1.0, 0.6, 0.15), emis_strength=0.35, vcol=False)
M_INNER = material('M_CHEST_GLOW', None, color=(1.0, 0.75, 0.3), emis_color=(1.0, 0.62, 0.18), emis_strength=2.5, vcol=False)

W, D, H = 1.30, 0.84, 0.60          # base width (x), depth (y), height (z)
T = 0.06                            # board thickness
R_LID = D / 2                       # rounded lid radius (half cylinder over depth)
BANDS = (-0.42, 0.42)

def boards(bm, x0, x1, y, z0, z1, n, horizontal=True, rz=0.0):
    """a wall made of n separate planks with a little gap and random warp"""
    rs = random.Random(int((x0 + y + z0) * 1000))
    if horizontal:
        h = (z1 - z0) / n
        for i in range(n): add_box(bm, x1 - x0, T, h - 0.012, (x0 + x1) / 2, y + rs.uniform(-0.004, 0.004), z0 + h * (i + 0.5), rz, 0.008)
    else:
        w = (x1 - x0) / n
        for i in range(n): add_box(bm, w - 0.012, T, z1 - z0, x0 + w * (i + 0.5), y + rs.uniform(-0.004, 0.004), (z0 + z1) / 2, rz, 0.008)

# ---------------------------------------------------------------- base
bw = bmesh.new()
boards(bw, -W / 2, W / 2, -D / 2 + T / 2, 0.08, H, 3)                 # front
boards(bw, -W / 2, W / 2, D / 2 - T / 2, 0.08, H, 3)                  # back
for sx in (-1, 1):                                                    # sides (planks along y)
    tmp = bmesh.new(); boards(tmp, -D / 2 + T, D / 2 - T, 0, 0.08, H, 3); merge(bw, tmp, Matrix.Translation((sx * (W / 2 - T / 2), 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z'))
add_box(bw, W - 0.02, D - 0.02, 0.06, 0, 0, 0.11)                     # floor
add_box(bw, W - 2 * T, D - 2 * T, 0.02, 0, 0, H - 0.12)               # inner tray (sits under the glow)
for sx in (-1, 1):                                                    # chunky feet
    for sy in (-1, 1): add_box(bw, 0.16, 0.16, 0.1, sx * (W / 2 - 0.08), sy * (D / 2 - 0.08), 0.05, 0, 0.015)
finalize(bw); box_uv(bw, 0.9); vcolor(bw, ao_moss(moss=0, dark=0.55, h1=0.6))

bi = bmesh.new()                                                       # iron: vertical bands, rim, corners, handles, rivets
for x in BANDS:
    add_box(bi, 0.09, D + 0.025, 0.012, x, 0, 0.075)                  # under
    for sy in (-1, 1): add_box(bi, 0.09, 0.014, H - 0.07, x, sy * (D / 2 + 0.006), (H + 0.07) / 2)
add_box(bi, W + 0.02, D + 0.02, 0.045, 0, 0, H - 0.02)               # top rim
for s in (-1, 1):
    add_box(bi, W + 0.02, 0.016, 0.05, 0, s * (D / 2 + 0.006), 0.13)  # bottom rim front/back
for sx in (-1, 1):
    for sy in (-1, 1):                                                # corner caps (L-brackets)
        add_box(bi, 0.11, 0.016, H - 0.06, sx * (W / 2 - 0.045), sy * (D / 2 + 0.007), (H + 0.06) / 2)
        add_box(bi, 0.016, 0.11, H - 0.06, sx * (W / 2 + 0.007), sy * (D / 2 - 0.045), (H + 0.06) / 2)
for sx in (-1, 1):                                                    # side handles
    t = bmesh.new(); bmesh.ops.create_circle(t, cap_ends=False, segments=12, radius=0.11)
    ring = bmesh.new(); geom = bmesh.ops.create_cone(ring, cap_ends=False, segments=10, radius1=0.012, radius2=0.012, depth=0.001)
    ring.free(); t.free()
    tor = bmesh.new();
    for i in range(10):
        a0, a1 = math.pi * i / 10, math.pi * (i + 1) / 10
        p0 = Vector((0, math.cos(a0) * 0.12, -math.sin(a0) * 0.1)); p1 = Vector((0, math.cos(a1) * 0.12, -math.sin(a1) * 0.1))
        c = (p0 + p1) / 2; L = (p1 - p0).length; d = (p1 - p0).normalized()
        q = d.to_track_quat('Z', 'X'); add_cyl(tor, 0.016, 0.016, L, 6, c.x - d.x * L / 2, c.y - d.y * L / 2, c.z - d.z * L / 2, q)
    merge(bi, tor, Matrix.Translation((sx * (W / 2 + 0.035), 0, H * 0.62)))
    add_box(bi, 0.02, 0.07, 0.07, sx * (W / 2 + 0.012), 0.12, H * 0.62); add_box(bi, 0.02, 0.07, 0.07, sx * (W / 2 + 0.012), -0.12, H * 0.62)
for x in BANDS:                                                       # rivets along the bands
    for z in (0.18, 0.3, 0.42):
        for sy in (-1, 1):
            r = bmesh.new(); bmesh.ops.create_icosphere(r, subdivisions=1, radius=0.016); merge(bi, r, Matrix.Translation((x, sy * (D / 2 + 0.016), z)))
finalize(bi); box_uv(bi, 1.2)

bg = bmesh.new()                                                       # front lock plate (gold) + keyhole
add_box(bg, 0.2, 0.02, 0.22, 0, -D / 2 - 0.012, H - 0.1, 0, 0.01)
r = bmesh.new(); bmesh.ops.create_icosphere(r, subdivisions=1, radius=0.025); merge(bg, r, Matrix.Translation((0, -D / 2 - 0.028, H - 0.07)))
finalize(bg)
bk = bmesh.new(); add_box(bk, 0.03, 0.01, 0.07, 0, -D / 2 - 0.024, H - 0.12); finalize(bk)   # keyhole slot (dark iron)

out = bmesh.new(); merge(out, bw); n0 = len(out.faces); merge(out, bi); n1 = len(out.faces); merge(out, bg); n2 = len(out.faces); merge(out, bk)
base = obj_from_bm('chest_base', out, [M_WOODC, M_IRON, M_GOLD], C)
for i, p in enumerate(base.data.polygons): p.material_index = 0 if i < n0 else 1 if i < n1 else 2 if i < n2 else 1
glow = bmesh.new(); add_box(glow, W - 2 * T - 0.04, D - 2 * T - 0.04, 0.03, 0, 0, H - 0.095); finalize(glow)
coins = bmesh.new()                                                   # heap of gold coins, one mesh (single draw call)
for k in range(26):
    c = bmesh.new(); bmesh.ops.create_cone(c, cap_ends=True, segments=10, radius1=0.045, radius2=0.045, depth=0.012)
    rs = random.Random(k); merge(coins, c, Matrix.Translation((rs.uniform(-0.48, 0.48), rs.uniform(-0.26, 0.26), H - 0.07 + rs.uniform(0, 0.04))) @ Matrix.Rotation(rs.uniform(-0.5, 0.5), 4, 'X'))
finalize(coins)
gl = multi_obj_ = None
out2 = bmesh.new(); merge(out2, glow); n0 = len(out2.faces); merge(out2, coins)
gl = obj_from_bm('chest_gold', out2, [M_INNER, M_GOLD], C)
for i, p in enumerate(gl.data.polygons): p.material_index = 0 if i < n0 else 1
# ---------------------------------------------------------------- lid (origin on the hinge at the back top edge)
lw = bmesh.new()
seg = 7
for i in range(seg):                                                  # curved planks around the (elliptic) half cylinder
    a0, a1 = math.pi * i / seg, math.pi * (i + 1) / seg
    rr_ = R_LID - T / 2
    p0 = Vector((0, math.cos(a0) * rr_, math.sin(a0) * rr_ * 0.62)); p1 = Vector((0, math.cos(a1) * rr_, math.sin(a1) * rr_ * 0.62))
    c = (p0 + p1) / 2; d = p1 - p0; ang = math.atan2(d.z, d.y)
    tmp = bmesh.new(); add_box(tmp, W - 0.02, d.length + 0.01, T, 0, 0, 0, 0, 0.008)
    merge(lw, tmp, Matrix.Translation(c) @ Matrix.Rotation(ang, 4, 'X'))
for sx in (-1, 1):                                                    # end caps (half ellipses)
    cap = bmesh.new(); vs = [cap.verts.new((0, math.cos(math.pi * k / 12) * R_LID, math.sin(math.pi * k / 12) * R_LID * 0.62)) for k in range(13)]
    cap.faces.new(vs); bmesh.ops.solidify(cap, geom=cap.faces[:], thickness=T)
    merge(lw, cap, Matrix.Translation((sx * (W / 2 - T / 2), 0, 0)))
finalize(lw); box_uv(lw, 0.9); vcolor(lw, ao_moss(moss=0, dark=0.7, h0=-0.1, h1=0.3))
li = bmesh.new()
for x in BANDS + (-W / 2 + 0.04, W / 2 - 0.04):                       # bands over the lid
    for k in range(10):
        a0, a1 = math.pi * k / 10, math.pi * (k + 1) / 10
        p0 = Vector((x, math.cos(a0) * (R_LID + 0.006), math.sin(a0) * (R_LID + 0.006) * 0.62)); p1 = Vector((x, math.cos(a1) * (R_LID + 0.006), math.sin(a1) * (R_LID + 0.006) * 0.62))
        c = (p0 + p1) / 2; d = p1 - p0; ang = math.atan2(d.z, d.y)
        tmp = bmesh.new(); add_box(tmp, 0.09 if abs(x) < 0.5 else 0.06, d.length + 0.004, 0.014, 0, 0, 0)
        merge(li, tmp, Matrix.Translation(c) @ Matrix.Rotation(ang, 4, 'X'))
add_box(li, W + 0.02, 0.045, 0.03, 0, -R_LID, 0.0)                     # front lip
add_box(li, 0.16, 0.02, 0.12, 0, -R_LID - 0.02, -0.03)                 # hasp that falls over the lock
for x in BANDS:
    for k in (2, 5, 8):
        a = math.pi * k / 10; r = bmesh.new(); bmesh.ops.create_icosphere(r, subdivisions=1, radius=0.016)
        merge(li, r, Matrix.Translation((x, math.cos(a) * (R_LID + 0.02), math.sin(a) * (R_LID + 0.02) * 0.62)))
finalize(li); box_uv(li, 1.2)
lo = bmesh.new(); merge(lo, lw); n0 = len(lo.faces); merge(lo, li)
lid = obj_from_bm('chest_lid', lo, [M_WOODC, M_IRON], C)
for i, p in enumerate(lid.data.polygons): p.material_index = 0 if i < n0 else 1
# move geometry so that the hinge (back edge, y = +D/2, z = H) is the origin
lid.data.transform(Matrix.Translation((0, -D / 2, 0)))
lid.location = (0, D / 2, H)
result = stats()

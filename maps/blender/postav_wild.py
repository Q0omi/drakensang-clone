# Spustenie v Blenderi: postaví mapu 'wild', uloží .blend a exportuje .glb do A:\drake clone\maps
import os
TEX_DIR = r'A:\drake clone\maps\textures'
# =====================================================================================
#  Kroniky Popola – Blender modelovacia knižnica pre mapy
#  Súradnice v skriptoch sú HERNÉ (x, z = sever záporný, y = výška) – P() ich prevedie
#  do Blenderu (Z-hore). Export do glTF (Y-hore) ich vráti späť na herné osi.
#
#  Značky pre hru (empties, vlastné vlastnosti → glTF extras → userData v three.js):
#    SPAWN            – štart hráča              SHOW   – miesto pre výber postavy
#    PORTAL           – portál do ďalšej mapy    BOSS   – Balgor
#    PACK  types=...  – skupina nepriateľov ("wolf,wolf,archer")
#    TORCH color=0xff8a3a int=26 [steady=1]      – zdroj svetla (pochodeň, kryštál)
#  Kolízie na objektoch:  col="circle" r=1.1   alebo  col="box" (podľa rozmerov objektu)
#  Ďalšie príznaky:       occ=1 (pri zakrytí hrdinu sa zprieľadní), noshadow=1, lava=1, flame=1
# =====================================================================================
import bpy, bmesh, math, random, os
from mathutils import Vector, Matrix, noise, Euler

TAU = math.pi * 2
R = random.Random(1)

def P(x, z, y=0.0):
    return Vector((x, -z, y))

def reset_scene():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves, bpy.data.collections):
        for d in list(coll):
            try: coll.remove(d)
            except Exception: pass

def collection(name, hidden=False):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(c)
    if hidden: c.hide_viewport = True; c.hide_render = True
    return c

# ------------------------------------------------------------------ materials
_img_cache = {}
def image(name):
    if name in _img_cache: return _img_cache[name]
    path = os.path.join(TEX_DIR, name + '.png')
    img = bpy.data.images.load(path, check_existing=True)
    _img_cache[name] = img; return img

def material(name, tex=None, normal=None, color=(1, 1, 1), rough=0.9, metal=0.0, emis=None, emis_color=(1, 1, 1), emis_strength=0.0, alpha=False, vcol=True):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = N.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = rough; bsdf.inputs['Metallic'].default_value = metal
    base = None
    if tex:
        ti = N.new('ShaderNodeTexImage'); ti.image = image(tex); ti.location = (-700, 300); base = ti.outputs['Color']
        if alpha:
            L.new(ti.outputs['Alpha'], bsdf.inputs['Alpha'])
            if hasattr(m, 'surface_render_method'): m.surface_render_method = 'BLENDED'
            elif hasattr(m, 'blend_method'): m.blend_method = 'BLEND'
    if vcol:
        ca = N.new('ShaderNodeVertexColor'); ca.layer_name = 'Col'; ca.location = (-700, 0)
        if base is not None:
            mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1.0; mx.location = (-350, 200)
            L.new(base, mx.inputs[6]); L.new(ca.outputs['Color'], mx.inputs[7]); base = mx.outputs[2]
        else: base = ca.outputs['Color']
    if base is not None:
        if color != (1, 1, 1) and tex:
            mx2 = N.new('ShaderNodeMix'); mx2.data_type = 'RGBA'; mx2.blend_type = 'MULTIPLY'; mx2.inputs['Factor'].default_value = 1.0
            mx2.inputs[7].default_value = (*color, 1); L.new(base, mx2.inputs[6]); base = mx2.outputs[2]
        L.new(base, bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*color, 1)
    if normal:
        tn = N.new('ShaderNodeTexImage'); tn.image = image(normal); tn.image.colorspace_settings.name = 'Non-Color'; tn.location = (-700, -300)
        nm = N.new('ShaderNodeNormalMap'); nm.location = (-350, -300); L.new(tn.outputs['Color'], nm.inputs['Color']); L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emis or emis_strength:
        if emis:
            te = N.new('ShaderNodeTexImage'); te.image = image(emis); te.location = (-700, -600); L.new(te.outputs['Color'], bsdf.inputs['Emission Color'])
        else:
            bsdf.inputs['Emission Color'].default_value = (*emis_color, 1)
        bsdf.inputs['Emission Strength'].default_value = emis_strength or 1.0
    return m

# ------------------------------------------------------------------ mesh helpers
def obj_from_bm(name, bm, mats, coll=None, loc=None, rot=0.0, scale=None, props=None):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    if len(me.color_attributes):
        me.color_attributes.active_color = me.color_attributes[0]
        try: me.color_attributes.render_color_index = 0
        except Exception: pass
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]): me.materials.append(m)
    o = bpy.data.objects.new(name, me); (coll or bpy.context.scene.collection).objects.link(o)
    if loc is not None: o.location = loc
    o.rotation_euler = (0, 0, rot)
    if scale is not None: o.scale = scale if hasattr(scale, '__len__') else (scale, scale, scale)
    for k, v in (props or {}).items(): o[k] = v
    for p in me.polygons: p.use_smooth = False
    return o

def instance(src, name, loc, rot=0.0, scale=1.0, coll=None, props=None):
    """linked duplicate – same mesh data, the game turns these into GPU instances"""
    o = bpy.data.objects.new(name, src.data); (coll or bpy.context.scene.collection).objects.link(o)
    o.location = loc; o.rotation_euler = (0, 0, rot); o.scale = scale if hasattr(scale, '__len__') else (scale, scale, scale)
    for k in src.keys():
        if k not in ('_RNA_UI',): o[k] = src[k]
    for k, v in (props or {}).items(): o[k] = v
    return o

def marker(name, loc, coll=None, **props):
    e = bpy.data.objects.new(name, None); e.empty_display_type = 'SPHERE'; e.empty_display_size = 0.6; e.location = loc
    (coll or bpy.context.scene.collection).objects.link(e)
    e['marker'] = name
    for k, v in props.items(): e[k] = v
    return e

def box_uv(bm, scale=0.25, off=(0, 0)):
    """triplanar-style UVs: each face is projected along its dominant axis (world size → texture repeats)"""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            if ax == 2: u, v = c.x, c.y
            elif ax == 0: u, v = c.y, c.z
            else: u, v = c.x, c.z
            l[uv].uv = (u * scale + off[0], v * scale + off[1])

def cyl_uv(bm, su=1.0, sv=0.25):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        if abs(f.normal.z) > 0.8:
            for l in f.loops: l[uv].uv = (l.vert.co.x * sv, l.vert.co.y * sv)
            continue
        cen = f.calc_center_median(); a0 = math.atan2(cen.y, cen.x)
        for l in f.loops:
            a = math.atan2(l.vert.co.y, l.vert.co.x)
            if a - a0 > math.pi: a -= TAU
            if a0 - a > math.pi: a += TAU
            l[uv].uv = (a / TAU * su, l.vert.co.z * sv)

def vcolor(bm, fn):
    """per-corner colour: fn(vert_co, normal) → (r,g,b)"""
    lay = bm.loops.layers.color.get('Col') or bm.loops.layers.color.new('Col')
    for f in bm.faces:
        for l in f.loops:
            r, g, b = fn(l.vert.co, f.normal); l[lay] = (r, g, b, 1.0)

def ao_moss(top=(0.55, 0.75, 0.35), base=(1, 1, 1), h0=0.0, h1=1.0, dark=0.55, moss=0.6):
    def f(co, n):
        k = min(1, max(0, (co.z - h0) / max(0.01, h1 - h0))); a = dark + (1 - dark) * k
        m = max(0.0, min(1.0, (n.z - 0.45) / 0.4)) * moss * (0.6 + 0.4 * noise.noise(co * 1.7))
        return tuple((base[i] * (1 - m) + top[i] * m) * a for i in range(3))
    return f

def jitter(bm, amt, scale=1.0, seed=0, keep_bottom=None):
    off = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for v in bm.verts:
        if keep_bottom is not None and v.co.z <= keep_bottom + 1e-4: continue
        d = noise.noise_vector(v.co * scale + off); v.co += d * amt

def displace_radial(bm, amt, scale=1.0, seed=0, octaves=3):
    off = Vector((seed * 5.3, seed * 2.1, seed * 9.7))
    for v in bm.verts:
        n = v.co.normalized() if v.co.length > 1e-6 else Vector((0, 0, 1))
        h = noise.fractal(v.co * scale + off, 0.6, 2.0, octaves)
        v.co += n * h * amt

def bevel(bm, offset=0.05, segments=1, edges=None):
    bmesh.ops.bevel(bm, geom=list(edges or bm.edges), offset=offset, segments=segments, affect='EDGES', clamp_overlap=True, profile=0.5)

def bm_box(sx, sy, sz, z0=0.0):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz + sz / 2 + z0))
    return bm

def add_box(bm, sx, sy, sz, cx=0, cy=0, cz=0, rz=0.0, bev=0.0):
    tmp = bmesh.new(); bmesh.ops.create_cube(tmp, size=1.0)
    for v in tmp.verts: v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if bev: bevel(tmp, bev)
    M = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rz, 4, 'Z')
    merge(bm, tmp, M)

def merge(dst, src, M=None):
    me = bpy.data.meshes.new('_tmp'); src.to_mesh(me); src.free()
    if M is not None: me.transform(M)
    dst.from_mesh(me); bpy.data.meshes.remove(me)

def bm_cyl(r1, r2, h, seg=8, z0=0.0, caps=True):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
    for v in bm.verts: v.co.z += h / 2 + z0
    return bm

def add_cyl(bm, r1, r2, h, seg=8, cx=0, cy=0, cz=0, rot=None):
    t = bm_cyl(r1, r2, h, seg)
    M = Matrix.Translation((cx, cy, cz)) @ (rot.to_matrix().to_4x4() if rot is not None else Matrix.Identity(4))
    merge(bm, t, M)

def lathe(profile, seg=16, caps=True):
    """profile: list of (radius, z) from bottom to top"""
    bm = bmesh.new(); rings = []
    for (r, z) in profile:
        ring = [bm.verts.new((math.cos(i / seg * TAU) * r, math.sin(i / seg * TAU) * r, z)) for i in range(seg)]; rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(seg): bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
    if caps and profile[0][0] > 0.001: bm.faces.new(list(reversed(rings[0])))
    if caps and profile[-1][0] > 0.001: bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def finalize(bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); return bm

def export_glb(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_extras=True, export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False, export_vertex_color='ACTIVE', export_texcoords=True, export_normals=True,
                              export_tangents=False, export_image_format='AUTO', export_gpu_instances=False, use_visible=True)

def stats():
    tris = 0; objs = 0; seen = set()
    for o in bpy.data.objects:
        if o.type == 'MESH':
            objs += 1
            if o.data.name in seen: continue
            seen.add(o.data.name); o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
    return {'objects': objs, 'unique_meshes': len(seen), 'unique_tris': tris}

# =====================================================================================
#  Mapa 1 – DIVOČINA (Temný hvozd)
# =====================================================================================
reset_scene()
R = random.Random(2024)
rr = lambda a, b: a + R.random() * (b - a)
C_ASSET = collection('assets (zdroje)', True); C_ENV = collection('Divocina'); C_MARK = collection('znacky (hra)')

M_GRASS = material('M_GRASS', 'grass', rough=1.0)
M_DECAL = material('DECAL_DIRT', 'dirt_decal', alpha=True, rough=1.0, vcol=False)
M_BARK = material('M_BARK', 'bark', 'bark_n', rough=0.95)
M_NEEDLE = material('M_NEEDLES', 'needles', rough=0.9)
M_LEAF = material('M_LEAVES', 'leaves', rough=0.85)
M_ROCK = material('M_ROCK', 'rock', 'rock_n', rough=0.92)
M_WOOD = material('M_WOOD', 'wood', rough=0.8)
M_PLANT = material('M_PLANT', None, rough=0.8)
M_GLOW = material('M_GLOWSHROOM', None, color=(0.6, 1.0, 0.9), emis_color=(0.25, 1.0, 0.85), emis_strength=1.1, vcol=False)
M_RUNE = material('M_RUNE_EMIT', None, color=(0.3, 0.25, 0.6), emis_color=(0.55, 0.45, 1.0), emis_strength=1.5, vcol=False)
M_CLOTH = material('M_TENT', 'banner', rough=0.9)

PATH = [(0, 58), (4, 32), (-6, 12), (3, -8), (-4, -28), (0, -50)]
PACKS = [(8, 28, 'wolf,wolf,wolf'), (-12, 14, 'goblin,goblin,goblin,archer'), (11, -2, 'archer,archer,wolf,wolf'), (-10, -17, 'goblin,goblin,goblin,wolf,wolf'), (8, -31, 'archer,archer,goblin,goblin,wolf,wolf')]
START, PORTAL, SHOW = (0, 46), (0, -47), (0, 49)
BX, BZ0, BZ1 = 36, -53, 52
# ---------------------------------------------------------------- side branches (odbočky): Vlčí brloh (W), Krugov lom (E), Zarastená svätyňa (W, juh)
AREAS = [(-36, 36, -53, 52),                                   # hlavný hvozd (x0, x1, z0, z1) – v hre AREA značky = pochôdzna plocha
         (-48, -30, 17.5, 29.5), (-75, -46, 8, 41),             # brloh: chodba + kotlina
         (30, 48, -18, -6), (46, 77, -31, 7),                   # lom: chodba + jama
         (-48, -30, -42, -30), (-71, -46, -55, -23)]            # svätyňa: chodba + čistina
POCKETS = [AREAS[2], AREAS[4], AREAS[6]]
BRANCHES = [[(-1, 22.5), (-20, 23.5), (-36, 23.5), (-50, 24.5), (-60, 25)],
            [(1.8, -12), (18, -12), (34, -12), (48, -11.5), (58, -12)],
            [(-2.6, -36), (-18, -36.5), (-34, -36), (-48, -38), (-55, -39)]]
DEN, QUARRY, SHRINE = (-62, 25), (62, -12), (-59, -39)
MINIS = [(-63, 26, 'wolfLord', math.pi / 2, 'wolf,wolf'), (63, -12, 'krugKing', -math.pi / 2, 'goblin,goblin'), (-53.5, -36.5, 'scarecrow', math.pi / 2, 'archer,archer')]
CHESTS = [(-70.5, 32, math.pi / 2, 0), (71.5, -23, -math.pi / 2, 0), (-55.2, -39, math.pi / 2, 1), (-67, -27.5, math.pi * 0.75, 0)]
OPT_PACKS = []
REGIONS = [('Vlčí brloh', 'Územie Šedohrivého', AREAS[2]), ('Krugov lom', 'Ríša kamenného kráľa', AREAS[4]), ('Zarastená svätyňa', 'Tu straší Prastarý strach', AREAS[6])]
SIGNS = [(-4.5, 25.5, 'W'), (5.5, -9.5, 'E'), (-6.5, -33.5, 'W')]

def seg_dist(x, z, pts):
    best = 1e9
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        dx, dz = bx - ax, bz - az; t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
        best = min(best, math.hypot(x - ax - dx * t, z - az - dz * t))
    return best
def dist_path(x, z): return min(seg_dist(x, z, PATH), *(seg_dist(x, z, b) for b in BRANCHES))
def dist_out(x, z, grow=0.0):
    best = 1e9
    for (x0, x1, z0, z1) in AREAS:
        ex = max(0, x0 - grow - x, x - x1 - grow); ez = max(0, z0 - grow - z, z - z1 - grow); best = min(best, math.hypot(ex, ez))
    return best
def inside(x, z, m=0): return any(x0 + m < x < x1 - m and z0 + m < z < z1 - m for (x0, x1, z0, z1) in AREAS)
def in_pocket(x, z, m=0): return any(x0 + m < x < x1 - m and z0 + m < z < z1 - m for (x0, x1, z0, z1) in POCKETS)
KEEP_OUT = [(px, pz, 7.5) for px, pz, _ in PACKS] + [(px, pz, 7) for px, pz, _ in OPT_PACKS] + [(m[0], m[1], 8.5) for m in MINIS] + [(c[0], c[1], 3.2) for c in CHESTS] \
    + [(START[0], START[1], 8), (PORTAL[0], PORTAL[1], 10.5), (SHRINE[0], SHRINE[1], 9.5)] + [(s[0], s[1], 1.6) for s in SIGNS]
def clear(x, z, pad=0):
    return dist_path(x, z) > 6 + pad and all(math.hypot(x - kx, z - kz) > r + pad for kx, kz, r in KEEP_OUT)

# ---------------------------------------------------------------- ground (flat arena, hills outside)
def ground_h(x, z):
    e = dist_out(x, z, 1.0)
    hill = min(1, e / 14) ** 1.5 * (5 + 4 * noise.noise(Vector((x * 0.05, z * 0.05, 0.3))))
    return hill + 0.06 * noise.noise(Vector((x * 0.3, z * 0.3, 1.7)))
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=120, y_segments=120, size=120)
for v in bm.verts: gx, gz = v.co.x, -v.co.y; v.co.z = ground_h(gx, gz)
box_uv(bm, 1 / 6)
TREES_FOR_AO = []
ground = obj_from_bm('ground', bm, M_GRASS, C_ENV, props={'ground': 1})

# ---------------------------------------------------------------- tree assets
def pine(seed, h=7.5, tiers=6):
    rs = random.Random(seed); bm = bmesh.new()
    t = bm_cyl(0.32, 0.16, h * 0.55, 9); jitter(t, 0.03, 2, seed); merge(bm, t)
    for k in range(tiers):
        f = k / (tiers - 1); z0 = h * (0.2 + 0.68 * f); rad = (2.5 - 1.9 * f) * rs.uniform(0.9, 1.08); tall = 1.9 - 0.7 * f
        n = 15; cone = bmesh.new(); top = cone.verts.new((0, 0, z0 + tall)); mid, rim = [], []
        for i in range(n * 2):
            a = i / (n * 2) * TAU + rs.random() * 0.1; rk = rad * (1.0 if i % 2 == 0 else 0.72) * rs.uniform(0.92, 1.08)
            rim.append(cone.verts.new((math.cos(a) * rk, math.sin(a) * rk, z0 - (0.35 if i % 2 == 0 else 0.05) * rs.uniform(0.7, 1.3))))
            mid.append(cone.verts.new((math.cos(a) * rk * 0.55, math.sin(a) * rk * 0.55, z0 + tall * 0.42 + rs.uniform(-0.05, 0.08))))
        m = len(rim)
        for i in range(m):
            j = (i + 1) % m
            cone.faces.new((rim[i], rim[j], mid[j], mid[i])); cone.faces.new((mid[i], mid[j], top))
        under = cone.verts.new((0, 0, z0 + 0.25))
        for i in range(m): cone.faces.new((rim[j := (i + 1) % m], rim[i], under))
        merge(bm, cone)
    finalize(bm); box_uv(bm, 0.5)
    vcolor(bm, lambda co, n: (lambda k: (0.45 + 0.6 * k, 0.5 + 0.55 * k, 0.45 + 0.5 * k))(min(1, max(0, co.z / h)) * 0.6 + max(0, n.z) * 0.4))
    o = obj_from_bm(f'pine_{seed}', bm, [M_NEEDLE, M_BARK], C_ASSET)
    # trunk faces → bark material
    for p in o.data.polygons:
        if (p.center.x ** 2 + p.center.y ** 2) < 0.4 ** 2 and p.center.z < h * 0.56: p.material_index = 1
    o['col'] = 'circle'; o['r'] = 0.5; o['occ'] = 1
    return o

def oak(seed, h=5.0):
    rs = random.Random(seed); bm = bmesh.new()
    t = bm_cyl(0.55, 0.3, h * 0.62, 10); jitter(t, 0.06, 1.5, seed); merge(bm, t)
    for k in range(3):
        a = k / 3 * TAU + rs.random(); L = rs.uniform(1.4, 2.2)
        rot = Euler((rs.uniform(0.6, 0.9), 0, a)); add_cyl(bm, 0.2, 0.08, L, 6, 0, 0, h * 0.5, rot)
    nb = len(bm.faces)
    for k in range(6):
        a = rs.random() * TAU; r = 0 if k == 0 else rs.uniform(1.1, 1.9); s = rs.uniform(1.3, 1.9) * (1.25 if k == 0 else 1)
        ico = bmesh.new(); bmesh.ops.create_icosphere(ico, subdivisions=2, radius=s); displace_radial(ico, s * 0.35, 1.2, seed * 10 + k)
        for v in ico.verts: v.co.z *= 0.8
        merge(bm, ico, Matrix.Translation((math.cos(a) * r, math.sin(a) * r, h * 0.78 + rs.uniform(-0.3, 0.8) + (0.6 if k == 0 else 0))))
    finalize(bm); box_uv(bm, 0.45)
    vcolor(bm, lambda co, n: (lambda k: (0.4 + 0.7 * k, 0.45 + 0.65 * k, 0.4 + 0.5 * k))(min(1, max(0, (co.z - h * 0.4) / (h * 0.9))) * 0.55 + max(0, n.z) * 0.45))
    o = obj_from_bm(f'oak_{seed}', bm, [M_LEAF, M_BARK], C_ASSET)
    for i, p in enumerate(o.data.polygons):
        if i < nb: p.material_index = 1
    o['col'] = 'circle'; o['r'] = 0.65; o['occ'] = 1
    return o

def dead_tree(seed, h=5.5):
    rs = random.Random(seed); bm = bm_cyl(0.42, 0.12, h, 8); jitter(bm, 0.08, 1.2, seed)
    for k in range(5):
        a = rs.random() * TAU; z = h * rs.uniform(0.35, 0.85); L = rs.uniform(1.0, 2.0)
        add_cyl(bm, 0.12, 0.03, L, 5, 0, 0, z, Euler((rs.uniform(0.7, 1.2), 0, a)))
    finalize(bm); cyl_uv(bm, 2, 0.4); vcolor(bm, ao_moss(h1=h, dark=0.5, moss=0.3))
    o = obj_from_bm(f'deadtree_{seed}', bm, M_BARK, C_ASSET); o['col'] = 'circle'; o['r'] = 0.45; o['occ'] = 1; return o

def rock(seed, size=1.0, flat=0.6):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    displace_radial(bm, 0.38, 0.9, seed, 4)
    for v in bm.verts:
        v.co.x *= 1.0 + 0.3 * random.Random(seed).random(); v.co.z = max(-0.15, v.co.z * flat)
        if v.co.z < 0: v.co.z *= 0.2
    finalize(bm); box_uv(bm, 0.35, (seed * 0.37, seed * 0.21)); vcolor(bm, ao_moss(top=(0.5, 0.68, 0.3), h0=-0.2, h1=0.8, dark=0.5, moss=0.75))
    o = obj_from_bm(f'rock_{seed}', bm, M_ROCK, C_ASSET); return o

def log(seed, L=4.6):
    bm = bm_cyl(0.5, 0.45, L, 10, -L / 2); jitter(bm, 0.05, 1.5, seed); cyl_uv(bm, 2, 0.4)
    for v in bm.verts: v.co = Vector((v.co.z, v.co.y, v.co.x + 0.42))
    finalize(bm); vcolor(bm, ao_moss(top=(0.45, 0.62, 0.28), h0=0, h1=0.9, dark=0.55, moss=0.8))
    return obj_from_bm(f'log_{seed}', bm, M_BARK, C_ASSET)

def stump(seed):
    bm = bm_cyl(0.6, 0.48, 0.7, 10); jitter(bm, 0.06, 2, seed, keep_bottom=0); cyl_uv(bm, 2, 0.4)
    for k in range(4): add_cyl(bm, 0.18, 0.05, 0.9, 5, 0, 0, 0.05, Euler((1.35, 0, k / 4 * TAU + 0.3)))
    finalize(bm); vcolor(bm, ao_moss(h1=0.7, dark=0.6, moss=0.6))
    o = obj_from_bm(f'stump_{seed}', bm, M_BARK, C_ASSET); o['col'] = 'circle'; o['r'] = 0.65; return o

def tuft(seed, n=14):
    rs = random.Random(seed); bm = bmesh.new()
    for i in range(n):
        a = rs.random() * TAU; r = rs.random() * 0.25; h = rs.uniform(0.35, 0.8); lean = rs.uniform(0.1, 0.5); w = 0.045
        bx, by = math.cos(a) * r, math.sin(a) * r; dx, dy = math.cos(a), math.sin(a); px, py = -dy * w, dx * w
        v0 = bm.verts.new((bx - px, by - py, 0)); v1 = bm.verts.new((bx + px, by + py, 0))
        v2 = bm.verts.new((bx + dx * lean * 0.5 + px * 0.6, by + dy * lean * 0.5 + py * 0.6, h * 0.55)); v3 = bm.verts.new((bx + dx * lean * 0.5 - px * 0.6, by + dy * lean * 0.5 - py * 0.6, h * 0.55))
        v4 = bm.verts.new((bx + dx * lean, by + dy * lean, h)); bm.faces.new((v0, v1, v2, v3)); bm.faces.new((v3, v2, v4))
    g = rs.uniform(0.85, 1.1); vcolor(bm, lambda co, n: (lambda k: (0.12 + 0.3 * k, (0.22 + 0.42 * k) * g, 0.08 + 0.12 * k))(min(1, co.z / 0.7)))
    o = obj_from_bm(f'tuft_{seed}', bm, M_PLANT, C_ASSET); o['noshadow'] = 1; return o

def fern(seed):
    rs = random.Random(seed); bm = bmesh.new()
    for i in range(9):
        a = i / 9 * TAU + rs.random() * 0.3; L = rs.uniform(0.7, 1.1); seg = 6; prev = None
        for s in range(seg + 1):
            t = s / seg; r = L * t; z = 0.55 * math.sin(t * math.pi * 0.85); w = 0.16 * math.sin(math.pi * min(1, t * 1.2 + 0.05))
            c = Vector((math.cos(a) * r, math.sin(a) * r, z)); side = Vector((-math.sin(a), math.cos(a), 0)) * w
            cur = (bm.verts.new(c - side), bm.verts.new(c + side))
            if prev: bm.faces.new((prev[0], prev[1], cur[1], cur[0]))
            prev = cur
    vcolor(bm, lambda co, n: (lambda k: (0.08 + 0.15 * k, 0.25 + 0.35 * k, 0.07 + 0.1 * k))(min(1, co.z / 0.5)))
    o = obj_from_bm(f'fern_{seed}', bm, M_PLANT, C_ASSET); o['noshadow'] = 1; return o

def flowers(seed, col):
    rs = random.Random(seed); bm = bmesh.new()
    for i in range(5):
        x, y = rs.uniform(-0.3, 0.3), rs.uniform(-0.3, 0.3); h = rs.uniform(0.25, 0.45)
        add_cyl(bm, 0.012, 0.01, h, 4, x, y, 0)
        for k in range(5):
            a = k / 5 * TAU; add_box(bm, 0.09, 0.05, 0.015, x + math.cos(a) * 0.05, y + math.sin(a) * 0.05, h, a)
    vcolor(bm, lambda co, n: col if co.z > 0.2 else (0.15, 0.35, 0.1))
    o = obj_from_bm(f'flowers_{seed}', bm, M_PLANT, C_ASSET); o['noshadow'] = 1; return o

def mushrooms(seed):
    rs = random.Random(seed); bm = bmesh.new()
    for i in range(4):
        x, y, s = rs.uniform(-0.35, 0.35), rs.uniform(-0.35, 0.35), rs.uniform(0.6, 1.3)
        merge(bm, lathe([(0.05 * s, 0), (0.04 * s, 0.25 * s), (0.2 * s, 0.25 * s), (0.17 * s, 0.33 * s), (0.08 * s, 0.39 * s), (0.0, 0.41 * s)], 10), Matrix.Translation((x, y, 0)))
    finalize(bm); o = obj_from_bm(f'shrooms_{seed}', bm, M_GLOW, C_ASSET); o['noshadow'] = 1; return o

def standing_stone(seed, h=3.6):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
    for v in bm.verts: v.co = Vector((v.co.x * 1.1, v.co.y * 0.75, (v.co.z + 0.5) * h)); v.co.x *= 1 - 0.25 * (v.co.z / h)
    jitter(bm, 0.09, 0.9, seed, keep_bottom=0); finalize(bm); box_uv(bm, 0.4, (seed * 0.3, 0)); vcolor(bm, ao_moss(top=(0.45, 0.62, 0.3), h1=h, dark=0.55, moss=0.7))
    o = obj_from_bm(f'stone_{seed}', bm, M_ROCK, C_ASSET); o['col'] = 'circle'; o['r'] = 0.8; o['occ'] = 1
    rb = bmesh.new()
    for k in range(4): add_box(rb, 0.07, 0.04, 0.35, (k - 1.5) * 0.18, -0.39, h * 0.45 + (k % 2) * 0.12)
    add_box(rb, 0.55, 0.04, 0.06, 0, -0.39, h * 0.62)
    r = obj_from_bm(f'stone_rune_{seed}', rb, M_RUNE, C_ASSET); r.parent = o; r['noshadow'] = 1
    return o

def campfire():
    bm = bmesh.new()
    for k in range(9):
        a = k / 9 * TAU; s = bmesh.new(); bmesh.ops.create_icosphere(s, subdivisions=1, radius=0.28); jitter(s, 0.06, 2, k)
        merge(bm, s, Matrix.Translation((math.cos(a) * 1.0, math.sin(a) * 1.0, 0.12)))
    finalize(bm); box_uv(bm, 0.5); vcolor(bm, ao_moss(dark=0.4, moss=0.2, h1=0.4))
    stones = obj_from_bm('campfire_stones', bm, M_ROCK, C_ASSET)
    lb = bmesh.new()
    for k in range(5): add_cyl(lb, 0.1, 0.08, 1.3, 6, 0, 0, 0.05, Euler((1.15, 0, k / 5 * TAU)))
    finalize(lb); cyl_uv(lb, 1, 0.5); logs = obj_from_bm('campfire_logs', lb, M_BARK, C_ASSET); logs.parent = stones
    stones['col'] = 'circle'; stones['r'] = 1.1
    return stones

def tent(seed):
    bm = bmesh.new(); n = 7; top = bm.verts.new((0, 0, 2.6)); ring = []
    for i in range(n):
        a = i / n * TAU; r = 1.7 + 0.1 * math.sin(i * 2.3); ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, 0.0)))
    for i in range(n - 1): bm.faces.new((ring[i], ring[i + 1], top))
    for k in range(3): add_cyl(bm, 0.05, 0.04, 3.1, 5, 0, 0, 0, Euler((0.2, 0, k / 3 * TAU)))
    finalize(bm); uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops: l[uv].uv = (0.5 + l.vert.co.x * 0.22, 0.1 + l.vert.co.z * 0.32)
    vcolor(bm, lambda co, n: (0.55 + 0.15 * co.z, 0.45 + 0.12 * co.z, 0.32 + 0.1 * co.z))
    o = obj_from_bm(f'tent_{seed}', bm, M_CLOTH, C_ASSET); o['col'] = 'circle'; o['r'] = 1.6; o['occ'] = 1; return o

def dolmen_gate():
    bm = bmesh.new()
    for s in (-1, 1):
        st = bmesh.new(); bmesh.ops.create_cube(st, size=1.0); bmesh.ops.subdivide_edges(st, edges=st.edges[:], cuts=3, use_grid_fill=True)
        for v in st.verts: v.co = Vector((v.co.x * 1.3, v.co.y * 1.1, (v.co.z + 0.5) * 6.4))
        jitter(st, 0.08, 0.8, 3 + s, keep_bottom=0); merge(bm, st, Matrix.Translation((s * 3.35, 0, 0)) @ Matrix.Rotation(-s * 0.03, 4, 'Y'))
    cap = bmesh.new(); bmesh.ops.create_cube(cap, size=1.0); bmesh.ops.subdivide_edges(cap, edges=cap.edges[:], cuts=4, use_grid_fill=True)
    for v in cap.verts: v.co = Vector((v.co.x * 9.4, v.co.y * 1.5, v.co.z * 1.1)); v.co.z += 0.18 * (1 - (v.co.x / 4.7) ** 2)
    jitter(cap, 0.1, 0.7, 9); merge(bm, cap, Matrix.Translation((0, 0, 6.85)))
    finalize(bm); box_uv(bm, 0.3); vcolor(bm, ao_moss(top=(0.45, 0.6, 0.3), h1=7.5, dark=0.55, moss=0.7))
    o = obj_from_bm('portal_gate', bm, M_ROCK, C_ASSET); o['occ'] = 1
    rb = bmesh.new()
    for s in (-1, 1):
        for k in range(5): add_box(rb, 0.5, 0.06, 0.08, s * 3.35, -0.6, 1.2 + k * 0.95)
    add_box(rb, 6.0, 0.06, 0.12, 0, -0.78, 6.85)
    r = obj_from_bm('portal_gate_runes', rb, M_RUNE, C_ASSET); r.parent = o; r['noshadow'] = 1
    return o

def ruin_wall(seed, L=6.0, h=2.4):
    rs = random.Random(seed); bm = bmesh.new()
    rows, bl = 5, 0.95
    for j in range(rows):
        x = -L / 2 + (bl / 2 if j % 2 else 0)
        while x < L / 2:
            w = rs.uniform(0.7, 1.15); top = h * (1 - 0.75 * max(0, (x + L / 2) / L - 0.35)) + rs.uniform(-0.3, 0.2)
            if (j + 0.5) * (h / rows) < top: add_box(bm, w * 0.96, 0.7, h / rows * 0.94, x + w / 2, rs.uniform(-0.04, 0.04), (j + 0.5) * h / rows, rs.uniform(-0.04, 0.04), 0.04)
            x += w
    finalize(bm); box_uv(bm, 0.45); vcolor(bm, ao_moss(top=(0.45, 0.6, 0.3), h1=h, dark=0.5, moss=0.7))
    o = obj_from_bm(f'ruinwall_{seed}', bm, M_ROCK, C_ASSET); o['col'] = 'box'; o['occ'] = 1; return o

PINES = [pine(i) for i in range(3)]; OAKS = [oak(10 + i) for i in range(3)]; DEAD = dead_tree(20)
ROCKS = [rock(30 + i) for i in range(5)]; LOG = log(40); STUMP = stump(41)
TUFTS = [tuft(50 + i) for i in range(4)]; FERNS = [fern(60 + i) for i in range(2)]
FLOWERS = [flowers(70 + i, c) for i, c in enumerate([(0.75, 0.45, 1.0), (1.0, 0.85, 0.35), (1.0, 0.55, 0.65)])]
SHROOMS = mushrooms(80); STONE = standing_stone(90); STONE2 = standing_stone(91, 2.8); FIRE = campfire(); TENT = tent(95); GATE = dolmen_gate(); RUIN = ruin_wall(97)

# ---------------------------------------------------------------- path decals
for (ax, az), (bx, bz) in zip(PATH, PATH[1:]):
    n = int(math.hypot(bx - ax, bz - az) / 2.4) + 1
    for k in range(n):
        t = k / n; x, z = ax + (bx - ax) * t + rr(-0.8, 0.8), az + (bz - az) * t + rr(-0.8, 0.8)
        bmq = bmesh.new(); bmesh.ops.create_grid(bmq, x_segments=1, y_segments=1, size=0.5); box_uv(bmq, 1.0, (0.5, 0.5))
        s = rr(5.5, 8); o = obj_from_bm(f'path_{len(C_ENV.objects)}', bmq, M_DECAL, C_ENV, P(x, z, 0.03 + (k % 4) * 0.004), rr(0, TAU), (s, s * rr(0.8, 1.2), 1), {'noshadow': 1, 'decal': 1})
for px, pz, _ in PACKS + OPT_PACKS:
    bmq = bmesh.new(); bmesh.ops.create_grid(bmq, x_segments=1, y_segments=1, size=0.5); box_uv(bmq, 1.0, (0.5, 0.5))
    obj_from_bm('clearing', bmq, M_DECAL, C_ENV, P(px, pz, 0.025), rr(0, TAU), (12, 12, 1), {'noshadow': 1, 'decal': 1})
def decal(x, z, s, y=0.03):
    bmq = bmesh.new(); bmesh.ops.create_grid(bmq, x_segments=1, y_segments=1, size=0.5); box_uv(bmq, 1.0, (0.5, 0.5))
    return obj_from_bm(f'path_{len(C_ENV.objects)}', bmq, M_DECAL, C_ENV, P(x, z, y), rr(0, TAU), (s, s * rr(0.8, 1.2), 1), {'noshadow': 1, 'decal': 1})
for br in BRANCHES:
    for (ax, az), (bx, bz) in zip(br, br[1:]):
        n = int(math.hypot(bx - ax, bz - az) / 2.6) + 1
        for k in range(n):
            t = k / n; decal(ax + (bx - ax) * t + rr(-0.6, 0.6), az + (bz - az) * t + rr(-0.6, 0.6), rr(4.6, 6.4), 0.031 + (k % 4) * 0.004)
for (cx, cz, n, s0) in [(DEN[0], DEN[1], 5, 13), (QUARRY[0], QUARRY[1], 11, 12), (SHRINE[0], SHRINE[1], 3, 12)]:
    for k in range(n):
        a, r = rr(0, TAU), (0 if k == 0 else rr(4, 11)); decal(cx + math.cos(a) * r, cz + math.sin(a) * r, s0 * rr(0.8, 1.2), 0.026 + (k % 5) * 0.003)

# ---------------------------------------------------------------- scatter
placed = []
def free_spot(x, z, d): return all(math.hypot(x - a, z - b) > d for a, b in placed)
def place_tree(x, z, inner):
    kind = R.random(); s = rr(0.75, 1.15) if inner else rr(0.95, 1.5)
    src = R.choice(PINES) if kind < 0.55 else R.choice(OAKS) if kind < 0.93 else DEAD
    y = ground_h(x, z) - 0.1
    o = instance(src, src.name.split('_')[0], P(x, z, y), rr(0, TAU), s, C_ENV)
    o['r'] = src['r'] * s
    if not inner: o['col'] = 'none'
    placed.append((x, z)); TREES_FOR_AO.append((x, z, s))

# ---------------------------------------------------------------- odbočky: rekvizity (kosti, kryštály, lešenie, vozík, lampáše, oltár, obelisk, rázcestníky)
M_BONE = material('M_BONE', 'bone', rough=0.8)
M_AMBER = material('M_AMBER_CRYSTAL', None, color=(1.0, 0.62, 0.25), emis_color=(1.0, 0.5, 0.12), emis_strength=1.8, vcol=False)
M_DARK = material('M_CAVE_DARK', None, color=(0.02, 0.015, 0.012), rough=1.0, vcol=False)
M_IRONW = material('M_IRON_W', 'iron', rough=0.55, metal=0.3, color=(0.7, 0.7, 0.75))
def multi_obj(name, parts, coll=C_ASSET):
    out = bmesh.new(); idx = []
    for bm, m in parts: n0 = len(out.faces); merge(out, bm); idx.append((n0, len(out.faces), m))
    o = obj_from_bm(name, out, [m for _, _, m in idx], coll)
    for i, p in enumerate(o.data.polygons):
        for k, (a, b, _) in enumerate(idx):
            if a <= i < b: p.material_index = k
    return o
def bone_pile(seed):
    rs = random.Random(seed); bm = bmesh.new(); dk = bmesh.new()
    for k in range(9):
        L = rs.uniform(0.45, 0.95); b = bm_cyl(0.04, 0.034, L, 6, -L / 2)
        for s_ in (-1, 1):
            for o_ in (-1, 1): kn = bmesh.new(); bmesh.ops.create_icosphere(kn, subdivisions=1, radius=0.062); merge(b, kn, Matrix.Translation((o_ * 0.034, 0, s_ * L / 2)))
        merge(bm, b, Matrix.Translation((rs.uniform(-0.9, 0.9), rs.uniform(-0.9, 0.9), 0.06)) @ Matrix.Rotation(rs.uniform(0, TAU), 4, 'Z') @ Matrix.Rotation(math.pi / 2 + rs.uniform(-0.25, 0.25), 4, 'X'))
    for k in range(rs.randint(1, 2)):
        Ms = Matrix.Translation((rs.uniform(-0.5, 0.5), rs.uniform(-0.5, 0.5), 0.15)) @ Matrix.Rotation(rs.uniform(0, TAU), 4, 'Z') @ Matrix.Rotation(rs.uniform(-0.3, 0.3), 4, 'X')
        sk = bmesh.new(); bmesh.ops.create_icosphere(sk, subdivisions=2, radius=0.19)
        for v in sk.verts:
            v.co.y *= 1.3; v.co.z *= 0.85
            if v.co.y < -0.1 and v.co.z < 0.02: v.co.z = v.co.z * 0.55 - 0.02; v.co.x *= 0.8
        merge(bm, sk, Ms)
        for ex in (-0.075, 0.075): e = bmesh.new(); bmesh.ops.create_icosphere(e, subdivisions=1, radius=0.055); merge(dk, e, Ms @ Matrix.Translation((ex, -0.2, 0.05)))
        nz = bmesh.new(); bmesh.ops.create_icosphere(nz, subdivisions=1, radius=0.03); merge(dk, nz, Ms @ Matrix.Translation((0, -0.24, -0.04)))
    finalize(bm); box_uv(bm, 0.5); vcolor(bm, ao_moss(moss=0, dark=0.55, h1=0.3)); finalize(dk)
    o = multi_obj(f'bones_{seed}', [(bm, M_BONE), (dk, M_DARK)]); o['noshadow'] = 1; return o
def crystals(seed):
    rs = random.Random(seed); bm = bmesh.new()
    for k in range(rs.randint(5, 8)):
        h = rs.uniform(0.8, 2.4) * (1.4 if k == 0 else 1); r = h * rs.uniform(0.12, 0.17)
        merge(bm, lathe([(r * 0.75, -0.15), (r, h * 0.72), (0.0, h)], 6), Matrix.Translation((rs.uniform(-0.55, 0.55), rs.uniform(-0.55, 0.55), 0)) @ Matrix.Rotation(rs.uniform(0, TAU), 4, 'Z') @ Matrix.Rotation(rs.uniform(-0.6, 0.6), 4, 'X'))
    finalize(bm); o = obj_from_bm(f'crystals_{seed}', bm, M_AMBER, C_ASSET); o['col'] = 'circle'; o['r'] = 0.8; return o
def scaffold():
    bm = bmesh.new(); Hs = 3.6
    for sx in (-1, 1):
        for sy in (-1, 1): add_box(bm, 0.2, 0.2, Hs, sx * 1.6, sy * 1.1, Hs / 2, 0, 0.02)
    for z in (1.2, 2.45):
        for sy in (-1, 1): add_box(bm, 3.5, 0.14, 0.16, 0, sy * 1.1, z, 0, 0.01)
        for sx in (-1, 1): add_box(bm, 0.14, 2.5, 0.16, sx * 1.6, 0, z, 0, 0.01)
    for k in range(8): add_box(bm, 0.4, 2.55, 0.06, -1.4 + k * 0.4, 0, 2.56, 0, 0.01)
    for sy in (-1, 1): b = bmesh.new(); add_box(b, 0.1, 0.1, 2.7); merge(bm, b, Matrix.Translation((0, sy * 1.13, 1.3)) @ Matrix.Rotation(0.95, 4, 'Y'))
    for sx in (-0.28, 0.28): add_box(bm, 0.08, 0.08, 3.1, 2.05, sx, 1.45)
    for k in range(8): add_box(bm, 0.06, 0.6, 0.05, 2.05, 0, 0.3 + k * 0.36)
    for k in range(3): add_box(bm, 0.5, 0.5, 0.4, -0.9 + k * 0.6, rr(-0.5, 0.5), 2.8, rr(0, 1), 0.02)          # crates on the deck
    finalize(bm); box_uv(bm, 0.8); vcolor(bm, ao_moss(moss=0.1, dark=0.55, h1=3))
    o = obj_from_bm('scaffold', bm, M_WOOD, C_ASSET); o['col'] = 'box'; o['occ'] = 1; return o
def mine_cart():
    bw = bmesh.new(); bi = bmesh.new()
    add_box(bw, 1.5, 1.0, 0.08, 0, 0, 0.45)
    for sy in (-1, 1): add_box(bw, 1.62, 0.07, 0.6, 0, sy * 0.54, 0.76, 0, 0.01)
    for sx in (-1, 1): add_box(bw, 0.07, 1.12, 0.6, sx * 0.79, 0, 0.76, 0, 0.01)
    for k in range(6): o_ = bmesh.new(); bmesh.ops.create_icosphere(o_, subdivisions=1, radius=rr(0.18, 0.3)); jitter(o_, 0.04, 2, k); merge(bw, o_, Matrix.Translation((rr(-0.5, 0.5), rr(-0.3, 0.3), 0.95)))
    for sy in (-1, 1): add_box(bi, 1.7, 0.09, 0.08, 0, sy * 0.58, 1.06); add_box(bi, 1.7, 0.09, 0.08, 0, sy * 0.58, 0.5)
    for sx in (-1, 1): add_box(bi, 0.09, 1.2, 0.08, sx * 0.83, 0, 1.06)
    for sx in (-1, 1):
        for sy in (-1, 1): add_cyl(bi, 0.24, 0.24, 0.1, 12, sx * 0.5, sy * 0.6 - sy * 0.05, 0.24, Euler((math.pi / 2, 0, 0)))
    finalize(bw); box_uv(bw, 0.8); vcolor(bw, ao_moss(moss=0, dark=0.6, h1=1)); finalize(bi); box_uv(bi, 1.0)
    o = multi_obj('minecart', [(bw, M_WOOD), (bi, M_IRONW)]); o['col'] = 'circle'; o['r'] = 1.0; return o
def rails(L=14):
    bw = bmesh.new(); bi = bmesh.new()
    for sy in (-1, 1): add_box(bi, L, 0.07, 0.09, 0, sy * 0.6, 0.12)
    k = 0
    while k * 0.8 < L: add_box(bw, 0.24, 1.7, 0.08, -L / 2 + 0.4 + k * 0.8, rr(-0.04, 0.04), 0.04, rr(-0.06, 0.06), 0.01); k += 1
    finalize(bw); box_uv(bw, 0.8); vcolor(bw, ao_moss(moss=0.3, dark=0.6, h1=0.2)); finalize(bi); box_uv(bi, 1.0)
    o = multi_obj('rails', [(bw, M_WOOD), (bi, M_IRONW)]); o['noshadow'] = 1; return o
def lantern_post():
    bw = bmesh.new(); bi = bmesh.new()
    add_box(bw, 0.16, 0.16, 2.8, 0, 0, 1.4, 0, 0.02); add_box(bw, 0.75, 0.1, 0.1, 0.32, 0, 2.62, 0, 0.01)
    for sx in (-1, 1):
        for sy in (-1, 1): add_box(bi, 0.03, 0.03, 0.36, 0.62 + sx * 0.13, sy * 0.13, 2.22)
    add_box(bi, 0.34, 0.34, 0.04, 0.62, 0, 2.42); add_box(bi, 0.3, 0.3, 0.04, 0.62, 0, 2.03); add_cyl(bi, 0.2, 0.0, 0.16, 4, 0.62, 0, 2.44)
    finalize(bw); box_uv(bw, 0.8); vcolor(bw, ao_moss(moss=0.2, dark=0.6, h1=2.8)); finalize(bi)
    o = multi_obj('lanternpost', [(bw, M_WOOD), (bi, M_IRONW)]); o['col'] = 'circle'; o['r'] = 0.3; return o
def signpost():
    bm = bmesh.new(); add_box(bm, 0.16, 0.16, 2.5, 0, 0, 1.25, 0, 0.02)
    for (z, rz, L) in [(2.05, 0.0, 1.3), (1.6, 0.25, 1.0)]:
        pl = bmesh.new(); add_box(pl, L, 0.05, 0.26, L / 2 - 0.05, 0, 0, 0, 0.01)
        t = bmesh.new(); vs = [t.verts.new(v) for v in [(L - 0.05, -0.025, -0.2), (L + 0.22, -0.025, 0), (L - 0.05, -0.025, 0.2)]]; t.faces.new(vs); bmesh.ops.solidify(t, geom=t.faces[:], thickness=0.05); merge(pl, t)
        merge(bm, pl, Matrix.Translation((0, 0.1, z)) @ Matrix.Rotation(rz, 4, 'Z'))
    finalize(bm); box_uv(bm, 0.8); vcolor(bm, ao_moss(moss=0.4, dark=0.6, h1=2.5))
    o = obj_from_bm('signpost', bm, M_WOOD, C_ASSET); o['col'] = 'circle'; o['r'] = 0.3; return o
def altar():
    bm = bmesh.new(); br = bmesh.new()
    add_box(bm, 3.8, 3.8, 0.3, 0, 0, 0.15, 0, 0.05); add_box(bm, 2.9, 2.9, 0.3, 0, 0, 0.45, 0, 0.05); add_box(bm, 1.9, 1.25, 0.95, 0, 0, 1.07, 0, 0.06)
    add_box(bm, 2.1, 1.45, 0.14, 0, 0, 1.6, 0, 0.04)
    for sx in (-1, 1):
        for sy in (-1, 1): add_box(bm, 0.36, 0.36, 1.5, sx * 1.6, sy * 1.6, 1.05, 0, 0.04); add_box(bm, 0.5, 0.5, 0.16, sx * 1.6, sy * 1.6, 1.86, 0, 0.03)
    jitter(bm, 0.025, 1.5, 7, keep_bottom=0.05); finalize(bm); box_uv(bm, 0.45); vcolor(bm, ao_moss(top=(0.45, 0.6, 0.3), h1=2, dark=0.5, moss=0.75))
    add_box(br, 1.4, 0.04, 0.12, 0, -0.64, 1.2); add_box(br, 1.0, 0.04, 0.08, 0, -0.64, 0.92); add_box(br, 1.2, 0.8, 0.02, 0, 0, 1.68)
    for sx in (-1, 1):
        for sy in (-1, 1): add_box(br, 0.06, 0.02, 0.8, sx * 1.6, sy * 1.6 - sy * 0.19, 1.1)
    finalize(br)
    o = multi_obj('altar', [(bm, M_ROCK), (br, M_RUNE)]); o['col'] = 'circle'; o['r'] = 2.0; o['occ'] = 1; return o
def obelisk():
    bm = lathe([(0.95, 0), (0.95, 0.35), (0.7, 0.4), (0.55, 5.6), (0.0, 6.5)], 4); jitter(bm, 0.03, 1, 3, keep_bottom=0.05)
    finalize(bm); box_uv(bm, 0.4); vcolor(bm, ao_moss(top=(0.45, 0.6, 0.3), h1=6.5, dark=0.55, moss=0.7))
    br = bmesh.new()
    for k in range(7): add_box(br, 0.3, 0.03, 0.1, 0, -0.62 + k * 0.012, 1.2 + k * 0.6)
    finalize(br); o = multi_obj('obelisk', [(bm, M_ROCK), (br, M_RUNE)]); o['col'] = 'circle'; o['r'] = 0.9; o['occ'] = 1
    o.rotation_euler = (0, 0, math.pi / 4); return o
BONES = [bone_pile(110 + i) for i in range(3)]; CRYST = [crystals(120 + i) for i in range(3)]; SCAF = scaffold(); CART = mine_cart(); RAILS = rails(); LPOST = lantern_post(); SIGN = signpost(); ALTAR = altar(); OBEL = obelisk()
def put_set(src, x, z, rot=0.0, s=1.0, keep=1.5, y=None):
    o = instance(src, src.name.split('_')[0], P(x, z, ground_h(x, z) - 0.05 if y is None else y), rot, s, C_ENV)
    if keep: KEEP_OUT.append((x, z, keep))
    return o
def cliff_ring(rect, gap, step=3.8, sc=(2.0, 3.6), hmul=1.7):
    x0, x1, z0, z1 = rect; pts = []
    x = x0
    while x <= x1: pts += [(x, z0 - 2.6), (x, z1 + 2.6)]; x += step
    z = z0
    while z <= z1: pts += [(x0 - 2.6, z), (x1 + 2.6, z)]; z += step
    for (x, z) in pts:
        if gap(x, z): continue
        src = R.choice(ROCKS); k = rr(*sc); instance(src, 'cliff', P(x + rr(-1.2, 1.2), z + rr(-1.2, 1.2), ground_h(x, z) - 0.5), rr(0, TAU), (k * rr(1, 1.5), k, k * hmul * rr(0.75, 1.3)), C_ENV, {'col': 'none'})
# signposts at the three junctions (arrow towards the branch)
for (x, z, d) in SIGNS: put_set(SIGN, x, z, math.pi if d == 'W' else 0.0, 1.0, 1.2)
# -- Vlčí brloh (west): rock cliffs, cave mouth, bones, dead trees
den = AREAS[2]
cliff_ring(den, lambda x, z: x > den[1] - 1 and 14 < z < 33)
for (x, z, s3) in [(-77.5, 20.5, (2.8, 2.6, 4.8)), (-77.5, 29.5, (2.8, 2.6, 4.6)), (-78.2, 25.0, (6.5, 2.6, 1.8))]:
    instance(ROCKS[1], 'cavearch', P(x, z, 0 if s3[2] > 2 else 5.4), rr(0, TAU) if s3[2] > 2 else math.pi / 2, s3, C_ENV, {'col': 'none'})
cv = bmesh.new(); add_box(cv, 1.0, 9.0, 6.5, 0, 0, 3.0); obj_from_bm('cave_dark', cv, M_DARK, C_ENV, P(-80.5, 25.0, 0), 0, None, {'noshadow': 1})
for k, (x, z) in enumerate([(-55, 33), (-68, 15), (-70, 36), (-57, 13), (-66, 20.5), (-51, 31)]): put_set(BONES[k % 3], x, z, rr(0, TAU), rr(0.9, 1.3), 1.2)
for (x, z) in [(-52, 37), (-71, 12), (-73, 35)]: o = put_set(DEAD, x, z, rr(0, TAU), rr(1.0, 1.3), 2.5); o['col'] = 'circle'; o['r'] = 0.6
for (x, z) in [(-58, 37.5), (-69.5, 22), (-61, 11)]: put_set(SHROOMS, x, z, rr(0, TAU), rr(1, 1.4), 0)
marker('TORCH', P(-76.5, 25, 1.4), C_MARK, color=0xff5a28, int=30, steady=1)
# -- Krugov lom (east): quarry cliffs, amber crystals, scaffolds, mine cart on rails, lantern posts, rubble
qu = AREAS[4]
cliff_ring(qu, lambda x, z: x < qu[0] + 1 and -21 < z < -3, step=3.4, sc=(2.4, 4.2), hmul=2.0)
for k, (x, z, s1) in enumerate([(74, -3, 1.4), (75, -27, 1.6), (50, -28.5, 1.2), (58, 4.5, 1.3), (69, 4, 1.1), (75.5, -14, 1.5), (52, 4, 1.0)]):
    put_set(CRYST[k % 3], x, z, rr(0, TAU), s1, 1.6)
    if k % 2 == 0: marker('TORCH', P(x, z, 1.4), C_MARK, color=0xff9a30, int=26, steady=1)
put_set(SCAF, 66, 3.6, 0.0, 1.0, 3.2); put_set(SCAF, 74.4, -8, math.pi / 2, 1.0, 3.2)
put_set(RAILS, 58, -26.5, 0.15, 1.0, 0); put_set(CART, 60.5, -26.1, 0.15, 1.0, 1.6)
for (x, z, r) in [(50.5, -19.5, 0.0), (50.5, -4.5, 0.0), (67, -18, math.pi), (56, -2, math.pi / 2)]:
    put_set(LPOST, x, z, r, 1.0, 1.0); marker('TORCH', P(x + math.cos(r) * 0.62, z - math.sin(r) * 0.62, 2.22), C_MARK, color=0xffb060, int=32, flame=0.5)
for i in range(26):
    x, z = rr(qu[0] + 1, qu[1] - 1), rr(qu[2] + 1, qu[3] - 1)
    if not clear(x, z, -4): continue
    k = rr(0.25, 0.55); instance(R.choice(ROCKS), 'rubble', P(x, z, -0.05), rr(0, TAU), (k * rr(1, 1.5), k, k * 0.8), C_ENV, {'col': 'none'})
# -- Zarastená svätyňa (south-west): altar, stone circle, obelisk, ruined walls
put_set(ALTAR, SHRINE[0], SHRINE[1], math.pi / 2, 1.0, 0)
for i in range(9):
    a = i / 9 * TAU + 0.2; x, z = SHRINE[0] + math.cos(a) * 7.2, SHRINE[1] + math.sin(a) * 7.2
    if abs(a % TAU) < 0.45 or abs(a % TAU - TAU) < 0.45: continue                 # keep the east side open
    src = STONE if i % 2 else STONE2; o = put_set(src, x, z, -a + math.pi / 2, rr(0.85, 1.05), 0)
    for c in src.children: instance(c, c.name, P(x, z, 0), -a + math.pi / 2, o.scale[0], C_ENV)
put_set(OBEL, SHRINE[0] - 10, SHRINE[1], math.pi / 4, 1.0, 1.8)
for (x, z, a) in [(-65, -50, 0.3), (-50.5, -49, -0.4), (-68.5, -32, 1.4)]:
    rx, rz = x, z; instance(RUIN, 'ruinwall', P(rx, rz, 0), a, 1, C_ENV)
    for c in RUIN.children: instance(c, c.name, P(rx, rz, 0), a, 1, C_ENV)
    KEEP_OUT.append((x, z, 4))
for (x, z) in [(-62, -31), (-53, -45), (-66, -44), (-56.5, -33.5)]: put_set(SHROOMS, x, z, rr(0, TAU), rr(1.1, 1.5), 0)
marker('TORCH', P(SHRINE[0], SHRINE[1], 2.4), C_MARK, color=0x8a6bff, int=34, steady=1)
def scare_post(seed):
    rs = random.Random(seed); bm = bmesh.new(); bc = bmesh.new()
    add_box(bm, 0.14, 0.14, 2.9, 0, 0, 1.45, 0, 0.02); add_box(bm, 1.7, 0.12, 0.12, 0, 0, 2.2, 0, 0.01)
    add_cyl(bc, 0.34, 0.24, 0.9, 7, 0, 0, 1.55); add_cyl(bc, 0.42, 0.0, 0.5, 7, 0, 0, 2.75)          # straw body + hat
    for sx in (-1, 1): add_cyl(bc, 0.12, 0.05, 0.45, 5, sx * 0.85, 0, 2.2, Euler((0, sx * 1.4, 0)))   # straw tufts
    h = bmesh.new(); bmesh.ops.create_icosphere(h, subdivisions=1, radius=0.22); merge(bc, h, Matrix.Translation((0, 0, 2.55)))
    finalize(bm); box_uv(bm, 0.8); vcolor(bm, ao_moss(moss=0.3, dark=0.6, h1=3)); finalize(bc); box_uv(bc, 0.6); vcolor(bc, lambda co, n: (0.85, 0.7, 0.4))
    o = multi_obj(f'scarepost_{seed}', [(bm, M_WOOD), (bc, M_CLOTH)]); o['col'] = 'circle'; o['r'] = 0.3; return o
SCARE = scare_post(130)
for (x, z) in [(-49.5, -33), (-49, -45), (-63.5, -50), (-68, -36)]: put_set(SCARE, x, z, rr(0, TAU), rr(0.95, 1.1), 1.0)
for (x, z) in [(-52, -51), (-69, -45.5), (-64, -25.5)]: o = put_set(DEAD, x, z, rr(0, TAU), rr(1.0, 1.3), 2.5); o['col'] = 'circle'; o['r'] = 0.6
for i in range(2500):
    x, z = rr(-34, 34), rr(-51, 50)
    if len([1 for p in placed]) > 115: break
    if clear(x, z) and free_spot(x, z, 4.3): place_tree(x, z, True)
for (x0, x1, z0, z1), cap in zip(POCKETS, (3, 0, 5)):
    for i in range(400 if cap else 0):
        x, z = rr(x0 + 2, x1 - 2), rr(z0 + 2, z1 - 2)
        if clear(x, z, 1) and free_spot(x, z, 5.5): place_tree(x, z, True)
        if sum(1 for (a, b) in placed if x0 < a < x1 and z0 < b < z1) >= cap: break
for i in range(9000):
    x, z = rr(-100, 100), rr(-78, 76)
    if inside(x, z, -1.5): continue
    do = dist_out(x, z)
    if do > 20: continue
    if math.hypot(x, z - 62) < 9: continue
    if free_spot(x, z, 3.6 if do < 9 else 4.6): place_tree(x, z, False)
for i in range(1200):
    if i % 3 == 2: x0, x1, z0, z1 = R.choice(POCKETS); x, z = rr(x0 + 1.5, x1 - 1.5), rr(z0 + 1.5, z1 - 1.5)
    else: x, z = rr(-34, 34), rr(-51, 50)
    if not clear(x, z, -2.5) or not free_spot(x, z, 2.5): continue
    src = R.choice(ROCKS); s = rr(0.45, 1.6); o = instance(src, 'rock', P(x, z, -0.05), rr(0, TAU), (s * rr(1, 1.4), s, s * rr(0.7, 1.0)), C_ENV)
    if s > 0.85: o['col'] = 'circle'; o['r'] = s * 1.05; o['occ'] = 1 if s > 1.3 else 0
    placed.append((x, z))
    if sum(1 for o in C_ENV.objects if o.name.startswith('rock')) > 80: break
for i in range(420):  # rocks outside for silhouette
    x, z = rr(-95, 95), rr(-72, 72)
    if inside(x, z, -1) or dist_out(x, z) > 20: continue
    src = R.choice(ROCKS); s = rr(1.2, 3.2); instance(src, 'rock_out', P(x, z, ground_h(x, z) - 0.3), rr(0, TAU), (s * rr(1, 1.5), s, s * rr(0.6, 1.0)), C_ENV, {'col': 'none'})
for k in range(7):
    for _ in range(80):
        x, z = rr(-30, 30), rr(-46, 44)
        if clear(x, z, -1) and free_spot(x, z, 4): break
    a = rr(0, TAU); src = LOG if k % 2 == 0 else STUMP
    o = instance(src, src.name.split('_')[0], P(x, z, 0), a, rr(0.9, 1.2), C_ENV); placed.append((x, z))
    if src is LOG:
        for t in (-1.6, 0, 1.6): marker('COL', P(x + math.cos(a) * t, z - math.sin(a) * t, 0), C_MARK, col='circle', r=0.6)
for i in range(2600):
    if i % 3 == 2: x0, x1, z0, z1 = R.choice(AREAS[1:]); x, z = rr(x0 - 3, x1 + 3), rr(z0 - 3, z1 + 3)
    else: x, z = rr(-40, 40), rr(-57, 56)
    if dist_path(x, z) < 2.4: continue
    src = R.choice(TUFTS); instance(src, 'tuft', P(x, z, ground_h(x, z)), rr(0, TAU), rr(0.7, 1.5), C_ENV)
for (tx, tz, s) in TREES_FOR_AO:
    if not inside(tx, tz, -4): continue
    for k in range(R.randint(1, 3)):
        a, r = rr(0, TAU), rr(1.2, 2.4); x, z = tx + math.cos(a) * r, tz + math.sin(a) * r
        if dist_path(x, z) < 3: continue
        src = R.choice(FERNS + [SHROOMS] if R.random() < 0.35 else FERNS); instance(src, src.name.split('_')[0], P(x, z, 0), rr(0, TAU), rr(0.8, 1.4), C_ENV)
for i in range(340):
    if i % 3 == 2: x0, x1, z0, z1 = R.choice(AREAS[5:]); x, z = rr(x0, x1), rr(z0, z1)
    else: x, z = rr(-36, 36), rr(-52, 52)
    if dist_path(x, z) < 3.2 or not clear(x, z, -5): continue
    src = R.choice(FLOWERS); instance(src, 'flowers', P(x, z, 0), rr(0, TAU), rr(0.8, 1.3), C_ENV)

# goblin camp (pack 2 and 4), ruins (pack 3 and 5)
for (px, pz) in [(-12, 14), (-10, -17)]:
    instance(FIRE, 'campfire', P(px, pz, 0), 0, 1, C_ENV)
    for c in FIRE.children: o = instance(c, c.name, P(px, pz, 0), 0, 1, C_ENV)
    marker('TORCH', P(px, pz, 1.0), C_MARK, color=0xff7a2a, int=45, flame=1)
    for k, a in enumerate([2.2, 4.1]):
        tx, tz = px + math.cos(a) * 5.2, pz + math.sin(a) * 5.2; instance(TENT, 'tent', P(tx, tz, 0), rr(0, TAU), rr(0.9, 1.1), C_ENV)
for (px, pz, a) in [(11, -2, 0.4), (8, -31, -0.6), (-6, 30, 1.1)]:
    rx, rz = px + math.cos(a + 1.6) * 6.5, pz + math.sin(a + 1.6) * 6.5
    instance(RUIN, 'ruinwall', P(rx, rz, 0), a, 1, C_ENV)
    for c in RUIN.children: instance(c, c.name, P(rx, rz, 0), a, 1, C_ENV)

# portal: dolmen gate + circle of standing stones
g = instance(GATE, 'portal_gate', P(PORTAL[0], PORTAL[1] - 0.6, 0), 0, 1, C_ENV)
for c in GATE.children: instance(c, c.name, P(PORTAL[0], PORTAL[1] - 0.6, 0), 0, 1, C_ENV)
for s in (-1, 1): marker('COL', P(PORTAL[0] + s * 3.35, PORTAL[1] - 0.6, 0), C_MARK, col='circle', r=0.95)
for i in range(9):
    a = math.pi * 0.5 + (i / 9) * TAU + 0.35; x, z = PORTAL[0] + math.cos(a) * 8, PORTAL[1] + math.sin(a) * 8
    if z > PORTAL[1] + 5: continue
    src = STONE if i % 2 else STONE2; o = instance(src, 'stone', P(x, z, 0), -a + math.pi / 2, rr(0.9, 1.15), C_ENV)
    for c in src.children: instance(c, c.name, P(x, z, 0), -a + math.pi / 2, o.scale[0], C_ENV)

# ---------------------------------------------------------------- ground vertex colours: darker under trees, lighter on the path
me = ground.data
if not me.color_attributes.get('Col'): me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
ca = me.color_attributes['Col']; me.color_attributes.active_color = ca
vals = []
for v in me.vertices:
    gx, gz = v.co.x, -v.co.y; k = 1.0
    for (tx, tz, s) in TREES_FOR_AO:
        d = math.hypot(gx - tx, gz - tz)
        if d < 3.2 * s: k *= 0.55 + 0.45 * (d / (3.2 * s)) ** 1.5
    n = noise.noise(Vector((gx * 0.06, gz * 0.06, 2.0))); k *= 0.88 + 0.16 * n
    vals.append(k)
for li, loop in enumerate(me.loops):
    k = vals[loop.vertex_index]; ca.data[li].color = (k, k * 1.0, k * 0.95, 1)

# ---------------------------------------------------------------- markers
marker('SPAWN', P(*START), C_MARK); marker('SHOW', P(*SHOW), C_MARK); marker('PORTAL', P(*PORTAL), C_MARK)
for px, pz, types in PACKS: marker('PACK', P(px, pz), C_MARK, types=types)
for px, pz, types in OPT_PACKS: marker('PACK', P(px, pz), C_MARK, types=types, opt=1)
for (title, sub_, (x0, x1, z0, z1)) in REGIONS: marker('REGION', P((x0 + x1) / 2, (z0 + z1) / 2), C_MARK, title=title, sub=sub_, w=x1 - x0, d=z1 - z0)
for (x0, x1, z0, z1) in AREAS: marker('AREA', P((x0 + x1) / 2, (z0 + z1) / 2), C_MARK, w=x1 - x0, d=z1 - z0)
for (x, z, t, rot, guards) in MINIS: marker('MINIBOSS', P(x, z), C_MARK, type=t, rot=rot, guards=guards)
for (x, z, rot, rich) in CHESTS: marker('CHEST', P(x, z), C_MARK, rot=rot, rich=rich)
result = stats()

bpy.ops.wm.save_as_mainfile(filepath=r'A:\drake clone\maps\blend\wild.blend')
export_glb(r'A:\drake clone\maps\wild.glb')
print('HOTOVO wild', result)

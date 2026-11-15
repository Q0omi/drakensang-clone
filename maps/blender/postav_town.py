# Spustenie v Blenderi: postaví mapu 'town', uloží .blend a exportuje .glb do A:\drake clone\maps
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
#  Mapa 4 – MESTO (Útočisko Draheim) – bezpečná zóna, lobby a teleport do výprav
# =====================================================================================
reset_scene()
R = random.Random(404)
rr = lambda a, b: a + R.random() * (b - a)
C_ASSET = collection('assets (zdroje)', True); C_ENV = collection('Mesto'); C_MARK = collection('znacky (hra)')

M_COBBLE = material('M_GROUND_COBBLE', 'cobble', 'cobble_n', rough=0.85)
M_GRASS = material('M_GROUND_GRASS', 'grass', rough=1.0)
M_PLASTER = material('M_PLASTER', 'plaster', 'plaster_n', rough=0.95)
M_TIMBER = material('M_TIMBER', 'timber', None, rough=0.8)
M_ROOF = material('M_ROOF', 'roof', 'roof_n', rough=0.8)
M_STONE = material('M_STONE', 'rock', 'rock_n', color=(0.8, 0.77, 0.72), rough=0.9)
M_STONE2 = material('M_STONE_DARK', 'brick', 'brick_n', color=(0.85, 0.82, 0.78), rough=0.9)
M_WOOD = material('M_WOOD', 'wood', None, rough=0.75)
M_IRON = material('M_IRON', 'iron', None, rough=0.5, metal=0.8)
M_GLASS = material('M_WINDOW_PULSE', None, color=(0.25, 0.15, 0.05), emis_color=(1.0, 0.62, 0.25), emis_strength=1.6, vcol=False)
M_WATER = material('M_WATER', 'water', None, color=(0.7, 0.9, 1.0), rough=0.08, metal=0.1, emis='water', emis_strength=0.25, vcol=False)
M_AWN = [material(f'M_AWNING_{c}', f'awning_{c}', None, rough=0.9, vcol=False) for c in ('red', 'blue', 'green')]
M_BANNER = material('M_BANNER', 'banner', None, rough=0.95)
M_LEAF = material('M_LEAVES', 'leaves', rough=0.85)
M_BARK = material('M_BARK', 'bark', 'bark_n', rough=0.95)
M_PLANT = material('M_PLANT', None, rough=0.8)
M_RUNE = material('M_RUNE_TELEPORT', None, color=(0.1, 0.2, 0.4), emis_color=(0.35, 0.7, 1.0), emis_strength=2.5, vcol=False)
M_GOLD = material('M_GOLD', None, color=(0.85, 0.65, 0.3), rough=0.35, metal=0.9, vcol=False)

WALL = 36            # town wall half-size
SPAWN, WAYPOINT = (0, 16), (9.5, 4.5)
LOBBY = [(-3.4, -12.6), (0, -13.2), (3.4, -12.6)]

# ---------------------------------------------------------------- ground: cobble inside, grass outside
def ground_h(x, z):
    e = max(0.0, max(abs(x), abs(z)) - (WALL + 4)); return min(1, e / 16) ** 1.4 * (6 + 3 * noise.noise(Vector((x * 0.05, z * 0.05, 0.4))))
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=60, y_segments=60, size=WALL + 1)
box_uv(bm, 1 / 5); vcolor(bm, lambda co, n: (lambda k: (k, k * 0.98, k * 0.95))(0.78 + 0.22 * noise.noise(Vector((co.x * 0.08, co.y * 0.08, 1.0))) - 0.18 * max(0, 1 - (math.hypot(co.x, co.y) - 13) / 3) * 0))
obj_from_bm('ground_cobble', bm, M_COBBLE, C_ENV, P(0, 0, 0), props={'ground': 1, 'noshadow': 1})
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=50, y_segments=50, size=120)
for v in bm.verts: v.co.z = ground_h(v.co.x, -v.co.y) - 0.03
box_uv(bm, 1 / 6); vcolor(bm, lambda co, n: (0.8, 0.85, 0.8))
obj_from_bm('ground_grass', bm, M_GRASS, C_ENV, props={'ground': 1, 'noshadow': 1})
# inlaid plaza ring of darker stone + compass star
ring = lathe([(12.6, 0.012), (13.4, 0.012)], 64, caps=False)
for v in ring.verts: v.co.z = 0.012
rb = bmesh.new(); seg = 64
inner = [rb.verts.new((math.cos(i / seg * TAU) * 12.4, math.sin(i / seg * TAU) * 12.4, 0.014)) for i in range(seg)]
outer = [rb.verts.new((math.cos(i / seg * TAU) * 13.4, math.sin(i / seg * TAU) * 13.4, 0.014)) for i in range(seg)]
for i in range(seg): j = (i + 1) % seg; rb.faces.new((inner[i], inner[j], outer[j], outer[i]))
box_uv(rb, 0.5); vcolor(rb, lambda co, n: (0.55, 0.52, 0.5)); obj_from_bm('plaza_ring', rb, M_STONE2, C_ENV, props={'noshadow': 1})

# ---------------------------------------------------------------- half-timbered house generator
def house(seed, w=7.0, d=6.0, floors=2, fh=2.8, roof_h=3.2, chimney=True, jetty=0.35):
    rs = random.Random(seed)
    bm_pl, bm_tb, bm_rf, bm_st, bm_gl = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    add_box(bm_st, w + 0.3, d + 0.3, 0.8, 0, 0, 0.4, 0, 0.05)                          # stone plinth
    z = 0.8; widths = []
    for f in range(floors):
        ww, dd = w + f * jetty * 2, d + f * jetty * 2; widths.append((ww, dd, z))
        add_box(bm_pl, ww, dd, fh, 0, 0, z + fh / 2)
        # frame: corner posts, floor beams, studs and diagonal braces on the long facades
        for sx in (-1, 1):
            for sy in (-1, 1): add_box(bm_tb, 0.26, 0.26, fh, sx * ww / 2, sy * dd / 2, z + fh / 2)
        for sy in (-1, 1):
            add_box(bm_tb, ww + 0.1, 0.24, 0.24, 0, sy * (dd / 2 + 0.02), z + 0.12); add_box(bm_tb, ww + 0.1, 0.24, 0.24, 0, sy * (dd / 2 + 0.02), z + fh - 0.12)
            n = max(2, int(ww / 1.7))
            for k in range(1, n):
                x = -ww / 2 + ww * k / n; add_box(bm_tb, 0.18, 0.2, fh, x, sy * (dd / 2 + 0.03), z + fh / 2)
            for k in range(n):
                if (k + f) % 2: continue
                x0 = -ww / 2 + ww * k / n; x1 = x0 + ww / n; L = math.hypot(x1 - x0, fh - 0.3); a = math.atan2(fh - 0.3, x1 - x0) * (1 if k % 4 == 0 else -1)
                t = bmesh.new(); bmesh.ops.create_cube(t, size=1.0)
                for v in t.verts: v.co = Vector((v.co.x * L, v.co.y * 0.18, v.co.z * 0.16))
                merge(bm_tb, t, Matrix.Translation(((x0 + x1) / 2, sy * (dd / 2 + 0.04), z + fh / 2)) @ Matrix.Rotation(a, 4, 'Y'))
        for sx in (-1, 1):
            add_box(bm_tb, 0.24, dd + 0.1, 0.24, sx * (ww / 2 + 0.02), 0, z + fh - 0.12)
        # windows (glowing) with frames and shutters on front/back, one per bay
        n = max(2, int(ww / 1.7))
        for sy in (-1, 1):
            for k in range(n):
                if f == 0 and sy == -1 and k == n // 2: continue      # door goes here
                if rs.random() < 0.25: continue
                x = -ww / 2 + ww * (k + 0.5) / n
                add_box(bm_gl, 0.62, 0.06, 0.82, x, sy * (dd / 2 + 0.02), z + fh * 0.55)
                add_box(bm_tb, 0.82, 0.12, 0.1, x, sy * (dd / 2 + 0.06), z + fh * 0.55 - 0.46); add_box(bm_tb, 0.82, 0.12, 0.08, x, sy * (dd / 2 + 0.06), z + fh * 0.55 + 0.45)
                add_box(bm_tb, 0.06, 0.08, 0.82, x, sy * (dd / 2 + 0.06), z + fh * 0.55)
                for s in (-1, 1): add_box(bm_tb, 0.34, 0.06, 0.86, x + s * 0.52, sy * (dd / 2 + 0.07), z + fh * 0.55)
        z += fh
    # door + steps
    add_box(bm_tb, 1.1, 0.14, 2.0, 0, -(d / 2 + 0.06), 1.8); add_box(bm_st, 1.8, 0.8, 0.3, 0, -(d / 2 + 0.5), 0.15, 0, 0.04)
    add_box(bm_tb, 1.4, 0.2, 0.2, 0, -(d / 2 + 0.08), 2.9)
    # gable roof spanning the width (ridge along x)
    ww, dd, _ = widths[-1]; ov = 0.55; X, Y = ww / 2 + ov, dd / 2 + ov; zt = z + roof_h
    for sy in (-1, 1):
        q = bmesh.new(); a = q.verts.new((-X, sy * Y, z - 0.25)); b = q.verts.new((X, sy * Y, z - 0.25)); c = q.verts.new((X, 0, zt)); e = q.verts.new((-X, 0, zt))
        q.faces.new((a, b, c, e) if sy < 0 else (e, c, b, a))
        th = bmesh.ops.extrude_face_region(q, geom=q.faces[:]); vs = [g for g in th['geom'] if isinstance(g, bmesh.types.BMVert)]
        for v in vs: v.co.z -= 0.18
        uv = q.loops.layers.uv.verify()
        for f_ in q.faces:
            for l in f_.loops: l[uv].uv = (l.vert.co.x / 2.2, math.hypot(abs(l.vert.co.y), zt - l.vert.co.z) / 2.2)
        finalize(q); merge(bm_rf, q)
    for sx in (-1, 1):  # plaster gable triangles + barge boards
        g = bmesh.new(); a = g.verts.new((sx * ww / 2, -dd / 2, z)); b = g.verts.new((sx * ww / 2, dd / 2, z)); c = g.verts.new((sx * ww / 2, 0, zt - 0.2))
        g.faces.new((a, b, c) if sx > 0 else (c, b, a)); merge(bm_pl, g)
        add_box(bm_tb, 0.2, 0.2, roof_h - 0.2, sx * (ww / 2 + 0.02), 0, z + (roof_h - 0.2) / 2)
    add_box(bm_tb, 2 * X + 0.1, 0.24, 0.24, 0, 0, zt + 0.02)
    if chimney:
        cx = rs.choice([-1, 1]) * ww * 0.28; add_box(bm_st, 0.8, 0.8, roof_h + 1.4, cx, dd * 0.18, z + (roof_h + 1.4) / 2, 0, 0.04); add_box(bm_st, 1.0, 1.0, 0.2, cx, dd * 0.18, z + roof_h + 1.45, 0, 0.03)
    for b_, m in ((bm_pl, 1), (bm_tb, 0.6), (bm_st, 0.7)):
        finalize(b_); box_uv(b_, 1 / 3); vcolor(b_, ao_moss(moss=0, dark=m, h1=4))
    finalize(bm_gl); vcolor(bm_rf, ao_moss(top=(0.6, 0.7, 0.45), moss=0.15, dark=0.75, h0=z, h1=zt))
    parts = [(bm_pl, M_PLASTER), (bm_tb, M_TIMBER), (bm_rf, M_ROOF), (bm_st, M_STONE), (bm_gl, M_GLASS)]
    out = bmesh.new(); counts = []
    for b_, m in parts: me_n = len(out.faces); merge(out, b_); counts.append(len(out.faces) - me_n)
    o = obj_from_bm(f'house_{seed}', out, [m for _, m in parts], C_ASSET)
    i0 = 0
    for k, c in enumerate(counts):
        for p in o.data.polygons[i0:i0 + c]: p.material_index = k
        i0 += c
    o['col'] = 'box'; o['occ'] = 1
    return o

HOUSES = [house(1, 7, 6, 2), house(2, 6, 5.5, 2, roof_h=3.6), house(3, 8.5, 6.5, 2, roof_h=3.0), house(4, 5.5, 5, 1, roof_h=2.8), house(5, 7.5, 6, 3, fh=2.6, roof_h=3.4)]

def town_hall():
    bm_s, bm_r, bm_g, bm_t = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    W, D, H = 15, 9, 7.5
    for k, (w, d, h) in enumerate([(W + 4, D + 4, 0.3), (W + 3, D + 3, 0.3), (W + 2, D + 2, 0.3)]): add_box(bm_s, w, d, h, 0, -0.8, h / 2 + k * 0.3, 0, 0.04)
    add_box(bm_s, W, D, H, 0, 0, 0.9 + H / 2, 0, 0.05)
    for sx in range(-3, 4):  # buttress pilasters + tall arched windows
        x = sx * W / 7
        add_box(bm_s, 0.7, 0.5, H, x - W / 14, -(D / 2 + 0.2), 0.9 + H / 2, 0, 0.04)
        if sx < 3 and sx != 0 or sx == -3:
            pass
    for k in range(6):
        x = -W / 2 + W / 7 * (k + 0.5) + (W / 7 if k >= 3 else 0)
        add_box(bm_g, 1.1, 0.1, 3.0, x, -(D / 2 + 0.02), 0.9 + H * 0.55); add_box(bm_t, 1.35, 0.2, 0.25, x, -(D / 2 + 0.06), 0.9 + H * 0.55 + 1.6)
    add_box(bm_t, 2.6, 0.3, 4.0, 0, -(D / 2 + 0.1), 0.9 + 2.0)   # big door
    add_box(bm_s, 3.6, 0.6, 0.8, 0, -(D / 2 + 0.25), 0.9 + 4.4, 0, 0.05)
    # hip roof
    ov = 0.7; X, Y, zb, zt = W / 2 + ov, D / 2 + ov, 0.9 + H, 0.9 + H + 4.5
    q = bmesh.new(); v = [q.verts.new(p) for p in [(-X, -Y, zb), (X, -Y, zb), (X, Y, zb), (-X, Y, zb), (-X + Y, 0, zt), (X - Y, 0, zt)]]
    q.faces.new((v[0], v[1], v[5], v[4])); q.faces.new((v[2], v[3], v[4], v[5])); q.faces.new((v[1], v[2], v[5])); q.faces.new((v[3], v[0], v[4]))
    uv = q.loops.layers.uv.verify()
    for f_ in q.faces:
        for l in f_.loops: l[uv].uv = ((l.vert.co.x + l.vert.co.y * 0.3) / 2.2, (zt - l.vert.co.z) / 1.6)
    merge(bm_r, q)
    # bell tower
    add_box(bm_s, 4, 4, 7, 0, 1.0, zt - 1 + 3.5, 0, 0.05)
    for sx in (-1, 1):
        for sy in (-1, 1): add_box(bm_s, 0.6, 0.6, 2.4, sx * 1.6, 1.0 + sy * 1.6, zt + 6 + 1.2)
    add_box(bm_s, 4.6, 4.6, 0.5, 0, 1.0, zt + 7.45, 0, 0.05)
    sp = bmesh.new(); bmesh.ops.create_cone(sp, cap_ends=True, segments=4, radius1=3.4, radius2=0.0, depth=6.0)
    for vv in sp.verts: vv.co.z += 3.0
    merge(bm_r, sp, Matrix.Translation((0, 1.0, zt + 7.7)) @ Matrix.Rotation(math.pi / 4, 4, 'Z'))
    add_cyl(bm_t, 1.0, 1.0, 0.25, 24, 0, -1.05, zt + 3.8, Euler((math.pi / 2, 0, 0)))  # clock face
    for b_, m in ((bm_s, 0.6), (bm_t, 0.6)): finalize(b_); box_uv(b_, 1 / 3); vcolor(b_, ao_moss(moss=0.05, dark=m, h1=6))
    finalize(bm_r); vcolor(bm_r, ao_moss(moss=0.1, dark=0.75, h0=zb, h1=zt + 10)); finalize(bm_g)
    out = bmesh.new(); counts = []
    for b_ in (bm_s, bm_r, bm_t, bm_g): n0 = len(out.faces); merge(out, b_); counts.append(len(out.faces) - n0)
    o = obj_from_bm('town_hall', out, [M_STONE2, M_ROOF, M_TIMBER, M_GLASS], C_ASSET); i0 = 0
    for k, c in enumerate(counts):
        for p in o.data.polygons[i0:i0 + c]: p.material_index = k
        i0 += c
    o['col'] = 'box'; o['occ'] = 1; return o
HALL = town_hall()

# ---------------------------------------------------------------- fountain, waypoint, stalls, lamps, props
def fountain():
    bm = lathe([(3.6, 0), (3.7, 0.15), (3.7, 0.75), (3.4, 0.85), (3.2, 0.85), (3.2, 0.3), (0.0, 0.3)], 40)
    merge(bm, lathe([(0.55, 0.3), (0.4, 1.4), (0.5, 1.6), (1.6, 1.75), (1.7, 1.95), (1.4, 2.0), (0.35, 2.1), (0.25, 3.0), (0.6, 3.2), (0.65, 3.35), (0.0, 3.45)], 24))
    finalize(bm); box_uv(bm, 0.5); vcolor(bm, ao_moss(top=(0.5, 0.6, 0.4), moss=0.3, dark=0.6, h1=3))
    o = obj_from_bm('fountain', bm, M_STONE, C_ASSET); o['col'] = 'circle'; o['r'] = 3.8
    wb = bmesh.new(); bmesh.ops.create_circle(wb, cap_ends=True, segments=40, radius=3.25)
    for v in wb.verts: v.co.z = 0.62
    w2 = bmesh.new(); bmesh.ops.create_circle(w2, cap_ends=True, segments=24, radius=1.45)
    for v in w2.verts: v.co.z = 1.88
    merge(wb, w2); uv = wb.loops.layers.uv.verify()
    for f in wb.faces:
        for l in f.loops: l[uv].uv = (l.vert.co.x / 3, l.vert.co.y / 3)
    w = obj_from_bm('fountain_water', wb, M_WATER, C_ASSET); w.parent = o; w['noshadow'] = 1
    return o
def waypoint():
    bm = bmesh.new()
    for k, (r, h) in enumerate([(2.6, 0.3), (2.1, 0.3), (1.6, 0.3)]): merge(bm, lathe([(r, k * 0.3), (r, k * 0.3 + h)], 8), None)
    ob = bmesh.new(); bmesh.ops.create_cone(ob, cap_ends=True, segments=4, radius1=0.75, radius2=0.45, depth=4.6)
    for v in ob.verts: v.co.z += 2.3 + 0.9
    merge(bm, ob, Matrix.Rotation(math.pi / 4, 4, 'Z'))
    tp = bmesh.new(); bmesh.ops.create_cone(tp, cap_ends=True, segments=4, radius1=0.5, radius2=0.0, depth=0.8)
    for v in tp.verts: v.co.z += 5.5 + 0.4
    merge(bm, tp, Matrix.Rotation(math.pi / 4, 4, 'Z'))
    finalize(bm); box_uv(bm, 0.5); vcolor(bm, ao_moss(moss=0.1, dark=0.55, h1=5))
    o = obj_from_bm('waypoint', bm, M_STONE2, C_ASSET); o['col'] = 'circle'; o['r'] = 1.7; o['occ'] = 1
    rb = bmesh.new()
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        for j in range(4): add_box(rb, 0.3, 0.05, 0.12 + 0.06 * (j % 2), math.cos(a) * 0.5, math.sin(a) * 0.5, 1.6 + j * 0.85, a + math.pi / 2)
    rg = bmesh.new(); seg = 32
    for rad, z in ((1.85, 0.905), (2.35, 0.605)):
        ins = [rg.verts.new((math.cos(i / seg * TAU) * rad, math.sin(i / seg * TAU) * rad, z)) for i in range(seg)]
        outs = [rg.verts.new((math.cos(i / seg * TAU) * (rad + 0.12), math.sin(i / seg * TAU) * (rad + 0.12), z)) for i in range(seg)]
        for i in range(seg): j = (i + 1) % seg; rg.faces.new((ins[i], ins[j], outs[j], outs[i]))
    merge(rb, rg)
    r = obj_from_bm('waypoint_runes', rb, M_RUNE, C_ASSET); r.parent = o; r['noshadow'] = 1
    return o
def stall(seed, mi):
    rs = random.Random(seed); bm_w = bmesh.new(); bm_c = bmesh.new()
    add_box(bm_w, 3.4, 1.4, 0.9, 0, 0, 0.45, 0, 0.03); add_box(bm_w, 3.6, 1.6, 0.1, 0, 0, 0.95)
    for sx in (-1, 1):
        for sy in (-1, 1): add_box(bm_w, 0.14, 0.14, 2.6 if sy < 0 else 2.2, sx * 1.7, sy * 0.8, (2.6 if sy < 0 else 2.2) / 2)
    q = bmesh.new(); v = [q.verts.new(p) for p in [(-1.9, -1.4, 2.25), (1.9, -1.4, 2.25), (1.9, 1.1, 2.75), (-1.9, 1.1, 2.75)]]
    q.faces.new(v); uv = q.loops.layers.uv.verify()
    for f in q.faces:
        for l in f.loops: l[uv].uv = ((l.vert.co.x + 1.9) / 3.8 * 2, (l.vert.co.y + 1.4) / 2.5)
    for i in range(8):  # scalloped valance
        x = -1.9 + i * 0.475; t = q.verts.new((x, -1.4, 2.25)); t2 = q.verts.new((x + 0.475, -1.4, 2.25)); t3 = q.verts.new((x + 0.2375, -1.45, 1.95)); nf = q.faces.new((t, t2, t3))
        for l in nf.loops: l[uv].uv = ((i % 2) * 0.25 + 0.06, 0.1)
    merge(bm_c, q)
    for k in range(6):  # goods: crates, sacks, pumpkins
        x = -1.3 + k * 0.52
        if rs.random() < 0.5: add_box(bm_w, 0.4, 0.4, 0.3, x, rs.uniform(-0.3, 0.3), 1.15, rs.uniform(0, 1), 0.02)
        else: s = bmesh.new(); bmesh.ops.create_icosphere(s, subdivisions=1, radius=0.2); merge(bm_w, s, Matrix.Translation((x, rs.uniform(-0.3, 0.3), 1.2)))
    finalize(bm_w); box_uv(bm_w, 0.8); vcolor(bm_w, ao_moss(moss=0, dark=0.6, h1=1.2)); finalize(bm_c)
    out = bmesh.new(); merge(out, bm_w); n = len(out.faces); merge(out, bm_c)
    o = obj_from_bm(f'stall_{seed}', out, [M_WOOD, M_AWN[mi]], C_ASSET)
    for p in o.data.polygons[n:]: p.material_index = 1
    o['col'] = 'box'; return o
def lamp():
    bm = bmesh.new(); add_box(bm, 0.5, 0.5, 0.3, 0, 0, 0.15, 0, 0.03); add_cyl(bm, 0.09, 0.07, 3.6, 8, 0, 0, 0.3)
    add_box(bm, 0.9, 0.08, 0.08, 0.35, 0, 3.6)
    merge(bm, lathe([(0.12, 3.05), (0.28, 3.15), (0.3, 3.45), (0.12, 3.6)], 6), Matrix.Translation((0.75, 0, -0.2)))
    finalize(bm); box_uv(bm, 1); o = obj_from_bm('lamp', bm, M_IRON, C_ASSET); o['col'] = 'circle'; o['r'] = 0.35; o['noshadow'] = 0; return o
def tree(seed):
    rs = random.Random(seed); bm = bm_cyl(0.3, 0.18, 3.0, 8); jitter(bm, 0.04, 2, seed); nb = len(bm.faces)
    for k in range(4):
        a = rs.random() * TAU; r = 0 if k == 0 else rs.uniform(0.7, 1.2); s = rs.uniform(1.1, 1.5)
        ico = bmesh.new(); bmesh.ops.create_icosphere(ico, subdivisions=2, radius=s); displace_radial(ico, s * 0.3, 1.3, seed + k)
        merge(bm, ico, Matrix.Translation((math.cos(a) * r, math.sin(a) * r, 3.4 + rs.uniform(-0.2, 0.6))))
    finalize(bm); box_uv(bm, 0.5)
    vcolor(bm, lambda co, n: (lambda k: (0.45 + 0.6 * k, 0.5 + 0.55 * k, 0.4 + 0.45 * k))(min(1, max(0, (co.z - 2) / 3)) * 0.6 + max(0, n.z) * 0.4))
    o = obj_from_bm(f'tree_{seed}', bm, [M_LEAF, M_BARK], C_ASSET)
    for i, p in enumerate(o.data.polygons):
        if i < nb: p.material_index = 1
    o['col'] = 'circle'; o['r'] = 0.5; o['occ'] = 1; return o
def planter():
    bm = bmesh.new(); add_box(bm, 2.2, 2.2, 0.6, 0, 0, 0.3, 0, 0.05); finalize(bm); box_uv(bm, 0.5); vcolor(bm, ao_moss(moss=0, dark=0.6, h1=0.6))
    return obj_from_bm('planter', bm, M_STONE, C_ASSET)
def barrel():
    bm = lathe([(0.42, 0), (0.5, 0.35), (0.52, 0.55), (0.5, 0.8), (0.42, 1.1)], 14); finalize(bm); cyl_uv(bm, 2, 0.9); vcolor(bm, ao_moss(h1=1.1, moss=0, dark=0.6))
    o = obj_from_bm('barrel', bm, M_WOOD, C_ASSET); o['col'] = 'circle'; o['r'] = 0.55; return o
def crate():
    bm = bmesh.new(); add_box(bm, 1.0, 1.0, 1.0, 0, 0, 0.5, 0, 0.04)
    for s in (-1, 1): add_box(bm, 1.04, 0.1, 1.04, 0, s * 0.46, 0.5); add_box(bm, 0.1, 1.04, 1.04, s * 0.46, 0, 0.5)
    finalize(bm); box_uv(bm, 0.8); vcolor(bm, ao_moss(h1=1, moss=0, dark=0.65)); o = obj_from_bm('crate', bm, M_WOOD, C_ASSET); o['col'] = 'circle'; o['r'] = 0.7; return o
def bench():
    bm = bmesh.new(); add_box(bm, 2.2, 0.5, 0.08, 0, 0, 0.5); add_box(bm, 2.2, 0.08, 0.5, 0, 0.25, 0.8)
    for s in (-1, 1): add_box(bm, 0.1, 0.5, 0.5, s * 0.95, 0, 0.25)
    finalize(bm); box_uv(bm, 1); o = obj_from_bm('bench', bm, M_WOOD, C_ASSET); o['col'] = 'circle'; o['r'] = 0.8; return o
def well():
    bm = lathe([(1.1, 0), (1.1, 0.9), (0.85, 0.9), (0.85, 0.1)], 16); finalize(bm); box_uv(bm, 0.6); vcolor(bm, ao_moss(moss=0.3, dark=0.6, h1=1))
    nb = len(bm.faces)
    for s in (-1, 1): add_box(bm, 0.18, 0.18, 2.4, s * 1.0, 0, 1.2)
    add_box(bm, 2.3, 0.14, 0.14, 0, 0, 2.2)
    q = bmesh.new(); v = [q.verts.new(p) for p in [(-1.4, -1.2, 2.2), (1.4, -1.2, 2.2), (1.4, 0, 2.9), (-1.4, 0, 2.9)]]; q.faces.new(v)
    v2 = [q.verts.new(p) for p in [(-1.4, 0, 2.9), (1.4, 0, 2.9), (1.4, 1.2, 2.2), (-1.4, 1.2, 2.2)]]; q.faces.new(v2); box_uv(q, 0.5)
    merge(bm, q); finalize(bm)
    o = obj_from_bm('well', bm, [M_STONE, M_WOOD], C_ASSET)
    for i, p in enumerate(o.data.polygons):
        if i >= nb: p.material_index = 1
    o['col'] = 'circle'; o['r'] = 1.3; return o
def anvil_forge():
    bm = bmesh.new(); add_box(bm, 2.4, 1.8, 1.0, 0, 0, 0.5, 0, 0.05); add_box(bm, 1.2, 1.2, 2.6, 0, 0.4, 1.3 + 0.5); finalize(bm); box_uv(bm, 0.5); vcolor(bm, ao_moss(moss=0, dark=0.5, h1=3))
    nb = len(bm.faces); add_box(bm, 0.9, 0.35, 0.3, 1.8, -0.4, 0.75); add_box(bm, 0.3, 0.3, 0.6, 1.8, -0.4, 0.3); finalize(bm)
    o = obj_from_bm('forge', bm, [M_STONE2, M_IRON], C_ASSET)
    for i, p in enumerate(o.data.polygons):
        if i >= nb: p.material_index = 1
    o['col'] = 'box'; return o
def town_wall_seg(L=8.0, h=6.0):
    bm = bmesh.new(); add_box(bm, L, 2.4, h, 0, 0, h / 2, 0, 0.05); add_box(bm, L + 0.02, 2.9, 0.4, 0, 0, h + 0.2, 0, 0.04)
    for k in range(4): add_box(bm, 1.0, 0.6, 1.0, -L / 2 + 1 + k * 2, -1.15, h + 0.9, 0, 0.04); add_box(bm, 1.0, 0.6, 1.0, -L / 2 + 1 + k * 2, 1.15, h + 0.9, 0, 0.04)
    finalize(bm); box_uv(bm, 1 / 3); vcolor(bm, ao_moss(moss=0.25, dark=0.5, h1=h))
    o = obj_from_bm('townwall', bm, M_STONE2, C_ASSET); o['occ'] = 1; return o
def tower():
    bm = bm_cyl(3.2, 3.0, 10, 16); bevel(bm, 0.05); merge(bm, lathe([(3.0, 10), (3.6, 10.2), (3.6, 11.4)], 16))
    for k in range(8):
        a = k / 8 * TAU; add_box(bm, 1.0, 0.7, 1.1, math.cos(a) * 3.2, math.sin(a) * 3.2, 11.9, a + math.pi / 2, 0.04)
    finalize(bm); cyl_uv(bm, 4, 1 / 3); vcolor(bm, ao_moss(moss=0.2, dark=0.5, h1=10))
    o = obj_from_bm('tower', bm, M_STONE2, C_ASSET); o['col'] = 'circle'; o['r'] = 3.3; o['occ'] = 1; return o
def gate():
    bm = bmesh.new()
    for s in (-1, 1): add_box(bm, 4.0, 4.0, 10, s * 5, 0, 5, 0, 0.05)
    add_box(bm, 14, 4.0, 3.0, 0, 0, 9.5, 0, 0.05)
    for k in range(7): add_box(bm, 1.0, 0.6, 1.0, -6 + k * 2, -1.8, 11.5, 0, 0.04)
    finalize(bm); box_uv(bm, 1 / 3); vcolor(bm, ao_moss(moss=0.2, dark=0.5, h1=10))
    pg = bmesh.new()
    for k in range(6): add_box(pg, 0.18, 0.25, 7.6, -2.5 + k, 0, 3.8)
    for k in range(5): add_box(pg, 6.0, 0.22, 0.16, 0, 0, 0.8 + k * 1.6)
    finalize(pg); box_uv(pg, 1)
    out = bmesh.new(); merge(out, bm); n = len(out.faces); merge(out, pg)
    o = obj_from_bm('gate', out, [M_STONE2, M_IRON], C_ASSET)
    for p in o.data.polygons[n:]: p.material_index = 1
    o['occ'] = 1; return o
def banner_pole():
    bm = bmesh.new(); add_cyl(bm, 0.07, 0.06, 6.5, 8, 0, 0, 0); merge(bm, lathe([(0.0, 6.5), (0.18, 6.55), (0.0, 6.9)], 8))
    finalize(bm); box_uv(bm, 1); nb = len(bm.faces)
    W, H = 1.3, 3.0; cl = bmesh.new(); vs = {}
    for j in range(9):
        for i in range(4): x = 0.1 + i / 3 * W; z = 6.2 - j / 8 * H + (0.3 * (1 - abs(i / 3 - 0.5) * 2) if j == 8 else 0); vs[i, j] = cl.verts.new((x, 0.05 * math.sin(j + i), z))
    uv = cl.loops.layers.uv.verify()
    for j in range(8):
        for i in range(3):
            f = cl.faces.new((vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]))
            for l, (a, b) in zip(f.loops, [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]): l[uv].uv = (a / 3, 1 - b / 8 * 0.88)
    merge(bm, cl)
    o = obj_from_bm('banner_pole', bm, [M_IRON, M_BANNER], C_ASSET)
    for p in o.data.polygons[nb:]: p.material_index = 1
    o['col'] = 'circle'; o['r'] = 0.3; return o
def lobby_pedestal():
    bm = lathe([(1.4, 0), (1.4, 0.18), (1.2, 0.3), (1.15, 0.36)], 32); finalize(bm); box_uv(bm, 0.6); vcolor(bm, ao_moss(moss=0, dark=0.6, h1=0.4))
    o = obj_from_bm('pedestal', bm, M_STONE2, C_ASSET)
    rg = bmesh.new(); seg = 48
    ins = [rg.verts.new((math.cos(i / seg * TAU) * 0.95, math.sin(i / seg * TAU) * 0.95, 0.365)) for i in range(seg)]
    outs = [rg.verts.new((math.cos(i / seg * TAU) * 1.07, math.sin(i / seg * TAU) * 1.07, 0.365)) for i in range(seg)]
    for i in range(seg): j = (i + 1) % seg; rg.faces.new((ins[i], ins[j], outs[j], outs[i]))
    r = obj_from_bm('pedestal_ring', rg, M_GOLD, C_ASSET); r.parent = o; r['noshadow'] = 1
    return o

FOUNT, WAYP, LAMP, TREE, PLANT, BARREL, CRATE, BENCH, WELL, FORGE = fountain(), waypoint(), lamp(), tree(7), planter(), barrel(), crate(), bench(), well(), anvil_forge()
STALLS = [stall(20 + i, i % 3) for i in range(3)]; WALLSEG, TOWER, GATE, POLE, PED = town_wall_seg(), tower(), gate(), banner_pole(), lobby_pedestal()

def put(src, x, z, rot=0.0, s=1.0, y=0.0, props=None):
    o = instance(src, src.name.split('_')[0] if src.name[-1].isdigit() else src.name, P(x, z, y), rot, s, C_ENV, props)
    for c in src.children: instance(c, c.name, P(x, z, y), rot + c.rotation_euler[2], s, C_ENV)
    return o

# ---------------------------------------------------------------- layout
put(FOUNT, 0, 0); put(WAYP, *WAYPOINT)
put(HALL, 0, -24)
# houses around the plaza (fronts face the plaza)
north = [(-14, -21, 0), (-24.5, -22, 2), (14, -21, 1), (24.5, -22, 3)]
south = [(-14, 22, 2), (-24.5, 23, 0), (14, 22, 4), (24.5, 23, 1)]
west = [(-22, -9, 3), (-23, 9, 2)]
east = [(22, -9, 1), (23, 10, 0)]
for x, z, k in north: put(HOUSES[k], x, z, 0)
for x, z, k in south: put(HOUSES[k], x, z, math.pi)
for x, z, k in west: put(HOUSES[k], x, z, math.pi / 2)
for x, z, k in east: put(HOUSES[k], x, z, -math.pi / 2)
put(FORGE, 15.5, -4.5, -math.pi / 2); marker('TORCH', P(15.2, -4.0, 1.6), C_MARK, color=0xff6a1a, int=40, flame=1.3)
put(WELL, -11, 8.5)
for (x, z, r, k) in [(-8, -8, 0.6, 0), (8.5, -8.5, -0.6, 1), (-9.5, 3.5, 1.4, 2)]: put(STALLS[k], x, z, r)
for (x, z) in [(-12.5, -12.5), (12.5, -12.5), (-12.5, 12.5), (12.5, 12.5), (-4.5, 19), (4.5, 19), (-6.5, -15.2), (6.5, -15.2), (-28, 0), (28, 0)]:
    put(LAMP, x, z, math.atan2(-z, -x) if abs(x) > 1 else 0); a = math.atan2(-z, -x)
    marker('TORCH', P(x + math.cos(a) * 0.75, z + math.sin(a) * 0.75, 3.15), C_MARK, color=0xffb060, int=30, flame=0.55)
for (x, z) in [(-17, 4), (17, 13), (-17, -14), (6, 26), (-6, 27.5), (29, -14), (-29, 14), (28, 28), (-28, -29)]:
    put(PLANT, x, z, 0); put(TREE, x, z, R.random() * TAU, rr(0.9, 1.15), 0.6)
for (x, z, r) in [(0, 9.6, 0), (-9.8, -1.5, math.pi / 2), (5.5, 9.0, -0.5)]: put(BENCH, x, z, r)
for i in range(26):
    side = R.choice(['n', 's', 'e', 'w']); x = rr(-26, 26); z = rr(-26, 26)
    if side == 'n': z = rr(-17.5, -16.6)
    elif side == 's': z = rr(17.4, 18.2)
    elif side == 'e': x = rr(17.6, 18.4)
    else: x = rr(-18.4, -17.6)
    if abs(x) < 6 or abs(z) < 6 and side in 'ew': continue
    put(R.choice([BARREL, BARREL, CRATE]), x, z, rr(0, TAU), rr(0.9, 1.1))
for (x, z) in [(-10.8, -16.2), (10.8, -16.2), (-3.5, 30), (3.5, 30)]: put(POLE, x, z, math.pi / 2)
# lobby pedestals in front of the town hall
for (x, z) in LOBBY: put(PED, x, z, 0)
# town walls with towers and gates (north / south)
for side in (-1, 1):
    for k in range(-4, 5):
        put(WALLSEG, side * WALL, k * 8, math.pi / 2)
        if k != 0: put(WALLSEG, k * 8, side * WALL, 0)
    put(GATE, 0, side * WALL, 0 if side < 0 else math.pi)
for sx in (-1, 1):
    for sz in (-1, 1): put(TOWER, sx * WALL, sz * WALL, 0)
for side in (-1, 1):
    marker('COLBOX', P(0, side * WALL), C_MARK, w=WALL * 2 + 6, d=3.0); marker('COLBOX', P(side * WALL, 0), C_MARK, w=3.0, d=WALL * 2 + 6)
# trees outside the walls
for i in range(260):
    x, z = rr(-80, 80), rr(-80, 80)
    if max(abs(x), abs(z)) < WALL + 5: continue
    put(TREE, x, z, rr(0, TAU), rr(1.0, 1.7), ground_h(x, z) - 0.2, {'col': 'none'})

# ---------------------------------------------------------------- markers
marker('SPAWN', P(*SPAWN), C_MARK); marker('SHOW', P(0, -12.8), C_MARK); marker('WAYPOINT', P(*WAYPOINT), C_MARK)
marker('FOUNTAIN', P(0, 0, 3.4), C_MARK)
marker('MERCHANT', P(-5.5, -8.6, 0), C_MARK, rot=0.6)   # obchodníčka Hilda pri rohu stánku (viditeľná spod strechy)
for i, (x, z) in enumerate(LOBBY): marker('LOBBY', P(x, z, 0.36), C_MARK, slot=i)
marker('TORCH', P(*WAYPOINT, 2.5), C_MARK, color=0x5ab0ff, int=45, steady=1)
result = stats()

bpy.ops.wm.save_as_mainfile(filepath=r'A:\drake clone\maps\blend\town.blend')
export_glb(r'A:\drake clone\maps\town.glb')
print('HOTOVO town', result)

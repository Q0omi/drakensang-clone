import os
BASE = r'A:\drake clone\maps'
TEX_DIR = os.path.join(BASE, 'textures')
os.makedirs(os.path.join(BASE, 'blend'), exist_ok=True)
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
#  Mapa 3 – BOSS ROOM (Dračia svätyňa)
# =====================================================================================
reset_scene()
R = random.Random(99)
rr = lambda a, b: a + R.random() * (b - a)
C_ASSET = collection('assets (zdroje)', True); C_ENV = collection('Svatyna'); C_MARK = collection('znacky (hra)')

M_OBS = material('M_FLOOR_OBSIDIAN_PULSE', 'obsidian', 'obsidian_n', color=(0.9, 0.85, 0.9), rough=0.35, metal=0.3, emis='lava_cracks', emis_strength=1.3)
M_DARK = material('M_DARKSTONE', 'rock', 'rock_n', color=(0.32, 0.27, 0.28), rough=0.7, metal=0.1)
M_CLIFF = material('M_CLIFF', 'rock', 'rock_n', color=(0.28, 0.22, 0.22), rough=0.95)
M_BONE = material('M_BONE', 'bone', None, color=(0.85, 0.78, 0.68), rough=0.6)
M_IRON = material('M_IRON', 'iron', None, rough=0.5, metal=0.8)
M_RUNES = material('M_RUNEBAND_PULSE', 'runes', None, color=(0.12, 0.04, 0.03), emis='runes', emis_strength=1.2, vcol=False)
M_CRYST = material('M_CRYSTAL', None, color=(1.0, 0.45, 0.2), rough=0.2, emis_color=(1.0, 0.35, 0.08), emis_strength=3.0, vcol=False)
M_LAVA = material('M_LAVA', None, color=(1.0, 0.35, 0.05), emis_color=(1.0, 0.3, 0.05), emis_strength=3.0, vcol=False)
M_RIM = material('M_RIM', 'rock', 'rock_n', color=(0.22, 0.18, 0.19), rough=0.6)
START, BOSS, RA = (0, 23), (0, -6), 30.2

# ---------------------------------------------------------------- obsidian floor with lava cracks
bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, segments=128, radius=RA)
bmesh.ops.triangulate(bm, faces=bm.faces[:])
uv = bm.loops.layers.uv.verify()
for f in bm.faces:
    for l in f.loops: l[uv].uv = (l.vert.co.x / 9, l.vert.co.y / 9)
vcolor(bm, lambda co, n: (lambda k: (k, k, k))(0.7 + 0.3 * min(1, (RA - co.length) / 4)))
obj_from_bm('floor', bm, M_OBS, C_ENV, P(0, 0, 0.0), props={'ground': 1, 'noshadow': 1})
# stepped obsidian rim and an inlaid runic ring
rim = lathe([(RA - 0.05, 0.0), (RA + 0.4, 0.25), (RA + 1.1, 0.25), (RA + 1.4, -0.6)], 128, caps=False); finalize(rim); cyl_uv(rim, 30, 1 / 3)
vcolor(rim, ao_moss(moss=0, dark=0.6, h1=0.25)); obj_from_bm('rim', rim, M_RIM, C_ENV, props={'noshadow': 1})
for (r0, r1) in [(13.4, 14.2), (21.0, 21.35)]:
    ring = bmesh.new(); seg = 96; inner = [ring.verts.new((math.cos(i / seg * TAU) * r0, math.sin(i / seg * TAU) * r0, 0.02)) for i in range(seg)]
    outer = [ring.verts.new((math.cos(i / seg * TAU) * r1, math.sin(i / seg * TAU) * r1, 0.02)) for i in range(seg)]
    uvl = ring.loops.layers.uv.verify()
    for i in range(seg):
        j = (i + 1) % seg; f = ring.faces.new((inner[i], inner[j], outer[j], outer[i]))
        for l, (u, v) in zip(f.loops, [(i / seg * 12, 0), ((i + 1) / seg * 12, 0), ((i + 1) / seg * 12, 1), (i / seg * 12, 1)]): l[uvl].uv = (u, v)
    obj_from_bm(f'runering_{int(r0)}', ring, M_RUNES, C_ENV, props={'noshadow': 1, 'decal': 0})

# ---------------------------------------------------------------- lava moat (replaced by an animated shader in the game)
lv = bmesh.new(); seg = 128; a_in = [lv.verts.new((math.cos(i / seg * TAU) * (RA + 0.8), math.sin(i / seg * TAU) * (RA + 0.8), -0.35)) for i in range(seg)]
a_out = [lv.verts.new((math.cos(i / seg * TAU) * 62, math.sin(i / seg * TAU) * 62, -0.35)) for i in range(seg)]
for i in range(seg): j = (i + 1) % seg; lv.faces.new((a_in[i], a_in[j], a_out[j], a_out[i]))
obj_from_bm('lava', lv, M_LAVA, C_ENV, props={'lava': 1, 'noshadow': 1})

# ---------------------------------------------------------------- cavern cliffs
def cliff(seed):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=9, radius1=1.0, radius2=0.18, depth=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
    for v in bm.verts: v.co.z += 0.5
    jitter(bm, 0.14, 1.6, seed); finalize(bm); box_uv(bm, 0.25); vcolor(bm, ao_moss(moss=0, dark=0.35, h1=1.0))
    return obj_from_bm(f'cliff_{seed}', bm, M_CLIFF, C_ASSET)
CLIFFS = [cliff(i) for i in range(4)]
for i in range(140):
    a, r = rr(0, TAU), rr(44, 60); s = rr(3, 8)
    instance(R.choice(CLIFFS), 'cliff', Vector((math.cos(a) * r, math.sin(a) * r, -1.0)), rr(0, TAU), (s, s * rr(0.8, 1.2), rr(8, 24)), C_ENV, {'noshadow': 1})
for i in range(60):  # small lava islands / rocks in the moat
    a, r = rr(0, TAU), rr(33, 42); s = rr(0.6, 2.2)
    instance(R.choice(CLIFFS), 'lavarock', Vector((math.cos(a) * r, math.sin(a) * r, -0.6)), rr(0, TAU), (s, s, s * rr(0.6, 1.4)), C_ENV, {'noshadow': 1})

# ---------------------------------------------------------------- runic pillars with floating crystals
def pillar():
    bm = bmesh.new()
    for k, (w, h) in enumerate([(3.4, 0.4), (2.9, 0.4), (2.5, 0.3)]): add_box(bm, w, w, h, 0, 0, sum(x[1] for x in [(3.4, 0.4), (2.9, 0.4), (2.5, 0.3)][:k]) + h / 2, 0, 0.06)
    sh = bm_cyl(1.05, 0.9, 6.6, 8, 1.1); bevel(sh, 0.06); merge(bm, sh, Matrix.Rotation(math.pi / 8, 4, 'Z'))
    merge(bm, lathe([(0.95, 7.7), (1.35, 7.9), (1.45, 8.15), (1.0, 8.3), (0.75, 8.3), (0.75, 8.1), (0.0, 8.05)], 16))
    for k in range(4):
        a = k / 4 * TAU + math.pi / 4; add_cyl(bm, 0.09, 0.03, 1.4, 5, math.cos(a) * 0.95, math.sin(a) * 0.95, 8.1, Euler((math.sin(a) * -0.45, math.cos(a) * 0.45, 0)))
    finalize(bm); box_uv(bm, 1 / 3); vcolor(bm, ao_moss(moss=0, dark=0.45, h1=8))
    o = obj_from_bm('pillar', bm, M_DARK, C_ASSET); o['col'] = 'circle'; o['r'] = 1.55; o['occ'] = 1
    band = bm_cyl(1.12, 1.03, 2.0, 8, 3.0, caps=False); band_uv = band.loops.layers.uv.verify()
    for f in band.faces:
        cen = f.calc_center_median(); a0 = math.atan2(cen.y, cen.x)
        for l in f.loops:
            a = math.atan2(l.vert.co.y, l.vert.co.x)
            if a - a0 > math.pi: a -= TAU
            if a0 - a > math.pi: a += TAU
            l[band_uv].uv = (a / TAU * 2, (l.vert.co.z - 3.0) / 2.0)
    b = obj_from_bm('pillar_runes', band, M_RUNES, C_ASSET); b.rotation_euler = (0, 0, math.pi / 8); b.parent = o; b['noshadow'] = 1
    return o
def crystal():
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.55, radius2=0.0, depth=1.3)
    for v in bm.verts: v.co.z += 0.65
    b2 = bmesh.new(); bmesh.ops.create_cone(b2, cap_ends=True, segments=6, radius1=0.55, radius2=0.0, depth=0.8)
    for v in b2.verts: v.co.z = -v.co.z - 0.4 + 0.0
    merge(bm, b2); finalize(bm)
    o = obj_from_bm('crystal', bm, M_CRYST, C_ASSET); o['noshadow'] = 1; o['float'] = 1; return o
PIL, CRY = pillar(), crystal()
for i in range(8):
    a = (i / 8) * TAU + TAU / 16; x, z = math.cos(a) * 23.5, math.sin(a) * 23.5
    instance(PIL, 'pillar', P(x, z, 0), -a, 1, C_ENV); instance(PIL.children[0], 'pillar_runes', P(x, z, 0), -a + math.pi / 8, 1, C_ENV, {'noshadow': 1})
    instance(CRY, 'crystal', P(x, z, 9.4), rr(0, TAU), 1, C_ENV, {'float': 1})
    marker('TORCH', P(x, z, 9.2), C_MARK, color=0xff5a20, int=60, steady=1)

# ---------------------------------------------------------------- dragon skull over the lava (north) and giant ribs
def dragon_skull():
    bm = bmesh.new()
    cr = bmesh.new(); bmesh.ops.create_icosphere(cr, subdivisions=3, radius=3.2)
    for v in cr.verts: v.co.y *= 1.25; v.co.z *= 0.85
    displace_radial(cr, 0.35, 0.6, 3, 3); merge(bm, cr, Matrix.Translation((0, 0, 3.4)))
    sn = bmesh.new(); bmesh.ops.create_cube(sn, size=1.0); bmesh.ops.subdivide_edges(sn, edges=sn.edges[:], cuts=3, use_grid_fill=True)
    for v in sn.verts:
        t = v.co.y + 0.5; v.co.x *= 3.4 * (1 - 0.45 * t); v.co.z *= 2.2 * (1 - 0.35 * t); v.co.y = -t * 7.0
    jitter(sn, 0.12, 0.8, 5); merge(bm, sn, Matrix.Translation((0, -2.4, 2.9)))
    jw = bmesh.new(); bmesh.ops.create_cube(jw, size=1.0); bmesh.ops.subdivide_edges(jw, edges=jw.edges[:], cuts=2, use_grid_fill=True)
    for v in jw.verts:
        t = v.co.y + 0.5; v.co.x *= 3.0 * (1 - 0.5 * t); v.co.z *= 0.9; v.co.y = -t * 7.6
    merge(bm, jw, Matrix.Translation((0, -1.6, 0.7)) @ Matrix.Rotation(-0.22, 4, 'X'))
    for s in (-1, 1):
        for k in range(9):
            t = k / 8; add_cyl(bm, 0.22 - 0.08 * t, 0.0, 0.9 - 0.3 * t, 5, s * (1.55 - 0.9 * t), -3.2 - 6.2 * t, 1.75, Euler((math.pi, 0, 0)))
        prev = Vector((s * 2.1, 1.4, 5.2)); r0 = 0.75
        for k in range(8):
            t = (k + 1) / 8; nxt = Vector((s * (2.1 + 3.4 * t), 1.4 + 5.2 * t ** 1.3, 5.2 + 3.0 * math.sin(t * 2.4)))
            d = nxt - prev; rot = d.to_track_quat('Z', 'Y').to_euler(); add_cyl(bm, r0 * (1 - 0.11 * k), r0 * (1 - 0.11 * (k + 1)), d.length + 0.05, 7, prev.x, prev.y, prev.z, rot); prev = nxt
    finalize(bm); box_uv(bm, 0.3); vcolor(bm, ao_moss(moss=0, dark=0.45, h1=8))
    sk = obj_from_bm('dragon_skull', bm, M_BONE, C_ASSET)
    eb = bmesh.new()
    for s in (-1, 1): s_ = bmesh.new(); bmesh.ops.create_icosphere(s_, subdivisions=2, radius=0.6); merge(eb, s_, Matrix.Translation((s * 1.75, -3.0, 4.3)))
    e = obj_from_bm('dragon_eyes', eb, M_LAVA, C_ASSET); e.parent = sk; e['noshadow'] = 1
    return sk
def rib(seed):
    bm = bmesh.new(); prev = Vector((0, 0, 0)); r0 = 0.55
    for k in range(10):
        t = (k + 1) / 10; nxt = Vector((0, -4.8 * math.sin(t * 2.0), 11 * math.sin(t * 1.45))); d = nxt - prev
        add_cyl(bm, r0 * (1 - 0.07 * k), r0 * (1 - 0.07 * (k + 1)), d.length + 0.08, 7, prev.x, prev.y, prev.z, d.to_track_quat('Z', 'Y').to_euler()); prev = nxt
    finalize(bm); box_uv(bm, 0.5); vcolor(bm, ao_moss(moss=0, dark=0.5, h1=11))
    o = obj_from_bm(f'rib_{seed}', bm, M_BONE, C_ASSET); o['noshadow'] = 0; return o
SKULL = dragon_skull(); RIB = rib(1)
instance(SKULL, 'dragon_skull', P(0, -41, -1.2), math.pi, 1.4, C_ENV); instance(SKULL.children[0], 'dragon_eyes', P(0, -41, -1.2), math.pi, 1.4, C_ENV)
marker('TORCH', P(0, -36.5, 5.5), C_MARK, color=0xff4a10, int=90, steady=1)
for s in (-1, 1):
    for k in range(6):
        z = -18 + k * 7.5; x = s * (33.5 + 0.12 * k * k)
        instance(RIB, 'rib', P(x, z, -1.0), (0 if s > 0 else math.pi), rr(0.9, 1.15), C_ENV)
# spine across the north lava
vb = bmesh.new(); merge(vb, lathe([(0.0, -0.6), (0.9, -0.5), (1.1, 0.0), (0.9, 0.5), (0.0, 0.6)], 10), Matrix.Rotation(math.pi / 2, 4, 'X')); add_cyl(vb, 0.25, 0.05, 2.2, 5, 0, 0, 0.5); finalize(vb); box_uv(vb, 0.6); vcolor(vb, ao_moss(moss=0, dark=0.55, h1=2))
VERT = obj_from_bm('vertebra', vb, M_BONE, C_ASSET)
for k in range(12):
    t = k / 11; x = -26 + 52 * t; z = -46 - 6 * math.sin(t * math.pi); instance(VERT, 'vertebra', P(x, z, -0.2 + 0.4 * math.sin(t * 9)), math.atan2(1, 0) + 0.3 * math.cos(t * 3), rr(1.0, 1.3), C_ENV, {'noshadow': 1})

# ---------------------------------------------------------------- braziers, bones scattered on the floor
def brazier():
    bm = lathe([(0.0, 1.2), (0.9, 1.25), (1.2, 1.6), (1.25, 1.75), (1.0, 1.7), (0.0, 1.55)], 18)
    merge(bm, lathe([(0.9, 0.0), (0.7, 0.2), (0.35, 0.35), (0.3, 1.0), (0.5, 1.2)], 12))
    finalize(bm); box_uv(bm, 1); vcolor(bm, ao_moss(moss=0, dark=0.6, h1=1.7))
    o = obj_from_bm('brazier', bm, M_IRON, C_ASSET); o['col'] = 'circle'; o['r'] = 1.3; return o
BR = brazier()
for (x, z) in [(-9, -20), (9, -20), (-16, 14), (16, 14)]:
    instance(BR, 'brazier', P(x, z, 0), 0, 1, C_ENV); marker('TORCH', P(x, z, 2.0), C_MARK, color=0xff7a30, int=40, flame=2.0)
def bones(seed):
    rs = random.Random(seed); bm = bmesh.new()
    for i in range(6): a = rs.random() * TAU; add_cyl(bm, 0.07, 0.06, rs.uniform(0.8, 1.6), 5, rs.uniform(-0.6, 0.6), rs.uniform(-0.6, 0.6), 0.07, Euler((math.pi / 2, 0, a)))
    s = bmesh.new(); bmesh.ops.create_icosphere(s, subdivisions=2, radius=0.28)
    for v in s.verts: v.co.y *= 1.3
    merge(bm, s, Matrix.Translation((rs.uniform(-0.5, 0.5), rs.uniform(-0.5, 0.5), 0.2)))
    finalize(bm); box_uv(bm, 1.5); vcolor(bm, ao_moss(moss=0, dark=0.6, h1=0.5)); o = obj_from_bm(f'bones_{seed}', bm, M_BONE, C_ASSET); o['noshadow'] = 1; return o
BONES = [bones(i) for i in range(3)]
for i in range(26):
    a, r = rr(0, TAU), rr(16, 28.5); instance(R.choice(BONES), 'bones', P(math.cos(a) * r, math.sin(a) * r, 0), rr(0, TAU), rr(0.8, 1.3), C_ENV)

marker('SPAWN', P(*START), C_MARK); marker('BOSS', P(*BOSS), C_MARK)
result = stats()

export_glb(os.path.join(BASE, 'sanctum.glb'))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BASE, 'blend', 'sanctum.blend'))
result = dict(stats(), glb=os.path.getsize(os.path.join(BASE, 'sanctum.glb')))

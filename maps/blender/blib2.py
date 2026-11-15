# =====================================================================================
#  Kroniky Popola – Blender knižnica v2 (mapy v štýle referencie)
#  Súradnice v skriptoch sú HERNÉ (x = východ, z = juh, y = výška). P() ich prevedie do
#  Blenderu (Z-hore), export do glTF (Y-hore) ich vráti späť na herné osi.
#
#  PRAVIDLO VÝHĽADU: kamera hry sa pozerá z juhu pod uhlom 50°. Predmet vysoký h zakryje
#  zem do vzdialenosti 0,84·h SEVERNE od seba. View.ok() preto odmietne všetko vysoké,
#  čo by stálo južne od pochôdznej plochy – postava sa nikdy nedostane „za“ objekt.
#
#  Značky pre hru (empties → glTF extras → userData):
#    SPAWN, SHOW, PORTAL, BOSS, PACK types=…, MINIBOSS, CHEST, REGION, TORCH, LOBBY, WAYPOINT,
#    FOUNTAIN, MERCHANT, COL (kruh), COLBOX,
#    AREA w,d (obdĺžnik)  ·  AREAC dx,dz,r (kapsula od značky po značku+dx,dz) = pochôdzna plocha
#  Vlastnosti objektov:  col="circle" r=…  |  col="box"   ·  occ, noshadow, decal, ground
#    dest="tree|wood|stone|bush"  hp=…  h=…   → zničiteľný objekt (oheň / ľad / poškodenie)
#  Materiály podľa mena:  *GROUND* zem · DECAL_* priehľadná nálepka · CUT_* výrez (alphaTest)
#    FX_BEAM slnečný lúč (aditívny) · *LEAF*/CUT_* = lístie stromu · *PULSE* pulzujúce svetlo
# =====================================================================================
import bpy, bmesh, math, random, os
from mathutils import Vector, Matrix, noise, Euler

TAU = math.pi * 2
ROOT = globals().get('ROOT') or r'A:\drake clone\maps'
TEX_DIR = os.path.join(ROOT, 'textures')
CAM_K = 1.0 / math.tan(math.radians(50))     # 0.84 – dĺžka „tieňa výhľadu“ na meter výšky
clamp01 = lambda v: 0.0 if v < 0 else 1.0 if v > 1 else v
def sstep(a, b, x):
    t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t)
def lerp3(a, b, t): return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)

def P(x, z, y=0.0):
    return Vector((x, -z, y))

def reset_scene():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves, bpy.data.cameras, bpy.data.lights, bpy.data.collections):
        for d in list(coll):
            try: coll.remove(d)
            except Exception: pass
    _img_cache.clear(); MAT.clear(); BLOCKS.clear()

def collection(name, hidden=False):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(c)
    if hidden: c.hide_viewport = True; c.hide_render = True
    return c

# ------------------------------------------------------------------ materials
_img_cache = {}
def image(name):
    if name in _img_cache: return _img_cache[name]
    img = bpy.data.images.load(os.path.join(TEX_DIR, name + '.png'), check_existing=True)
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
            if hasattr(m, 'surface_render_method'): m.surface_render_method = 'DITHERED' if name.startswith('CUT_') else 'BLENDED'
            elif hasattr(m, 'blend_method'): m.blend_method = 'CLIP' if name.startswith('CUT_') else 'BLEND'
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
def obj_from_bm(name, bm, mats, coll=None, loc=None, rot=0.0, scale=None, props=None, smooth=False):
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
    for p in me.polygons: p.use_smooth = smooth
    return o

def instance(src, name, loc, rot=0.0, scale=1.0, coll=None, props=None):
    """linked duplicate – rovnaké dáta, hra z nich spraví GPU inštancie"""
    o = bpy.data.objects.new(name, src.data); (coll or bpy.context.scene.collection).objects.link(o)
    o.location = loc; o.rotation_euler = (0, 0, rot); o.scale = scale if hasattr(scale, '__len__') else (scale, scale, scale)
    for k in src.keys():
        if k not in ('_RNA_UI',) and not k.startswith('v_'): o[k] = src[k]
    for k, v in (props or {}).items(): o[k] = v
    return o

def setp(o, **kw):
    for k, v in kw.items(): o[k] = v
    return o

def measure(o):
    """rozmery assetu pre kontrolu výhľadu (v_* sa do hry neexportujú)"""
    vs = o.data.vertices
    if len(vs):
        xs = [v.co.x for v in vs]; ys = [v.co.y for v in vs]; zs = [v.co.z for v in vs]
        o['v_h'] = max(zs); o['v_r'] = max(math.hypot(v.co.x, v.co.y) for v in vs); o['v_bb'] = (min(xs), max(xs), min(ys), max(ys))
    return o

def marker(name, loc, coll=None, **props):
    e = bpy.data.objects.new(name, None); e.empty_display_type = 'SPHERE'; e.empty_display_size = 0.6; e.location = loc
    (coll or bpy.context.scene.collection).objects.link(e)
    e['marker'] = name
    for k, v in props.items(): e[k] = v
    return e

def box_uv(bm, scale=0.25, off=(0, 0)):
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
    lay = bm.loops.layers.color.get('Col') or bm.loops.layers.color.new('Col')
    for f in bm.faces:
        for l in f.loops:
            r, g, b = fn(l.vert.co, f.normal); l[lay] = (clamp01(r), clamp01(g), clamp01(b), 1.0)

def paint(bm, rgb, ao=0.0, h=1.0):
    """jednofarebný diel (materiál 'plain'): farba × jemné zatienenie odspodu"""
    vcolor(bm, lambda co, n: tuple(c * (1 - ao + ao * clamp01(co.z / max(0.01, h))) * (0.9 + 0.1 * max(0.0, n.z)) for c in rgb))
    return bm

def ao_moss(top=(0.55, 0.75, 0.35), base=(1, 1, 1), h0=0.0, h1=1.0, dark=0.55, moss=0.6):
    def f(co, n):
        k = min(1, max(0, (co.z - h0) / max(0.01, h1 - h0))); a = dark + (1 - dark) * k
        m = max(0.0, min(1.0, (n.z - 0.45) / 0.4)) * moss * (0.6 + 0.4 * noise.noise(co * 1.7))
        return tuple((base[i] * (1 - m) + top[i] * m) * a for i in range(3))
    return f

def leaf_shade(z0, z1, lit=(1.0, 0.98, 0.70), dark=(0.26, 0.42, 0.40)):
    """svetlé žltozelené vrchy, tmavé modrozelené spodky"""
    def f(co, n):
        hk = clamp01((co.z - z0) / max(0.01, z1 - z0)); k = clamp01(0.5 * hk + 0.5 * max(0.0, n.z * 0.85 + 0.15))
        t = 0.5 + 0.5 * noise.noise(co * 0.4); c = lerp3(dark, lit, k ** 1.2)
        return (c[0] * (0.92 + 0.08 * t), c[1] * (0.9 + 0.1 * t), c[2] * (1.0 - 0.25 * t * k))
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

def merge(dst, src, M=None):
    me = bpy.data.meshes.new('_tmp'); src.to_mesh(me); src.free()
    if M is not None: me.transform(M)
    dst.from_mesh(me); bpy.data.meshes.remove(me)

def add_box(bm, sx, sy, sz, cx=0, cy=0, cz=0, rz=0.0, bev=0.0, rot=None):
    tmp = bmesh.new(); bmesh.ops.create_cube(tmp, size=1.0)
    for v in tmp.verts: v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if bev: bevel(tmp, bev)
    M = Matrix.Translation((cx, cy, cz)) @ (rot.to_matrix().to_4x4() if rot is not None else Matrix.Rotation(rz, 4, 'Z'))
    merge(bm, tmp, M)

def bm_cyl(r1, r2, h, seg=8, z0=0.0, caps=True):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
    for v in bm.verts: v.co.z += h / 2 + z0
    return bm

def add_cyl(bm, r1, r2, h, seg=8, cx=0, cy=0, cz=0, rot=None):
    t = bm_cyl(r1, r2, h, seg)
    M = Matrix.Translation((cx, cy, cz)) @ (rot.to_matrix().to_4x4() if rot is not None else Matrix.Identity(4))
    merge(bm, t, M)

def add_beam(bm, a, b, w=0.14, d=None):
    """hranol od bodu a po bod b"""
    a, b = Vector(a), Vector(b); v = b - a; L = v.length
    if L < 1e-5: return
    tmp = bmesh.new(); bmesh.ops.create_cube(tmp, size=1.0)
    for q in tmp.verts: q.co = Vector((q.co.x * w, q.co.y * (d or w), (q.co.z + 0.5) * L))
    merge(bm, tmp, Matrix.Translation(a) @ Vector((0, 0, 1)).rotation_difference(v.normalized()).to_matrix().to_4x4())

def lathe(profile, seg=16, caps=True):
    bm = bmesh.new(); rings = []
    for (r, z) in profile:
        rings.append([bm.verts.new((math.cos(i / seg * TAU) * r, math.sin(i / seg * TAU) * r, z)) for i in range(seg)])
    for a, b in zip(rings, rings[1:]):
        for i in range(seg): bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
    if caps and profile[0][0] > 0.001: bm.faces.new(list(reversed(rings[0])))
    if caps and profile[-1][0] > 0.001: bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def finalize(bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); return bm

ATLAS = {'cluster': (0.0, 0.5, 0.5, 1.0), 'grass': (0.5, 0.5, 1.0, 1.0), 'fern': (0.0, 0.0, 0.5, 0.5), 'flower': (0.5, 0.0, 1.0, 0.5)}
def add_quad(bm, p0, p1, p2, p3, cell, inset=0.012):
    """štvorec s UV do bunky atlasu (p0 vľavo dole, p1 vpravo dole, p2 vpravo hore, p3 vľavo hore)"""
    u0, v0, u1, v1 = ATLAS[cell] if isinstance(cell, str) else cell
    u0 += inset; v0 += inset; u1 -= inset; v1 -= inset
    uv = bm.loops.layers.uv.verify(); vs = [bm.verts.new(p) for p in (p0, p1, p2, p3)]; f = bm.faces.new(vs)
    for l, t in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))): l[uv].uv = t
    return f

def add_card(bm, pos, normal, size, cell='cluster', roll=0.0):
    n = Vector(normal).normalized(); t = n.cross(Vector((0, 0, 1)))
    if t.length < 1e-3: t = Vector((1, 0, 0))
    t.normalize(); b = n.cross(t).normalized()
    c, s = math.cos(roll), math.sin(roll); t2 = t * c + b * s; b2 = b * c - t * s; h = size / 2; p = Vector(pos)
    add_quad(bm, p - t2 * h - b2 * h, p + t2 * h - b2 * h, p + t2 * h + b2 * h, p - t2 * h + b2 * h, cell)

def add_cross(bm, cell, w, h, n=2, x=0.0, y=0.0, z=0.0, rot=0.0, lean=0.0):
    """rastlina z n skrížených zvislých plôch (spodok na zemi)"""
    for i in range(n):
        a = rot + i / n * math.pi; dx, dy = math.cos(a) * w / 2, math.sin(a) * w / 2; lx, ly = -math.sin(a) * lean, math.cos(a) * lean
        add_quad(bm, (x - dx, y - dy, z), (x + dx, y + dy, z), (x + dx + lx, y + dy + ly, z + h), (x - dx + lx, y - dy + ly, z + h), cell)

# ------------------------------------------------------------------ register materiálov + skladanie dielov
MAT = {}
def defmat(key, mat, uv=None, vc=None, smooth=False):
    MAT[key] = {'mat': mat, 'uv': uv, 'vc': vc, 'smooth': smooth}

def init_materials():
    M = material
    defmat('cobble', M('M_GROUND_COBBLE', 'r_cobble', 'r_cobble_n', rough=0.82), 1 / 6)
    defmat('grass', M('M_GROUND_GRASS', 'r_grass', rough=1.0), 1 / 7)
    defmat('dirt', M('M_GROUND_DIRT', 'r_dirt', rough=1.0), 1 / 6)
    defmat('stone', M('M_STONEWALL', 'r_stonewall', 'r_stonewall_n', rough=0.9), 0.4, lambda H: ao_moss(top=(0.50, 0.66, 0.30), moss=0.35, dark=0.55, h1=min(H, 3.0)))
    defmat('rock', M('M_ROCK', 'r_rock', 'r_rock_n', rough=0.92), 0.28, lambda H: ao_moss(top=(0.46, 0.66, 0.24), moss=0.8, dark=0.5, h1=H))
    defmat('plaster', M('M_PLASTER', 'r_plaster', rough=0.95), 0.25, lambda H: ao_moss(moss=0, dark=0.66, h1=H))
    defmat('timber', M('M_TIMBER', 'r_planks', color=(0.50, 0.40, 0.36), rough=0.8), 0.5, lambda H: ao_moss(moss=0, dark=0.6, h1=min(H, 3.0)))
    defmat('wood', M('M_WOOD', 'r_planks', rough=0.8), 0.5, lambda H: ao_moss(moss=0, dark=0.6, h1=min(H, 2.5)))
    defmat('roof', M('M_ROOF', 'r_roof', 'r_roof_n', rough=0.85), None)
    defmat('thatch', M('M_THATCH', 'r_thatch', rough=1.0), None)
    defmat('bark', M('M_BARK', 'r_bark', 'r_bark_n', rough=0.95), None)
    defmat('leaf', M('M_LEAVES', 'r_leaves', rough=0.8), 0.16, None, True)
    defmat('leafg', M('M_LEAVES_GOLD', 'r_leaves_gold', rough=0.8), 0.16, None, True)
    defmat('cut', M('CUT_PLANTS', 'r_plants', rough=0.85, alpha=True), None)
    defmat('plain', M('M_PAINT', None, rough=0.85), None)
    defmat('cloth', M('M_CLOTH', None, rough=0.95), None)
    defmat('iron', M('M_IRON', 'iron', rough=0.5, metal=0.8), 0.5)
    defmat('glass', M('M_WINDOW_PULSE', None, color=(0.25, 0.15, 0.05), emis_color=(1.0, 0.66, 0.28), emis_strength=1.5, vcol=False), None)
    defmat('ember', M('M_EMBER_PULSE', None, color=(0.3, 0.08, 0.02), emis_color=(1.0, 0.38, 0.08), emis_strength=3.0, vcol=False), None)
    defmat('rune', M('M_RUNE_PULSE', None, color=(0.1, 0.2, 0.4), emis_color=(0.35, 0.7, 1.0), emis_strength=2.5, vcol=False), None)
    defmat('glow', M('M_GLOWSHROOM', None, color=(0.6, 1.0, 0.9), emis_color=(0.25, 1.0, 0.85), emis_strength=1.1, vcol=False), None)
    defmat('gold', M('M_GOLD', None, color=(0.85, 0.65, 0.3), rough=0.35, metal=0.9, vcol=False), None)
    defmat('dark', M('M_DARK', None, color=(0.03, 0.025, 0.02), rough=1.0, vcol=False), None)
    defmat('water', M('M_WATER', 'water', color=(0.7, 0.9, 1.0), rough=0.08, metal=0.1, emis='water', emis_strength=0.25, vcol=False), 0.2)
    defmat('swamp', M('M_SWAMP_WATER', 'r_swamp', rough=0.12, metal=0.0, vcol=False), 1 / 10)
    for c in ('red', 'blue', 'green'): defmat('awn_' + c, M('M_AWNING_' + c, 'awning_' + c, rough=0.9, vcol=True), None)
    defmat('banner', M('M_BANNER', 'banner', rough=0.95), None)
    defmat('droad', M('DECAL_ROAD', 'DECAL_r_road', rough=1.0, alpha=True, vcol=True), None)
    defmat('ddirt', M('DECAL_DIRT', 'DECAL_r_dirt', rough=1.0, alpha=True, vcol=False), None)
    defmat('dgrass', M('DECAL_GRASS', 'DECAL_r_grass', rough=1.0, alpha=True, vcol=False), None)
    bm_ = bpy.data.materials.new('FX_BEAM'); bm_.use_nodes = True; nt = bm_.node_tree; nt.nodes.clear()
    o_ = nt.nodes.new('ShaderNodeOutputMaterial'); a_ = nt.nodes.new('ShaderNodeAddShader'); t_ = nt.nodes.new('ShaderNodeBsdfTransparent'); e_ = nt.nodes.new('ShaderNodeEmission'); v_ = nt.nodes.new('ShaderNodeVertexColor'); v_.layer_name = 'Col'
    nt.links.new(v_.outputs['Color'], e_.inputs['Color']); nt.links.new(t_.outputs[0], a_.inputs[0]); nt.links.new(e_.outputs[0], a_.inputs[1]); nt.links.new(a_.outputs[0], o_.inputs['Surface'])
    if hasattr(bm_, 'surface_render_method'): bm_.surface_render_method = 'BLENDED'
    defmat('beam', bm_, None)

NO_RECALC = {'cut', 'plain', 'cloth', 'awn_red', 'awn_blue', 'awn_green', 'banner', 'roof', 'thatch'}
class Parts:
    """jeden objekt z viacerých materiálov: B.box('wood', …), B.add('leaf', bm) … B.build('meno')"""
    def __init__(s): s.b = {}; s.keys = []
    def bm(s, k):
        if k not in s.b: s.b[k] = bmesh.new(); s.keys.append(k)
        return s.b[k]
    def box(s, k, sx, sy, sz, cx=0, cy=0, cz=0, rz=0.0, bev=0.0, rot=None): add_box(s.bm(k), sx, sy, sz, cx, cy, cz, rz, bev, rot)
    def cyl(s, k, r1, r2, h, seg=8, cx=0, cy=0, cz=0, rot=None): add_cyl(s.bm(k), r1, r2, h, seg, cx, cy, cz, rot)
    def beam(s, k, a, b, w=0.14, d=None): add_beam(s.bm(k), a, b, w, d)
    def add(s, k, src, M=None): merge(s.bm(k), src, M)
    def col(s, src, rgb, ao=0.25, M=None, key='plain', recalc=True):
        """diel vo farbe (bez textúry); key='cloth' = obojstranná látka"""
        zs = [v.co.z for v in src.verts]
        if recalc: finalize(src)
        else: src.normal_update()
        paint(src, rgb, ao, max(zs) if zs else 1.0); merge(s.bm(key), src, M)
    def shift(s, dx=0.0, dy=0.0, dz=0.0, rz=0.0):
        M = Matrix.Translation((dx, dy, dz)) @ Matrix.Rotation(rz, 4, 'Z')
        for k in s.keys: bmesh.ops.transform(s.b[k], matrix=M, verts=s.b[k].verts)
        return s
    def take(s, other, M=None):
        for k in other.keys: merge(s.bm(k), other.b[k], M)
    def height(s): return max((v.co.z for k in s.keys for v in s.b[k].verts), default=1.0)
    def build(s, name, coll=None, props=None, finish=None):
        out = bmesh.new(); counts = []; mats = []; H = s.height()
        for k in s.keys:
            b = s.b[k]; d = MAT[k]
            if k not in NO_RECALC: finalize(b)
            if d['uv']: box_uv(b, d['uv'])
            fn = (finish or {}).get(k) or (d['vc'](H) if d['vc'] else None)
            if fn: vcolor(b, fn)
            elif b.loops.layers.color.get('Col') is None: vcolor(b, lambda co, n: (1.0, 1.0, 1.0))
            n0 = len(out.faces); merge(out, b); counts.append(len(out.faces) - n0); mats.append(d['mat'])
        o = obj_from_bm(name, out, mats, coll or C_ASSET, props=props); i0 = 0
        for i, (k, c) in enumerate(zip(s.keys, counts)):
            sm = MAT[k]['smooth']
            for p in o.data.polygons[i0:i0 + c]: p.material_index = i; p.use_smooth = sm
            i0 += c
        return measure(o)

# ------------------------------------------------------------------ pochôdzna plocha + pravidlo výhľadu
class Areas:
    def __init__(s): s.rects = []; s.caps = []
    def rect(s, x0, x1, z0, z1): s.rects.append((x0, x1, z0, z1)); return s
    def cap(s, ax, az, bx, bz, r): s.caps.append((ax, az, bx, bz, r)); return s
    def circle(s, x, z, r): return s.cap(x, z, x, z, r)
    def path(s, pts, r):
        for (a, b) in zip(pts, pts[1:]): s.cap(a[0], a[1], b[0], b[1], r if not hasattr(r, '__call__') else r(a, b))
        return s
    def sd(s, x, z):
        """vzdialenosť od plochy (záporná vnútri)"""
        best = 1e9
        for (x0, x1, z0, z1) in s.rects:
            dx = max(x0 - x, x - x1); dz = max(z0 - z, z - z1)
            d = math.hypot(max(dx, 0), max(dz, 0)) + min(max(dx, dz), 0)
            if d < best: best = d
        for (ax, az, bx, bz, r) in s.caps:
            vx, vz = bx - ax, bz - az; L2 = vx * vx + vz * vz
            t = 0.0 if L2 < 1e-9 else clamp01(((x - ax) * vx + (z - az) * vz) / L2)
            d = math.hypot(x - ax - vx * t, z - az - vz * t) - r
            if d < best: best = d
        return best
    def bake(s, pad=45.0, step=0.5):
        """predpočíta vzdialenostné pole (numpy) – rýchle dotazy sdf(x,z)"""
        import numpy as np
        x0, x1, z0, z1 = s.bounds(pad); s.g0 = (x0, z0); s.gs = step; nx = int((x1 - x0) / step) + 1; nz = int((z1 - z0) / step) + 1
        X, Z = np.meshgrid(x0 + np.arange(nx) * step, z0 + np.arange(nz) * step); best = np.full(X.shape, 1e9)
        for (a0, a1, b0, b1) in s.rects:
            dx = np.maximum(a0 - X, X - a1); dz = np.maximum(b0 - Z, Z - b1)
            best = np.minimum(best, np.hypot(np.maximum(dx, 0), np.maximum(dz, 0)) + np.minimum(np.maximum(dx, dz), 0))
        for (ax, az, bx, bz, r) in s.caps:
            vx, vz = bx - ax, bz - az; L2 = vx * vx + vz * vz
            t = np.zeros(X.shape) if L2 < 1e-9 else np.clip(((X - ax) * vx + (Z - az) * vz) / L2, 0, 1)
            best = np.minimum(best, np.hypot(X - ax - vx * t, Z - az - vz * t) - r)
        s.grid = best.tolist(); s.gn = (nx, nz); return s
    def sdf(s, x, z):
        """rýchla vzdialenosť z predpočítaného poľa (bilineárne)"""
        g = getattr(s, 'grid', None)
        if g is None: return s.sd(x, z)
        fx = (x - s.g0[0]) / s.gs; fz = (z - s.g0[1]) / s.gs; nx, nz = s.gn
        if fx < 0 or fz < 0 or fx >= nx - 1 or fz >= nz - 1: return s.sd(x, z)
        i = int(fx); j = int(fz); u = fx - i; v = fz - j; r0 = g[j]; r1 = g[j + 1]
        return (r0[i] * (1 - u) + r0[i + 1] * u) * (1 - v) + (r1[i] * (1 - u) + r1[i + 1] * u) * v
    def inside(s, x, z, m=0.0): return s.sdf(x, z) < -m
    def bounds(s, pad=0.0):
        xs = [v for r in s.rects for v in r[:2]] + [v for c in s.caps for v in (c[0] - c[4], c[0] + c[4], c[2] - c[4], c[2] + c[4])]
        zs = [v for r in s.rects for v in r[2:]] + [v for c in s.caps for v in (c[1] - c[4], c[1] + c[4], c[3] - c[4], c[3] + c[4])]
        return min(xs) - pad, max(xs) + pad, min(zs) - pad, max(zs) + pad
    def markers(s, coll):
        for (x0, x1, z0, z1) in s.rects: marker('AREA', P((x0 + x1) / 2, (z0 + z1) / 2), coll, w=x1 - x0, d=z1 - z0)
        for (ax, az, bx, bz, r) in s.caps: marker('AREAC', P(ax, az), coll, dx=bx - ax, dz=bz - az, r=r)

class View:
    """kontrola: nič vysoké nesmie stáť južne od pochôdznej plochy (kamera 50° z juhu).
    feet = od akej výšky tela nesmie byť postava zakrytá (0,6 m = najviac členky na samom okraji)"""
    def __init__(s, areas, feet=0.6, head=1.8, pad=0.4, low=1.5): s.A = areas; s.feet = feet; s.head = head; s.pad = pad; s.low = low; s.warn = []
    def _hit(s, xa, xb, za, zb, cx=0.0, cz=0.0, skip=0.0):
        zz = za
        while zz <= zb + 1e-6:
            xx = xa
            while xx <= xb + 1e-6:
                if s.A.inside(xx, zz, 0.2) and (skip <= 0 or math.hypot(xx - cx, zz - cz) > skip): return True
                xx += 0.6
            zz += 0.6
        return False
    def ok(s, x, z, shapes, skip=0.0):
        """shapes: [(R, y_spodok, y_vrch)] – valce nad bodom (x,z); skip = polomer vlastnej kolízie (tam postava nestojí)"""
        for (R, yb, yt) in shapes:
            if yt <= s.low: continue
            if s._hit(x - R - s.pad, x + R + s.pad, z - R - CAM_K * max(0.0, yt - s.feet), z + R - CAM_K * max(0.0, yb - s.head), x, z, skip): return False
        return True
    def box_ok(s, x0, x1, z0, z1, h):
        """kváder (pôdorys + výška): zakrýva pás severne od seba"""
        return h <= s.low or not s._hit(x0 - s.pad, x1 + s.pad, z0 - CAM_K * max(0.0, h - s.feet), z0 - 0.3)

def shapes_of(o, s=1.0):
    """tvary pre kontrolu výhľadu z vlastností assetu (strom: kmeň + koruna, inak valec podľa výšky)"""
    if 'v_R' in o.keys(): return [(o['v_tr'] * s, 0.0, o['v_b'] * s), (o['v_R'] * s, o['v_b'] * s, o['v_t'] * s)]
    if 'v_sh' in o.keys(): q = list(o['v_sh']); return [(q[i] * s, q[i + 1] * s, q[i + 2] * s) for i in range(0, len(q), 3)]
    return [(min(o.get('v_r', 1.0), 3.0) * s, 0.0, o.get('v_h', 2.0) * s)]

VIEW = None; C_ENV = None; C_MARK = None; BLOCKS = []
def blocked(x, z, m=1.0):
    """je bod v pôdoryse niektorej budovy (umiestnenej cez put(..., box=True))?"""
    return any(a0 - m < x < a1 + m and b0 - m < z < b1 + m for (a0, a1, b0, b1) in BLOCKS)
def put(src, x, z, rot=0.0, s=1.0, y=0.0, check=True, force=False, name=None, box=False, **props):
    """umiestni inštanciu assetu; check = pravidlo výhľadu (vráti None, ak by objekt zakrýval postavu)"""
    sc = max(s) if hasattr(s, '__len__') else s; bb = None
    if box and 'v_bb' in src.keys():
        a0, a1, b0, b1 = src['v_bb']; c, sn = math.cos(rot), math.sin(rot)
        cs = [(px * c - py * sn, px * sn + py * c) for px in (a0 * sc, a1 * sc) for py in (b0 * sc, b1 * sc)]
        bb = (x + min(p[0] for p in cs), x + max(p[0] for p in cs), z - max(p[1] for p in cs), z - min(p[1] for p in cs)); BLOCKS.append(bb)
    if check and VIEW is not None and not src.get('v_thin'):
        if bb: good = VIEW.box_ok(bb[0], bb[1], bb[2], bb[3], src.get('v_h', 2.0) * sc + y)
        else: good = VIEW.ok(x, z, [(R_, yb + y, yt + y) for (R_, yb, yt) in shapes_of(src, sc)], src.get('r', 0.0) * sc if src.get('col') == 'circle' else 0.0)
        if not good:
            if not force: return None
            VIEW.warn.append((src.name, round(x, 1), round(z, 1)))
    o = instance(src, name or src.name.rsplit('_', 1)[0], P(x, z, y), rot, s, C_ENV, props)
    if sc != 1.0:
        if 'r' in src.keys(): o['r'] = round(src['r'] * sc, 2)
        if 'h' in src.keys(): o['h'] = round(src['h'] * sc, 2)
        if 'hp' in src.keys(): o['hp'] = int(src['hp'] * sc)
    return o

# ------------------------------------------------------------------ terén, cesty, rozmiestňovanie
def terrain(name, x0, x1, z0, z1, step, hfn, cfn, mfn, mats, coll, uvs=1 / 6):
    """výšková mapa v herných súradniciach; mfn(x,z) → index materiálu, cfn(x,z,y) → farba vrcholu"""
    nx = int(round((x1 - x0) / step)); nz = int(round((z1 - z0) / step)); bm = bmesh.new(); V = []
    for j in range(nz + 1):
        row = []
        for i in range(nx + 1):
            x = x0 + i * step; z = z0 + j * step; row.append(bm.verts.new(P(x, z, hfn(x, z))))
        V.append(row)
    uv = bm.loops.layers.uv.verify(); lay = bm.loops.layers.color.new('Col'); fm = []
    for j in range(nz):
        for i in range(nx):
            f = bm.faces.new((V[j + 1][i], V[j + 1][i + 1], V[j][i + 1], V[j][i])); fm.append(mfn(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step))
    for f in bm.faces:
        for l in f.loops:
            c = l.vert.co; l[uv].uv = (c.x * uvs, c.y * uvs); r, g, b = cfn(c.x, -c.y, c.z); l[lay] = (clamp01(r), clamp01(g), clamp01(b), 1.0)
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0: f.normal_flip()
    o = obj_from_bm(name, bm, mats, coll, props={'ground': 1}, smooth=True)
    for p, m in zip(o.data.polygons, fm): p.material_index = m
    return o

def smooth_path(pts, step=1.0):
    """Catmull-Rom cez body → husté body po ~step metroch"""
    P_ = [pts[0]] + list(pts) + [pts[-1]]; out = []
    for i in range(1, len(P_) - 2):
        p0, p1, p2, p3 = [Vector((p[0], p[1])) for p in P_[i - 1:i + 3]]; n = max(2, int((p2 - p1).length / step))
        for k in range(n):
            t = k / n; t2 = t * t; t3 = t2 * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(Vector((pts[-1][0], pts[-1][1]))); return [(v.x, v.y) for v in out]

def ribbon(name, pts, width, key, coll, y=0.035, seed=0, wvar=0.18, tile=None, tint=(1, 1, 1)):
    """pás cesty pozdĺž bodov (herné x,z); UV u beží po dĺžke"""
    sp = smooth_path(pts, 1.0); bm = bmesh.new(); uv = bm.loops.layers.uv.verify(); lay = bm.loops.layers.color.new('Col'); prev = None; dist = 0.0; tile = tile or width * 2
    for i, (x, z) in enumerate(sp):
        a = sp[max(0, i - 1)]; b = sp[min(len(sp) - 1, i + 1)]; tx, tz = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, tz) or 1; nx, nz = -tz / L, tx / L
        w = width / 2 * (1 + wvar * noise.noise(Vector((x * 0.11, z * 0.11, seed))))
        if i: dist += math.hypot(x - sp[i - 1][0], z - sp[i - 1][1])
        cur = (bm.verts.new(P(x - nx * w, z - nz * w, y)), bm.verts.new(P(x + nx * w, z + nz * w, y)), dist / tile)
        if prev:
            f = bm.faces.new((prev[0], prev[1], cur[1], cur[0]))
            for l, t in zip(f.loops, ((prev[2], 0), (prev[2], 1), (cur[2], 1), (cur[2], 0))):
                l[uv].uv = t; k = 0.9 + 0.1 * noise.noise(Vector((l.vert.co.x * 0.2, l.vert.co.y * 0.2, 3))); l[lay] = (tint[0] * k, tint[1] * k, tint[2] * k, 1)
        prev = cur
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0: f.normal_flip()
    return obj_from_bm(name, bm, MAT[key]['mat'], coll, props={'noshadow': 1, 'decal': 1})

def decal(key, x, z, s, coll, y=0.03, rot=None, sy=None, name='decal'):
    bmq = bmesh.new(); bmesh.ops.create_grid(bmq, x_segments=1, y_segments=1, size=0.5); box_uv(bmq, 1.0, (0.5, 0.5))
    return obj_from_bm(name, bmq, MAT[key]['mat'], coll, P(x, z, y), R.random() * TAU if rot is None else rot, (s, sy or s, 1), {'noshadow': 1, 'decal': 1})

class Scatter:
    """rozmiestňovanie s minimálnymi rozstupmi (mriežkový hash)"""
    def __init__(s, cell=4.0): s.c = cell; s.g = {}
    def free(s, x, z, d):
        cx, cz = int(math.floor(x / s.c)), int(math.floor(z / s.c)); n = int(d / s.c) + 1
        for i in range(cx - n, cx + n + 1):
            for j in range(cz - n, cz + n + 1):
                for (a, b, r) in s.g.get((i, j), ()):
                    if math.hypot(x - a, z - b) < d + r: return False
        return True
    def add(s, x, z, r=0.0): s.g.setdefault((int(math.floor(x / s.c)), int(math.floor(z / s.c))), []).append((x, z, r))

def sunbeam(x, z, coll, h=13.0, w=2.2, sun=(0.5, -0.25), k=1.0, name='sunbeam'):
    """šikmý svetelný lúč (2 skrížené plochy, farba vo vrcholoch – v hre aditívne)"""
    bm = bmesh.new(); lay = bm.loops.layers.color.new('Col'); top = Vector((sun[0] * h, -sun[1] * h, h))
    for a in (0.0, math.pi / 2):
        sx, sy = math.cos(a) * w / 2, math.sin(a) * w / 2; cols = 4; rows = 5; G = []
        for j in range(rows + 1):
            t = j / rows; c = top * t; G.append([bm.verts.new((c.x + sx * (i / cols * 2 - 1) * (0.8 + 0.5 * t), c.y + sy * (i / cols * 2 - 1) * (0.8 + 0.5 * t), c.z)) for i in range(cols + 1)])
        for j in range(rows):
            for i in range(cols):
                f = bm.faces.new((G[j][i], G[j][i + 1], G[j + 1][i + 1], G[j + 1][i]))
                for l, (jj, ii) in zip(f.loops, ((j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i))):
                    e = 1 - abs(ii / cols * 2 - 1); tt = jj / rows; v = k * e * e * math.sin(min(1, tt * 1.15 + 0.08) * math.pi) ** 0.8 * 0.55
                    l[lay] = (v, v * 0.88, v * 0.6, 1)
    return obj_from_bm(name, bm, MAT['beam']['mat'], coll, P(x, z, 0), props={'noshadow': 1, 'beam': 1})

# ------------------------------------------------------------------ príroda
def tree(seed, h=10.0, R=4.0, tr=0.5, blobs=7, lean=0.4, leaf='leaf', bare=False, cards=5, name='tree', lit=(1.0, 0.98, 0.70), hp=None):
    rs = random.Random(seed); B = Parts(); th = h * 0.5; ph = rs.random() * TAU; lx, ly = math.cos(ph) * lean, math.sin(ph) * lean
    def bend(z):
        k = max(0.0, z) / h; return (lx * math.sin(k * 2.6) + lean * 0.25 * math.sin(k * 6 + ph), ly * math.sin(k * 2.6) + lean * 0.25 * math.cos(k * 5 + ph))
    t = lathe([(tr * 2.1, -0.35), (tr * 1.55, 0.25), (tr * 1.14, 0.9), (tr, 1.7), (tr * 0.92, th * 0.7), (tr * 0.78, th), (tr * 0.5, h * 0.68), (tr * 0.2, h * 0.8)], 10)
    for v in t.verts:
        a = math.atan2(v.co.y, v.co.x); k = max(0.0, 1 - max(0.0, v.co.z) / 1.2); f = 1 + k * (0.30 * math.sin(a * 5 + seed) + 0.18 * math.sin(a * 3 + seed * 2.1))
        v.co.x *= f; v.co.y *= f
    cyl_uv(t, 2.0, 0.22)
    for v in t.verts: bx, by = bend(v.co.z); v.co.x += bx; v.co.y += by
    jitter(t, 0.04, 1.4, seed); B.add('bark', t)
    top = Vector((*bend(h * 0.68), h * 0.68)); cents = [(Vector((top.x, top.y, h * (0.84 if not bare else 0.9))), R * 0.62)]; n = blobs - 1
    for i in range(n):
        a = i / n * TAU + rs.uniform(-0.3, 0.3); rad = R * rs.uniform(0.46, 0.7); z = h * rs.uniform(0.62, 0.80)
        c = Vector((top.x + math.cos(a) * rad, top.y + math.sin(a) * rad, z)); cents.append((c, R * rs.uniform(0.40, 0.54)))
        z0 = th * rs.uniform(0.8, 1.15); p0 = Vector((*bend(z0), z0)); d = c - p0; L = d.length * (1.0 if not bare else rs.uniform(0.8, 1.1))
        br = bm_cyl(tr * 0.36, tr * 0.1, L, 6); cyl_uv(br, 1.0, 0.22)
        if bare:
            for v in br.verts: v.co.x += math.sin(v.co.z * 1.7 + i) * 0.22; v.co.y += math.cos(v.co.z * 1.3 + i * 2) * 0.22
        Mb = Matrix.Translation(p0) @ Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4(); merge(B.bm('bark'), br, Mb)
        if bare:
            for q in range(2):
                tt = rs.uniform(0.45, 0.85); pp = p0 + d.normalized() * L * tt; a2 = rs.random() * TAU; d2 = Vector((math.cos(a2), math.sin(a2), rs.uniform(0.1, 0.7))).normalized(); L2 = rs.uniform(0.8, 1.8)
                tw = bm_cyl(tr * 0.13, tr * 0.03, L2, 5); cyl_uv(tw, 1.0, 0.22); merge(B.bm('bark'), tw, Matrix.Translation(pp) @ Vector((0, 0, 1)).rotation_difference(d2).to_matrix().to_4x4())
    zb = min(c.z - 0.72 * s for c, s in cents); zt = max(c.z + 0.72 * s for c, s in cents); Rc = max(math.hypot(c.x, c.y) + s for c, s in cents) + 0.3
    if not bare:
        for i, (c, s) in enumerate(cents):
            ico = bmesh.new(); bmesh.ops.create_icosphere(ico, subdivisions=2, radius=s); displace_radial(ico, s * 0.30, 1.4 / s, seed * 10 + i, 3)
            for v in ico.verts: v.co.z *= 0.72
            merge(B.bm(leaf), ico, Matrix.Translation(c))
            for k in range(cards):
                a = rs.random() * TAU; el = rs.uniform(-0.2, 0.9); dv = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el) * 0.72))
                add_card(B.bm('cut'), c + dv * s * 0.95, dv + Vector((0, -0.35, 0.75)), s * rs.uniform(0.8, 1.15), 'cluster', rs.random() * TAU)
    else:
        for i, (c, s) in enumerate(cents[1:]):
            for k in range(2):  # visiaci mach
                p = c + Vector((rs.uniform(-0.6, 0.6), rs.uniform(-0.6, 0.6), -rs.uniform(0.2, 0.8)))
                add_cross(B.bm('cut'), 'grass', 0.9, -rs.uniform(1.0, 1.9), 2, p.x, p.y, p.z, rs.random() * 3)
        zb = th; Rc = tr
    fin = {leaf: leaf_shade(zb, zt, lit), 'cut': leaf_shade(zb, zt, lit) if not bare else (lambda co, n: (0.42, 0.48, 0.36)),
           'bark': ao_moss(top=(0.42, 0.60, 0.26), moss=0.45 if not bare else 0.15, dark=0.5, h1=h * 0.6, base=(1, 1, 1) if not bare else (0.75, 0.72, 0.70))}
    o = B.build(f'{name}_{seed}', finish=fin)
    o['col'] = 'circle'; o['r'] = round(tr * 1.5, 2); o['occ'] = 1; o['dest'] = 'tree'; o['hp'] = hp or int(40 + h * 9); o['h'] = round(h, 1)
    o['v_R'] = Rc; o['v_b'] = zb; o['v_t'] = zt; o['v_tr'] = tr * 1.2
    return o

def bush(seed, s=1.0, flowers=False, leaf='leaf'):
    rs = random.Random(seed); B = Parts(); n = rs.randint(3, 4)
    for i in range(n):
        a = i / n * TAU + rs.random(); rad = 0.45 * s * (0 if i == 0 else 1); r = s * rs.uniform(0.55, 0.8); c = Vector((math.cos(a) * rad, math.sin(a) * rad, r * 0.6 + (0.25 * s if i == 0 else 0)))
        ico = bmesh.new(); bmesh.ops.create_icosphere(ico, subdivisions=1, radius=r); displace_radial(ico, r * 0.28, 1.6 / r, seed * 7 + i, 2)
        for v in ico.verts: v.co.z *= 0.8
        merge(B.bm(leaf), ico, Matrix.Translation(c))
        for k in range(4):
            a2 = rs.random() * TAU; el = rs.uniform(0.0, 1.0); dv = Vector((math.cos(a2) * math.cos(el), math.sin(a2) * math.cos(el), math.sin(el) * 0.8))
            add_card(B.bm('cut'), c + dv * r * 0.95, dv + Vector((0, -0.3, 0.8)), r * rs.uniform(1.0, 1.4), 'flower' if flowers and k == 0 else 'cluster', rs.random() * TAU if not (flowers and k == 0) else 0)
    H = 1.6 * s; fin = {leaf: leaf_shade(0.1, H), 'cut': leaf_shade(0.1, H, lit=(1, 1, 0.9))}
    o = B.build(f'bush_{seed}', finish=fin); o['dest'] = 'bush'; o['hp'] = 18; o['h'] = round(H, 1)
    return o

def plant(seed, cell='grass', w=0.9, h=0.7, n=3, tint=(1, 1, 1)):
    """trs trávy / papraď / kvety – skrížené plochy s výrezom"""
    rs = random.Random(seed); bm = bmesh.new()
    for i in range(n):
        add_cross(bm, cell, w * rs.uniform(0.8, 1.15), h * rs.uniform(0.8, 1.2), 2, rs.uniform(-0.15, 0.15) * w, rs.uniform(-0.15, 0.15) * w, -0.03, rs.random() * 3.14, rs.uniform(-0.1, 0.1))
    vcolor(bm, lambda co, nn: tuple(t * (0.55 + 0.45 * clamp01(co.z / max(0.01, h))) for t in tint))
    o = obj_from_bm(f'{cell}_{seed}', bm, MAT['cut']['mat'], C_ASSET, props={'noshadow': 1}); return o

def boulder(seed, flat=0.62, sub=2, moss=0.8):
    rs = random.Random(seed); bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0); displace_radial(bm, 0.36, 0.9, seed, 4); sx = 1.0 + 0.35 * rs.random()
    for v in bm.verts:
        v.co.x *= sx; v.co.z *= flat
        if v.co.z < -0.12: v.co.z = -0.12 + (v.co.z + 0.12) * 0.15
    finalize(bm); box_uv(bm, 0.3, (seed * 0.37, seed * 0.21)); vcolor(bm, ao_moss(top=(0.46, 0.66, 0.24), h0=-0.2, h1=0.8, dark=0.5, moss=moss))
    o = measure(obj_from_bm(f'rock_{seed}', bm, MAT['rock']['mat'], C_ASSET)); o['dest'] = 'stone'; o['hp'] = 120; o['h'] = 1.0
    return o

def cliff(seed, w=7.0, h=5.0, d=4.0):
    """skalná stena (okraj mapy na severe): vrstvy, hore zarastené trávou"""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=5, use_grid_fill=True)
    for v in bm.verts:
        z = (v.co.z + 0.5); lay = math.floor(z * 4 + 0.3 * math.sin(v.co.x * 5 + seed)) / 4
        v.co = Vector((v.co.x * w, v.co.y * d * (1.0 - 0.22 * lay), z * h))
    jitter(bm, 0.5, 0.33, seed, keep_bottom=None); jitter(bm, 0.16, 1.3, seed + 3)
    for v in bm.verts: v.co.z = max(v.co.z, -0.4)
    finalize(bm); box_uv(bm, 0.2, (seed * 0.31, 0)); vcolor(bm, ao_moss(top=(0.40, 0.62, 0.20), h0=0, h1=h, dark=0.42, moss=1.0))
    return measure(obj_from_bm(f'cliff_{seed}', bm, MAT['rock']['mat'], C_ASSET))

def log(seed, L=4.2):
    bm = bm_cyl(0.42, 0.36, L, 10, -L / 2); jitter(bm, 0.05, 1.5, seed); cyl_uv(bm, 2, 0.3)
    for v in bm.verts: v.co = Vector((v.co.z, v.co.y, v.co.x + 0.36))
    finalize(bm); vcolor(bm, ao_moss(top=(0.42, 0.62, 0.24), h0=0, h1=0.8, dark=0.55, moss=0.85))
    o = measure(obj_from_bm(f'log_{seed}', bm, MAT['bark']['mat'], C_ASSET)); o['dest'] = 'wood'; o['hp'] = 60; o['h'] = 0.8; return o

def stump(seed, r=0.5):
    bm = bm_cyl(r * 1.15, r * 0.9, 0.55, 10); jitter(bm, 0.05, 2, seed, keep_bottom=0); cyl_uv(bm, 2, 0.4)
    for k in range(4): add_cyl(bm, r * 0.32, r * 0.08, r * 1.7, 5, 0, 0, 0.02, Euler((1.35, 0, k / 4 * TAU + 0.3)))
    finalize(bm); vcolor(bm, ao_moss(top=(0.42, 0.6, 0.26), h1=0.6, dark=0.6, moss=0.5))
    return measure(obj_from_bm(f'stump_{seed}', bm, MAT['bark']['mat'], C_ASSET))

def mushrooms(seed):
    rs = random.Random(seed); bm = bmesh.new()
    for i in range(4):
        x, y, s = rs.uniform(-0.35, 0.35), rs.uniform(-0.35, 0.35), rs.uniform(0.6, 1.3)
        merge(bm, lathe([(0.05 * s, 0), (0.04 * s, 0.25 * s), (0.2 * s, 0.25 * s), (0.17 * s, 0.33 * s), (0.08 * s, 0.39 * s), (0.0, 0.41 * s)], 8), Matrix.Translation((x, y, 0)))
    finalize(bm); o = obj_from_bm(f'shrooms_{seed}', bm, MAT['glow']['mat'], C_ASSET); o['noshadow'] = 1; return o

def pumpkin(seed, s=1.0):
    rs = random.Random(seed); bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=6, radius=0.42 * s)
    for v in bm.verts:
        a = math.atan2(v.co.y, v.co.x); f = 1 + 0.09 * math.cos(a * 6); v.co.x *= f; v.co.y *= f; v.co.z = v.co.z * 0.72 + 0.3 * s
    c = (0.95, 0.42 + 0.12 * rs.random(), 0.06); B = Parts(); B.col(bm, c, 0.35)
    B.col(bm_cyl(0.05 * s, 0.03 * s, 0.16 * s, 5, 0.58 * s), (0.25, 0.35, 0.12), 0.0)
    for k in range(3): add_cross(B.bm('cut'), 'cluster', 0.7 * s, 0.4 * s, 1, math.cos(k * 2.1 + seed) * 0.45 * s, math.sin(k * 2.1 + seed) * 0.45 * s, 0.0, k * 1.3, 0.25)
    o = B.build(f'pumpkin_{seed}', finish={'cut': lambda co, n: (0.8, 0.95, 0.7)}); o['dest'] = 'bush'; o['hp'] = 10; o['h'] = 0.6
    return o

# ------------------------------------------------------------------ drevené rekvizity
def wheel(B, r=0.62, x=0, y=0, z=None, axis='x'):
    z = r if z is None else z; R_ = Euler((0, math.pi / 2, 0)) if axis == 'x' else Euler((math.pi / 2, 0, 0)); M = Matrix.Translation((x, y, z)) @ R_.to_matrix().to_4x4()
    rim = lathe([(r, -0.05), (r, 0.05), (r * 0.84, 0.05), (r * 0.84, -0.05), (r, -0.05)], 14, caps=False); merge(B.bm('wood'), rim, M)
    hub = bm_cyl(r * 0.2, r * 0.2, 0.2, 8, -0.1); merge(B.bm('wood'), hub, M)
    for k in range(7):
        sp = bmesh.new(); bmesh.ops.create_cube(sp, size=1.0); a = k / 7 * TAU
        for v in sp.verts: v.co = Vector((v.co.x * 0.07, (v.co.y + 0.5) * r * 0.86, v.co.z * 0.06))
        merge(B.bm('wood'), sp, M @ Matrix.Rotation(a, 4, 'Z'))
    tire = lathe([(r * 1.02, -0.06), (r * 1.02, 0.06)], 14, caps=False); merge(B.bm('iron'), tire, M)

def barrel_parts(B, x=0, y=0, z=0, s=1.0, lying=False, rz=0.0):
    prof = [(0.34, 0), (0.42, 0.25), (0.45, 0.5), (0.42, 0.75), (0.34, 1.0)]; M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, 'Z')
    if lying: M = M @ Matrix.Translation((0, 0, 0.45 * s)) @ Matrix.Rotation(math.pi / 2, 4, 'Y') @ Matrix.Translation((0, 0, -0.5 * s))
    M = M @ Matrix.Scale(s, 4)
    merge(B.bm('wood'), lathe(prof, 10), M)
    for zz, rr_ in ((0.14, 0.39), (0.5, 0.46), (0.86, 0.39)): merge(B.bm('iron'), lathe([(rr_ + 0.012, zz - 0.035), (rr_ + 0.012, zz + 0.035)], 10, caps=False), M)

def crate_parts(B, x=0, y=0, z=0, s=0.9, rz=0.0):
    B.box('wood', s, s, s, x, y, z + s / 2, rz)
    for sx in (-1, 1):
        for sy in (-1, 1):
            c, sn = math.cos(rz), math.sin(rz); px, py = sx * s * 0.47, sy * s * 0.47
            B.box('timber', 0.09, 0.09, s * 1.04, x + px * c - py * sn, y + px * sn + py * c, z + s / 2, rz)
    for zz in (0.06, s - 0.06): B.box('timber', s * 1.04, s * 1.04, 0.09, x, y, z + zz, rz)

def sack_parts(B, x=0, y=0, z=0, s=1.0, col=(0.62, 0.50, 0.32)):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.36 * s)
    for v in bm.verts: v.co.z = v.co.z * 0.85 + 0.3 * s; v.co.x *= 1.15
    jitter(bm, 0.04, 3, int(x * 7 + y * 3)); B.col(bm, col, 0.4, Matrix.Translation((x, y, z)))
    B.col(bm_cyl(0.07 * s, 0.11 * s, 0.14 * s, 5, 0.58 * s), col, 0.0, Matrix.Translation((x, y, z)))

def barrel(seed=0):
    B = Parts(); barrel_parts(B); o = B.build(f'barrel_{seed}'); setp(o, col='circle', r=0.5, dest='wood', hp=30, h=1.0); return o
def crate(seed=0, s=0.9):
    B = Parts(); crate_parts(B, s=s); o = B.build(f'crate_{seed}'); setp(o, col='circle', r=s * 0.62, dest='wood', hp=25, h=s); return o
def crate_stack(seed=0):
    rs = random.Random(seed); B = Parts(); crate_parts(B, -0.5, 0, 0, 0.9, 0.1); crate_parts(B, 0.5, 0.1, 0, 0.8, -0.15); crate_parts(B, 0.0, 0.05, 0.9, 0.7, 0.4)
    barrel_parts(B, 1.25, -0.2, 0, 0.9); sack_parts(B, -0.3, -0.85, 0, 1.0); sack_parts(B, 0.45, -0.8, 0, 0.9, (0.55, 0.47, 0.36))
    o = B.build(f'cratestack_{seed}'); setp(o, col='circle', r=1.25, dest='wood', hp=60, h=1.6); return o

def cart(seed=0, cover=False, load=True):
    """voz s veľkými kolesami (ako v referencii), voliteľne s plachtou a nákladom; os voza = x"""
    rs = random.Random(seed); B = Parts(); L, W, zb = 3.4, 1.6, 0.95
    B.box('wood', L, W, 0.12, 0, 0, zb)
    for sy in (-1, 1):
        B.box('wood', L, 0.08, 0.5, 0, sy * (W / 2), zb + 0.3)
        for k in range(5): B.box('timber', 0.09, 0.1, 0.62, -L / 2 + 0.15 + k * (L - 0.3) / 4, sy * (W / 2 + 0.05), zb + 0.3)
    for sx in (-1, 1): B.box('wood', 0.08, W, 0.5, sx * L / 2, 0, zb + 0.3)
    for sx in (-1, 1):
        B.box('timber', 0.14, W + 0.5, 0.14, sx * 1.05, 0, 0.62)
        for sy in (-1, 1): wheel(B, 0.62, sx * 1.05, sy * (W / 2 + 0.22), 0.62, 'y')
    B.beam('timber', (L / 2, 0, 0.8), (L / 2 + 2.3, 0, 0.42), 0.1); B.box('timber', 0.1, 1.3, 0.1, L / 2 + 2.2, 0, 0.45)
    if load:
        barrel_parts(B, -1.0, 0.25, zb + 0.06, 0.85); barrel_parts(B, -0.2, -0.3, zb + 0.06, 0.8); crate_parts(B, 0.8, 0.2, zb + 0.06, 0.75, 0.2); sack_parts(B, 0.25, 0.4, zb + 0.06, 0.9)
        if not cover: sack_parts(B, 1.2, -0.4, zb + 0.06, 1.0, (0.55, 0.45, 0.30))
    if cover:
        for k in range(4):
            x = -L / 2 + 0.2 + k * (L - 0.4) / 3
            for i in range(8):
                a0, a1 = i / 8 * math.pi, (i + 1) / 8 * math.pi
                B.beam('timber', (x, math.cos(a0) * W / 2, zb + 0.5 + math.sin(a0) * 1.25), (x, math.cos(a1) * W / 2, zb + 0.5 + math.sin(a1) * 1.25), 0.06)
        cv = bmesh.new(); n = 10; rows = []
        for i in range(n + 1):
            a = i / n * math.pi; rows.append((cv.verts.new((-L / 2 + 0.1, math.cos(a) * (W / 2 + 0.05), zb + 0.5 + math.sin(a) * 1.3)), cv.verts.new((L / 2 - 0.35, math.cos(a) * (W / 2 + 0.05), zb + 0.5 + math.sin(a) * 1.3))))
        for a, b in zip(rows, rows[1:]): cv.faces.new((a[0], a[1], b[1], b[0]))
        B.col(cv, (0.86, 0.62, 0.34), 0.0, key='cloth', recalc=False)
    o = B.build(f'cart_{seed}{"c" if cover else ""}'); setp(o, col='circle', r=1.5, dest='wood', hp=90, h=2.4 if cover else 1.6)
    return o

def fence(seed=0, L=3.0):
    rs = random.Random(seed); B = Parts()
    for sx in (-1, 1): B.box('wood', 0.16, 0.16, 1.25 + rs.uniform(-0.1, 0.1), sx * L / 2, 0, 0.6, rs.uniform(-0.2, 0.2))
    B.beam('wood', (-L / 2, 0.02, 0.95), (L / 2, 0.02, 0.9 + rs.uniform(-0.08, 0.08)), 0.1, 0.05); B.beam('wood', (-L / 2, 0.02, 0.5), (L / 2, 0.02, 0.52 + rs.uniform(-0.08, 0.08)), 0.1, 0.05)
    o = B.build(f'fence_{seed}'); setp(o, dest='wood', hp=25, h=1.2, col='box'); return o

def lamp_post(seed=0, h=3.2):
    B = Parts(); B.box('timber', 0.18, 0.18, h, 0, 0, h / 2); B.box('stone', 0.5, 0.5, 0.35, 0, 0, 0.17, 0, 0.04); B.beam('timber', (0, 0, h - 0.15), (0.7, 0, h - 0.05), 0.1); B.beam('timber', (0, 0, h - 0.8), (0.5, 0, h - 0.12), 0.07)
    B.box('iron', 0.3, 0.3, 0.05, 0.7, 0, h - 0.22); B.box('iron', 0.34, 0.34, 0.06, 0.7, 0, h - 0.68); B.box('glass', 0.22, 0.22, 0.4, 0.7, 0, h - 0.45)
    for sx in (-1, 1):
        for sy in (-1, 1): B.box('iron', 0.03, 0.03, 0.42, 0.7 + sx * 0.13, sy * 0.13, h - 0.45)
    o = B.build(f'lamp_{seed}'); setp(o, col='circle', r=0.3, dest='wood', hp=40, h=h); o['v_thin'] = 1; return o

def signpost(seed=0):
    B = Parts(); B.box('timber', 0.16, 0.16, 2.6, 0, 0, 1.3)
    for k, (a, z) in enumerate(((0.3, 2.25), (-2.6, 1.85))): B.box('wood', 1.2, 0.06, 0.28, math.cos(a) * 0.55, math.sin(a) * 0.55, z, a)
    o = B.build(f'signpost_{seed}'); setp(o, col='circle', r=0.3, dest='wood', hp=30, h=2.6); o['v_thin'] = 1; return o

def campfire():
    B = Parts()
    for k in range(9):
        a = k / 9 * TAU; s = bmesh.new(); bmesh.ops.create_icosphere(s, subdivisions=1, radius=0.28); jitter(s, 0.06, 2, k); B.add('rock', s, Matrix.Translation((math.cos(a) * 1.0, math.sin(a) * 1.0, 0.12)))
    for k in range(5):
        lg = bm_cyl(0.1, 0.08, 1.3, 6); cyl_uv(lg, 1, 0.5); B.add('bark', lg, Matrix.Translation((0, 0, 0.05)) @ Euler((1.15, 0, k / 5 * TAU)).to_matrix().to_4x4())
    B.box('ember', 0.5, 0.5, 0.12, 0, 0, 0.1)
    o = B.build('campfire'); setp(o, col='circle', r=1.1); return o

def tent(seed=0):
    bm = bmesh.new(); n = 7; top = bm.verts.new((0, 0, 2.6)); ring = []
    for i in range(n):
        a = i / n * TAU; r = 1.7 + 0.1 * math.sin(i * 2.3); ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, 0.0)))
    for i in range(n - 1): bm.faces.new((ring[i], ring[i + 1], top))
    B = Parts(); B.col(bm, (0.62, 0.46, 0.30), 0.35, key='cloth', recalc=False)
    for k in range(3): B.cyl('timber', 0.05, 0.04, 3.1, 5, 0, 0, 0, Euler((0.2, 0, k / 3 * TAU)))
    o = B.build(f'tent_{seed}'); setp(o, col='circle', r=1.6, occ=1, dest='wood', hp=60, h=2.6); return o

def standing_stone(seed, h=3.4):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
    for v in bm.verts: v.co = Vector((v.co.x * 1.1, v.co.y * 0.75, (v.co.z + 0.5) * h)); v.co.x *= 1 - 0.25 * (v.co.z / h)
    jitter(bm, 0.09, 0.9, seed, keep_bottom=0); B = Parts(); B.add('rock', bm)
    for k in range(4): B.box('rune', 0.07, 0.04, 0.35, (k - 1.5) * 0.18, -0.39, h * 0.45 + (k % 2) * 0.12)
    B.box('rune', 0.55, 0.04, 0.06, 0, -0.39, h * 0.62)
    o = B.build(f'menhir_{seed}'); setp(o, col='circle', r=0.8, occ=1, dest='stone', hp=220, h=h); return o

def ruin_wall(seed, L=6.0, h=2.4):
    rs = random.Random(seed); B = Parts(); rows, bl = 5, 0.95
    for j in range(rows):
        x = -L / 2 + (bl / 2 if j % 2 else 0)
        while x < L / 2:
            w = rs.uniform(0.7, 1.15); top = h * (1 - 0.75 * max(0, (x + L / 2) / L - 0.35)) + rs.uniform(-0.3, 0.2)
            if (j + 0.5) * (h / rows) < top: B.box('rock', w * 0.96, 0.7, h / rows * 0.94, x + w / 2, rs.uniform(-0.04, 0.04), (j + 0.5) * h / rows, rs.uniform(-0.04, 0.04), 0.04)
            x += w
    o = B.build(f'ruinwall_{seed}'); setp(o, col='box', occ=1, dest='stone', hp=180, h=h); return o

def portal_gate():
    B = Parts()
    for s in (-1, 1):
        st = bmesh.new(); bmesh.ops.create_cube(st, size=1.0); bmesh.ops.subdivide_edges(st, edges=st.edges[:], cuts=3, use_grid_fill=True)
        for v in st.verts: v.co = Vector((v.co.x * 1.3, v.co.y * 1.1, (v.co.z + 0.5) * 6.4))
        jitter(st, 0.08, 0.8, 3 + s, keep_bottom=0); B.add('rock', st, Matrix.Translation((s * 3.35, 0, 0)) @ Matrix.Rotation(-s * 0.03, 4, 'Y'))
        for k in range(5): B.box('rune', 0.5, 0.06, 0.08, s * 3.35, -0.6, 1.2 + k * 0.95)
    cap = bmesh.new(); bmesh.ops.create_cube(cap, size=1.0); bmesh.ops.subdivide_edges(cap, edges=cap.edges[:], cuts=4, use_grid_fill=True)
    for v in cap.verts: v.co = Vector((v.co.x * 9.4, v.co.y * 1.5, v.co.z * 1.1)); v.co.z += 0.18 * (1 - (v.co.x / 4.7) ** 2)
    jitter(cap, 0.1, 0.7, 9); B.add('rock', cap, Matrix.Translation((0, 0, 6.85))); B.box('rune', 6.0, 0.06, 0.12, 0, -0.78, 6.85)
    o = B.build('portal_gate'); o['occ'] = 1; return o

# ------------------------------------------------------------------ náhľady (kamera ako v hre)
def setup_preview(sun_dir=(18, 34, 14), sun_col=(1.0, 0.86, 0.66), sun_e=4.0, sky=(0.42, 0.62, 0.62), sky_e=1.0):
    scn = bpy.context.scene
    for o in list(scn.objects):
        if o.type in ('LIGHT', 'CAMERA'): bpy.data.objects.remove(o, do_unlink=True)
    L = bpy.data.lights.new('Sun', 'SUN'); L.energy = sun_e; L.color = sun_col; L.angle = 0.03; lo = bpy.data.objects.new('Sun', L); scn.collection.objects.link(lo)
    d = Vector((sun_dir[0], -sun_dir[2], sun_dir[1])).normalized(); lo.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    if scn.world is None: scn.world = bpy.data.worlds.new('W')
    scn.world.use_nodes = True; bg = scn.world.node_tree.nodes.get('Background')
    if bg: bg.inputs[0].default_value = (*sky, 1); bg.inputs[1].default_value = sky_e
    scn.render.resolution_x = 1280; scn.render.resolution_y = 720; scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = 'JPEG'; scn.render.image_settings.quality = 86
    try: scn.view_settings.view_transform = 'AgX'; scn.view_settings.look = 'AgX - Medium High Contrast'
    except Exception: pass
    return lo

def game_cam(tx, tz, dist=27.0, pitch=50.0, fov=32.0, name='GameCam'):
    scn = bpy.context.scene; cam = bpy.data.cameras.new(name); ob = bpy.data.objects.new(name, cam); scn.collection.objects.link(ob)
    cam.sensor_fit = 'VERTICAL'; cam.angle_y = math.radians(fov); cam.clip_start = 0.5; cam.clip_end = 600; p = math.radians(pitch)
    loc = Vector((tx, -(tz + math.cos(p) * dist), math.sin(p) * dist)); tgt = Vector((tx, -tz, 1.0)); ob.location = loc
    ob.rotation_euler = (tgt - loc).normalized().to_track_quat('-Z', 'Y').to_euler(); scn.camera = ob; return ob

def render(path, tx, tz, dist=27.0, pitch=50.0, fov=32.0, res=(1280, 720)):
    scn = bpy.context.scene; cam = game_cam(tx, tz, dist, pitch, fov); scn.render.resolution_x, scn.render.resolution_y = res
    os.makedirs(os.path.dirname(path), exist_ok=True); scn.render.filepath = path; bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True); return path

def render_top(path, x0, x1, z0, z1, px=1400):
    scn = bpy.context.scene; cam = bpy.data.cameras.new('Top'); ob = bpy.data.objects.new('Top', cam); scn.collection.objects.link(ob)
    cam.type = 'ORTHO'; w, d = x1 - x0, z1 - z0; cam.ortho_scale = max(w, d); cam.clip_end = 500; ob.location = ((x0 + x1) / 2, -(z0 + z1) / 2, 120); ob.rotation_euler = (0, 0, 0)
    scn.camera = ob; scn.render.resolution_x = px if w >= d else int(px * w / d); scn.render.resolution_y = int(px * d / w) if w >= d else px
    os.makedirs(os.path.dirname(path), exist_ok=True); scn.render.filepath = path; bpy.ops.render.render(write_still=True); bpy.data.objects.remove(ob, do_unlink=True); return path

def export_glb(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_extras=True, export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False, export_vertex_color='ACTIVE', export_texcoords=True, export_normals=True,
                              export_tangents=False, export_image_format='AUTO', export_gpu_instances=False, use_visible=True)

def stats():
    tris = 0; objs = 0; seen = set(); inst = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            objs += 1; o.data.calc_loop_triangles(); n = len(o.data.loop_triangles)
            if o.users_collection and not o.users_collection[0].hide_render: inst += n
            if o.data.name in seen: continue
            seen.add(o.data.name); tris += n
    return {'objects': objs, 'unique_meshes': len(seen), 'unique_tris': tris, 'scene_tris': inst}

R = random.Random(1)
rr = lambda a, b: a + R.random() * (b - a)
C_ASSET = None

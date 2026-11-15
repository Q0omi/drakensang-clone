# Spustenie v Blenderi: postaví mapu 'chest', uloží .blend a exportuje .glb do A:\drake clone\maps
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

bpy.ops.wm.save_as_mainfile(filepath=r'A:\drake clone\maps\blend\chest.blend')
export_glb(r'A:\drake clone\maps\chest.glb')
print('HOTOVO chest', result)

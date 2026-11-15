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

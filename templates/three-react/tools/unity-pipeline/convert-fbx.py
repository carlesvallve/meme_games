"""Blender headless script: Convert Unity FBX assets to GLB.

Modes:
  --mesh-only   Import character FBX, apply materials, export mesh + skeleton (no anims)
  --anim-only   Import anim FBXs, retarget to character skeleton via constraints, export anim GLB

Usage:
    # Mesh-only (per character):
    blender --background --python convert-fbx.py -- \
        --mesh-only --fbx <character.fbx> --out <char.glb> [--materials <mat.json>]

    # Anim-only (shared, per category):
    blender --background --python convert-fbx.py -- \
        --anim-only --ref-fbx <character.fbx> --anim-fbx <a1.fbx> --anim-fbx <a2.fbx> ... --out <anims.glb>
"""

import bpy
import json
import math
import os
import sys
from mathutils import Vector


# ─── Arg parsing ──────────────────────────────────────────────────────

def get_args():
    argv = sys.argv
    if "--" not in argv:
        return {}
    argv = argv[argv.index("--") + 1:]

    args = {"anim_fbx": []}
    i = 0
    while i < len(argv):
        if argv[i] == "--fbx":
            args["fbx"] = argv[i + 1]; i += 2
        elif argv[i] == "--out":
            args["out"] = argv[i + 1]; i += 2
        elif argv[i] == "--materials":
            args["materials"] = argv[i + 1]; i += 2
        elif argv[i] == "--ref-fbx":
            args["ref_fbx"] = argv[i + 1]; i += 2
        elif argv[i] == "--anim-fbx":
            args["anim_fbx"].append(argv[i + 1]); i += 2
        elif argv[i] == "--mesh-only":
            args["mesh_only"] = True; i += 1
        elif argv[i] == "--anim-only":
            args["anim_only"] = True; i += 1
        else:
            i += 1
    return args


# ─── Scene helpers ────────────────────────────────────────────────────

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in bpy.data.meshes:
        if block.users == 0: bpy.data.meshes.remove(block)
    for block in bpy.data.armatures:
        if block.users == 0: bpy.data.armatures.remove(block)
    for block in bpy.data.actions:
        if block.users == 0: bpy.data.actions.remove(block)


def import_fbx(filepath):
    bpy.ops.import_scene.fbx(
        filepath=filepath,
        use_anim=True,
        ignore_leaf_bones=True,
        automatic_bone_orientation=True,
        global_scale=1.0,
    )


def find_armature(exclude=None):
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE" and obj != exclude:
            return obj
    return None


# ─── Material application ────────────────────────────────────────────

def apply_materials(manifest_path):
    with open(manifest_path, "r") as f:
        manifest = json.load(f)

    for mat in bpy.data.materials:
        name = mat.name
        base_name = name.rsplit(".", 1)[0] if "." in name else name
        unity_mat = manifest.get(base_name) or manifest.get(name)
        if not unity_mat:
            lower = base_name.lower()
            for mk, mv in manifest.items():
                if mk.lower() == lower:
                    unity_mat = mv
                    break
        if not unity_mat:
            continue

        if hasattr(mat, "use_nodes"):
            mat.use_nodes = True
        bsdf = None
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                bsdf = n
                break
        if not bsdf:
            continue

        c = unity_mat["color"]
        bsdf.inputs["Base Color"].default_value = (c[0], c[1], c[2], c[3])
        bsdf.inputs["Metallic"].default_value = unity_mat.get("metallic", 0)
        bsdf.inputs["Roughness"].default_value = 1.0 - unity_mat.get("smoothness", 0.5)

        emissive = unity_mat.get("emissive")
        if emissive:
            bsdf.inputs["Emission Color"].default_value = (emissive[0], emissive[1], emissive[2], 1.0)
            bsdf.inputs["Emission Strength"].default_value = 1.0

        if unity_mat.get("transparent"):
            bsdf.inputs["Alpha"].default_value = c[3]


# ─── Bone mapping: Kevin Iglesias → Imminence ────────────────────────

# Built from comparing both skeletons' bone hierarchies.
# KI (38 bones, B-prefix) → Imminence (40 bones, LowMan prefix)
BONE_MAP_KI_TO_IMMINENCE = {
    # Root / Hips
    "B-hips":    "LowManHips",
    # Spine chain — mapped via Unity Humanoid names:
    #   KI: Spine=B-spine, Chest=B-chest, UpperChest=None
    #   Imm: Spine=LowManSpine, Chest=LowManSpine1, UpperChest=LowManSpine2
    "B-spine":   "LowManSpine",
    "B-chest":   "LowManSpine2",   # both are parent of neck/shoulders in hierarchy
    # (LowManSpine1 = intermediate, undriven — handled by accumulated correction)
    # Neck / Head
    "B-neck":    "LowManNeck",
    "B-head":    "LowManHead",
    # Left leg
    "B-thigh.L": "LowManLeftUpLeg",
    "B-shin.L":  "LowManLeftLeg",
    "B-foot.L":  "LowManLeftFoot",
    "B-toe.L":   "LowManLeftToeBase",
    # Right leg
    "B-thigh.R": "LowManRightUpLeg",
    "B-shin.R":  "LowManRightLeg",
    "B-foot.R":  "LowManRightFoot",
    "B-toe.R":   "LowManRightToeBase",
    # Left arm
    "B-shoulder.L":  "LowManLeftShoulder",
    "B-upperArm.L":  "LowManLeftArm",
    "B-forearm.L":   "LowManLeftForeArm",
    # Hands and fingers excluded — rest orientations differ too much between skeletons.
    # They stay at rest pose, which looks natural for body animations.
    # Right arm
    "B-shoulder.R":  "LowManRightShoulder",
    "B-upperArm.R":  "LowManRightArm",
    "B-forearm.R":   "LowManRightForeArm",
}


# ─── World-space delta retargeting ───────────────────────────────────

from mathutils import Quaternion as MQuaternion

def _rest_local_quat(bone):
    """Rest rotation of bone relative to its parent (in armature space)."""
    if bone.parent:
        return bone.parent.matrix_local.to_quaternion().inverted() @ bone.matrix_local.to_quaternion()
    return bone.matrix_local.to_quaternion()


def retarget_animation(target_arm, source_arm, action_name):
    """World-space visual retargeting with mathematical B-root correction.

    For each frame:
      1. Evaluate source animation
      2. Compute B-root correction matrix (undo its coordinate-system animation)
      3. Apply correction to get "clean" source bone world rotations
      4. Compute world delta from source rest
      5. Apply world delta to target rest → desired target world rotation
      6. Convert to target bone's local rotation for keyframing

    The B-root correction is purely mathematical — no pose reset needed,
    so Blender's dependency graph won't override our changes.
    """

    if not source_arm.animation_data:
        return None
    actions = [a for a in bpy.data.actions if a.name not in _known_actions]
    if not actions:
        return None
    source_action = actions[0]
    source_arm.animation_data.action = source_action

    frame_start = int(source_action.frame_range[0])
    frame_end = int(source_action.frame_range[1])

    # Build forward (src→tgt) and reverse (tgt→src) mappings
    src_bones = {b.name for b in source_arm.data.bones}
    tgt_bones = {b.name for b in target_arm.data.bones}
    fwd_map = {}
    rev_map = {}
    for sb, tb in BONE_MAP_KI_TO_IMMINENCE.items():
        if sb in src_bones and tb in tgt_bones:
            fwd_map[sb] = tb
            rev_map[tb] = sb

    if not fwd_map:
        return None

    # Sort ALL target bones by hierarchy depth (parents first)
    def bone_depth(bone):
        d = 0; b = bone
        while b.parent: d += 1; b = b.parent
        return d
    all_tgt_bones_sorted = sorted(target_arm.data.bones, key=bone_depth)

    # Ensure both armatures use quaternion rotation mode
    for arm in [target_arm, source_arm]:
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode='POSE')
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        bpy.ops.object.mode_set(mode='OBJECT')

    # Strip B-root/B-spineProxy fcurves from the source action directly.
    # This must happen HERE (not just in import_and_retarget_anim) to guarantee
    # they're gone before we reset defaults and start the frame loop.
    STRIP_BONES = {"B-root", "B-spineProxy", "Rig"}
    if source_action.is_action_layered and source_action.layers:
        for strip in source_action.layers[0].strips:
            for cb in strip.channelbags:
                for fc in list(cb.fcurves):
                    for sbn in STRIP_BONES:
                        if f'"{sbn}"' in fc.data_path:
                            cb.fcurves.remove(fc)
                            break
    elif hasattr(source_action, 'fcurves'):
        for fc in list(source_action.fcurves):
            for sbn in STRIP_BONES:
                if f'"{sbn}"' in fc.data_path:
                    source_action.fcurves.remove(fc)
                    break

    # Reset B-root (and B-spineProxy) default pose to identity.
    # With fcurves stripped, frame_set won't override this.
    # Identity rotation → B-root.matrix = B-root.matrix_local (90° X),
    # so children's evaluated poses match matrix_local for correct delta computation.
    bpy.context.view_layer.objects.active = source_arm
    bpy.ops.object.mode_set(mode='POSE')
    for bn in STRIP_BONES:
        pb = source_arm.pose.bones.get(bn)
        if pb:
            pb.rotation_quaternion = MQuaternion((1, 0, 0, 0))
            pb.location = Vector((0, 0, 0))
            pb.scale = Vector((1, 1, 1))
    bpy.ops.object.mode_set(mode='OBJECT')

    # Pre-compute rest-pose world rotations using matrix_local (consistent for both)
    src_arm_world_mat = source_arm.matrix_world
    tgt_arm_world_q = target_arm.matrix_world.to_quaternion()

    src_rest_world = {}
    tgt_rest_world = {}
    for src_name, tgt_name in fwd_map.items():
        src_rest_world[src_name] = (src_arm_world_mat @ source_arm.data.bones[src_name].matrix_local).to_quaternion()
        tgt_rest_world[tgt_name] = (target_arm.matrix_world @ target_arm.data.bones[tgt_name].matrix_local).to_quaternion()

    # Source rest position (for hips position delta)
    src_rest_pos = {}
    for src_name in fwd_map:
        src_rest_pos[src_name] = source_arm.data.bones[src_name].matrix_local.to_translation()

    # Pre-compute rest-local quaternion for every target bone
    tgt_rest_local = {}
    for bone in target_arm.data.bones:
        tgt_rest_local[bone.name] = _rest_local_quat(bone)

    # Create new action
    if not target_arm.animation_data:
        target_arm.animation_data_create()
    new_action = bpy.data.actions.new(name=action_name)
    new_action.use_fake_user = True
    target_arm.animation_data.action = new_action

    # Left arm bones: instead of retargeting from broken left source bones,
    # mirror the right arm's pose_delta (local rotation). The right side works
    # perfectly, so we just mirror it: (w, x, y, z) → (w, x, -y, -z)
    # (reflection across YZ plane in bone-local space).
    MIRROR_R_TO_L = {
        "LowManRightShoulder": "LowManLeftShoulder",
        "LowManRightArm": "LowManLeftArm",
        "LowManRightForeArm": "LowManLeftForeArm",
    }
    MIRROR_L_SKIP = set(MIRROR_R_TO_L.values())  # skip these in main loop

    for frame in range(frame_start, frame_end + 1):
        bpy.context.scene.frame_set(frame)

        bpy.context.view_layer.objects.active = target_arm
        bpy.ops.object.mode_set(mode='POSE')

        computed_arm_rot = {}
        right_desired_worlds = {}  # store right side WORLD rotations for mirroring

        for tgt_bone in all_tgt_bones_sorted:
            tgt_name = tgt_bone.name
            src_name = rev_map.get(tgt_name)

            # Skip left arm bones — they'll be mirrored from right side after
            if tgt_name in MIRROR_L_SKIP:
                # Still need computed_arm_rot for cascade; use rest pose placeholder
                if tgt_bone.parent and tgt_bone.parent.name in computed_arm_rot:
                    parent_arm = computed_arm_rot[tgt_bone.parent.name]
                    computed_arm_rot[tgt_name] = parent_arm @ tgt_rest_local[tgt_name]
                else:
                    computed_arm_rot[tgt_name] = tgt_bone.matrix_local.to_quaternion()
                continue

            if src_name:
                src_pb = source_arm.pose.bones[src_name]

                # Source world rotation
                src_cur_world = (src_arm_world_mat @ src_pb.matrix).to_quaternion()

                # Local-frame delta (right-multiply)
                world_delta = src_rest_world[src_name].conjugated() @ src_cur_world

                # Apply to target rest world
                desired_world = tgt_rest_world[tgt_name] @ world_delta

                # Convert to armature space
                desired_arm = tgt_arm_world_q.conjugated() @ desired_world
                computed_arm_rot[tgt_name] = desired_arm

                # Get parent's computed armature rotation
                if tgt_bone.parent and tgt_bone.parent.name in computed_arm_rot:
                    parent_arm = computed_arm_rot[tgt_bone.parent.name]
                elif tgt_bone.parent:
                    parent_arm = tgt_bone.parent.matrix_local.to_quaternion()
                else:
                    parent_arm = MQuaternion()

                rest_local = tgt_rest_local[tgt_name]
                pose_delta = (parent_arm @ rest_local).conjugated() @ desired_arm

                tgt_pb = target_arm.pose.bones[tgt_name]
                tgt_pb.rotation_quaternion = pose_delta
                tgt_pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)

                # Store right side world rotation for mirroring
                if tgt_name in MIRROR_R_TO_L:
                    right_desired_worlds[tgt_name] = desired_world

                # Root position delta (hips only)
                if tgt_name == "LowManHips":
                    src_cur_pos = src_pb.matrix.to_translation()
                    pos_delta = src_cur_pos - src_rest_pos[src_name]
                    tgt_pb.location = pos_delta
                    tgt_pb.keyframe_insert(data_path="location", frame=frame)

            else:
                # Not retargeted — propagate parent movement
                if tgt_bone.parent and tgt_bone.parent.name in computed_arm_rot:
                    parent_arm = computed_arm_rot[tgt_bone.parent.name]
                    computed_arm_rot[tgt_name] = parent_arm @ tgt_rest_local[tgt_name]
                else:
                    computed_arm_rot[tgt_name] = tgt_bone.matrix_local.to_quaternion()

        # Mirror right arm world rotations → left arm
        # Work in WORLD space (not local) to handle asymmetric rest poses
        for right_name, left_name in MIRROR_R_TO_L.items():
            if right_name not in right_desired_worlds:
                continue
            right_world = right_desired_worlds[right_name]
            # Mirror world rotation from right → left
            # Uncomment ONE line to test each sign combo:
            w, x, y, z = right_world.w, right_world.x, right_world.y, right_world.z
            # mirrored_world = MQuaternion(( w,  x,  y,  z))  # 0: identity
            # mirrored_world = MQuaternion(( w,  x,  y, -z))  # 1
            # mirrored_world = MQuaternion(( w,  x, -y,  z))  # 2
            # mirrored_world = MQuaternion(( w,  x, -y, -z))  # 3
            # mirrored_world = MQuaternion(( w, -x,  y,  z))  # 4
            # mirrored_world = MQuaternion(( w, -x,  y, -z))  # 5
            # mirrored_world = MQuaternion(( w, -x, -y,  z))  # 6
            mirrored_world = MQuaternion(( w, -x, -y, -z))  # 7

            # Convert to armature space
            desired_arm = tgt_arm_world_q.conjugated() @ mirrored_world
            computed_arm_rot[left_name] = desired_arm

            # Compute local pose_delta from the left bone's actual parent + rest
            left_bone = target_arm.data.bones[left_name]
            if left_bone.parent and left_bone.parent.name in computed_arm_rot:
                parent_arm = computed_arm_rot[left_bone.parent.name]
            elif left_bone.parent:
                parent_arm = left_bone.parent.matrix_local.to_quaternion()
            else:
                parent_arm = MQuaternion()
            rest_local = tgt_rest_local[left_name]
            pose_delta = (parent_arm @ rest_local).conjugated() @ desired_arm

            tgt_pb = target_arm.pose.bones[left_name]
            tgt_pb.rotation_quaternion = pose_delta
            tgt_pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)

        bpy.ops.object.mode_set(mode='OBJECT')

    target_arm.animation_data.action = None
    return new_action


def remove_objects(keep_set):
    """Remove all objects not in keep_set."""
    for obj in list(bpy.data.objects):
        if obj not in keep_set:
            bpy.data.objects.remove(obj, do_unlink=True)
    # Clean orphan data
    for block in bpy.data.meshes:
        if block.users == 0: bpy.data.meshes.remove(block)
    for block in bpy.data.armatures:
        if block.users == 0: bpy.data.armatures.remove(block)
    for block in bpy.data.actions:
        if block.users == 0 and not block.use_fake_user:
            bpy.data.actions.remove(block)


# Track known actions to find newly imported ones
_known_actions = set()


def import_and_retarget_anim(target_arm, anim_fbx_path, keep_objects):
    """Import one anim FBX, retarget to target skeleton, clean up."""
    global _known_actions
    _known_actions = set(a.name for a in bpy.data.actions)

    basename = os.path.basename(anim_fbx_path).rsplit(".", 1)[0]
    # Clean name: "HumanM@RunForward01 - Loop" → "RunForward01 - Loop"
    clean_name = basename.split("@", 1)[1] if "@" in basename else basename

    existing_objects = set(bpy.data.objects)
    import_fbx(anim_fbx_path)

    source_arm = None
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE" and obj not in existing_objects:
            source_arm = obj
            break

    if not source_arm:
        print(f"  SKIP {basename}: no armature found")
        return None

    # Strip animation from structural bones (B-root, B-spineProxy, Rig, etc.)
    # These are coordinate-system / scale bones, not humanoid bones.
    # B-root's animation undoes the Z-up→Y-up conversion and adds 100x scale,
    # which would corrupt all child bones during retargeting.
    STRIP_BONES = {"B-root", "B-spineProxy", "Rig"}
    new_actions = [a for a in bpy.data.actions if a.name not in _known_actions]
    for action in new_actions:
        stripped = []
        # Blender 5.x: layered actions → fcurves in channelbags
        if action.is_action_layered and action.layers:
            for strip in action.layers[0].strips:
                for cb in strip.channelbags:
                    for fc in list(cb.fcurves):
                        for strip_bone in STRIP_BONES:
                            if f'"{strip_bone}"' in fc.data_path:
                                cb.fcurves.remove(fc)
                                stripped.append(strip_bone)
                                break
        elif hasattr(action, 'fcurves'):
            # Blender 4.x fallback
            for fc in list(action.fcurves):
                for strip_bone in STRIP_BONES:
                    if f'"{strip_bone}"' in fc.data_path:
                        action.fcurves.remove(fc)
                        stripped.append(strip_bone)
                        break
        if stripped:
            unique = set(stripped)
            print(f"  Stripped animation from: {', '.join(sorted(unique))}")

    baked = retarget_animation(target_arm, source_arm, clean_name)

    # Clean up source objects
    remove_objects(keep_objects)

    if baked:
        print(f"  OK {clean_name}")
    else:
        print(f"  SKIP {basename}: no animation data")

    return baked


# ─── Export ───────────────────────────────────────────────────────────


def fix_orphan_vertices():
    """Fix vertices with no bone weights by copying weights from face-adjacent verts.
    Orphan verts cause wild deformation in skinned meshes because they stay at
    the origin while everything else moves with the skeleton."""
    for obj in bpy.data.objects:
        if obj.type != "MESH" or len(obj.vertex_groups) == 0:
            continue
        mesh = obj.data
        # Find orphan verts (no vertex group assignments)
        orphans = set()
        for v in mesh.vertices:
            if len(v.groups) == 0:
                orphans.add(v.index)
        if not orphans:
            continue

        # Build adjacency from faces: for each vert, which other verts share a face
        adjacency = {vi: set() for vi in orphans}
        for poly in mesh.polygons:
            poly_verts = set(poly.vertices)
            for vi in poly_verts:
                if vi in orphans:
                    adjacency[vi].update(poly_verts - {vi})

        # For each orphan, average weights from its non-orphan neighbors
        fixed = 0
        for vi in orphans:
            neighbors = adjacency[vi] - orphans  # only non-orphan neighbors
            if not neighbors:
                continue
            # Collect all weights from neighbors
            weight_sums = {}
            count = 0
            for ni in neighbors:
                nv = mesh.vertices[ni]
                for g in nv.groups:
                    gname = obj.vertex_groups[g.group].name
                    weight_sums[gname] = weight_sums.get(gname, 0.0) + g.weight
                count += 1
            if count == 0:
                continue
            # Average and assign
            for gname, wsum in weight_sums.items():
                avg = wsum / count
                if avg > 0.01:  # skip negligible weights
                    vg = obj.vertex_groups.get(gname)
                    if vg:
                        vg.add([vi], avg, 'REPLACE')
            fixed += 1

        if fixed > 0:
            print(f"  [weights] Fixed {fixed}/{len(orphans)} orphan verts in {obj.name}")


def export_glb(filepath, mesh_only=False, anim_only=False):
    # Fix orphan vertex weights before mesh export
    if not anim_only:
        fix_orphan_vertices()

    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if anim_only:
            if obj.type == "ARMATURE":
                obj.select_set(True)
        else:
            if obj.type in ("MESH", "ARMATURE"):
                obj.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format="GLB",
        use_selection=True,
        export_animations=not mesh_only,
        export_skins=not anim_only,
        export_morph=not anim_only,
        export_lights=False,
        export_cameras=False,
        export_materials="NONE" if anim_only else "EXPORT",
        export_yup=True,
    )
    size_kb = os.path.getsize(filepath) / 1024
    mode = "mesh-only" if mesh_only else "anim-only" if anim_only else "full"
    print(f"\nExported ({mode}): {filepath} ({size_kb:.0f} KB)")


# ─── Main ────────────────────────────────────────────────────────────

def main():
    args = get_args()
    mesh_only = args.get("mesh_only", False)
    anim_only = args.get("anim_only", False)

    if anim_only:
        # ── Anim-only mode ────────────────────────────────────────
        ref_fbx = args.get("ref_fbx")
        anim_list = args.get("anim_fbx", [])
        out_path = args.get("out", "anims.glb")

        if not ref_fbx or not anim_list:
            print("Error: --anim-only requires --ref-fbx and --anim-fbx")
            sys.exit(1)

        print(f"\n{'='*60}")
        print(f"Anim-only: {len(anim_list)} animations")
        print(f"Reference: {os.path.basename(ref_fbx)}")
        print(f"Output:    {out_path}")
        print(f"{'='*60}")

        clear_scene()

        # Import reference character (target skeleton)
        print(f"\nImporting reference skeleton...")
        import_fbx(ref_fbx)
        target_arm = find_armature()
        if not target_arm:
            print("Error: no armature in reference FBX")
            sys.exit(1)
        print(f"Target skeleton: {target_arm.name} ({len(target_arm.data.bones)} bones)")

        # Remove mesh children (we only need the skeleton for anim-only)
        for child in list(target_arm.children):
            if child.type == "MESH":
                bpy.data.objects.remove(child, do_unlink=True)

        # Set of objects to keep (target armature only)
        keep_objects = {target_arm}

        # Ensure target has animation data
        if not target_arm.animation_data:
            target_arm.animation_data_create()

        # Import and retarget each animation
        baked_actions = []
        for i, anim_path in enumerate(anim_list):
            print(f"\n[{i+1}/{len(anim_list)}] {os.path.basename(anim_path)}")
            baked = import_and_retarget_anim(target_arm, anim_path, keep_objects)
            if baked:
                baked_actions.append(baked)

        # Push all baked actions to NLA tracks
        for action in baked_actions:
            track = target_arm.animation_data.nla_tracks.new()
            track.name = action.name
            strip = track.strips.new(action.name, int(action.frame_range[0]), action)
            strip.name = action.name

        print(f"\n{len(baked_actions)} animations retargeted successfully")

        # Clean up: remove any leftover actions that aren't ours (source anim actions)
        valid_names = {a.name for a in baked_actions}
        for action in list(bpy.data.actions):
            if action.name not in valid_names:
                bpy.data.actions.remove(action)

        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        export_glb(out_path, anim_only=True)

    elif mesh_only:
        # ── Mesh-only mode ────────────────────────────────────────
        fbx_path = args.get("fbx")
        out_path = args.get("out", "mesh.glb")

        if not fbx_path:
            print("Error: --mesh-only requires --fbx")
            sys.exit(1)

        print(f"\n{'='*60}")
        print(f"Mesh-only: {os.path.basename(fbx_path)}")
        print(f"Output:    {out_path}")
        print(f"{'='*60}")

        clear_scene()
        import_fbx(fbx_path)

        armature = find_armature()
        if armature:
            print(f"Armature: {armature.name} ({len(armature.data.bones)} bones)")

        # Apply materials
        if "materials" in args:
            print(f"Applying materials...")
            apply_materials(args["materials"])

        # Remove any baked-in animations (we want mesh-only)
        for action in list(bpy.data.actions):
            bpy.data.actions.remove(action)
        if armature and armature.animation_data:
            armature.animation_data_clear()

        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        export_glb(out_path, mesh_only=True)

    else:
        print("Error: specify --mesh-only or --anim-only")
        sys.exit(1)


if __name__ == "__main__":
    main()

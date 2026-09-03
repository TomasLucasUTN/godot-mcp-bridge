/**
 * Scene operation tools for Godot MCP Server
 * Tools for creating, reading, and modifying Godot scenes (.tscn files)
 */

import type { ToolDefinition } from '../types.js';

export const sceneTools: ToolDefinition[] = [
  {
    name: 'create_scene',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Create a new Godot scene (.tscn) file with nodes. Use this to create player scenes, UI screens, game objects, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Scene file path (e.g., res://Scenes/player.tscn)'
        },
        root_node_name: {
          type: 'string',
          description: 'Name of root node (default: derived from filename)'
        },
        root_node_type: {
          type: 'string',
          description: 'Type of root node (e.g., Node2D, CharacterBody2D, Control, Node3D). REQUIRED.'
        },
        nodes: {
          type: 'array',
          items: { type: 'object', description: 'A node spec: {name|node_name, type|node_type, properties?, script?, groups?, children?}. Unknown keys are rejected with an error.' },
          description: 'Array of child nodes to add. Each node spec: {name|node_name, type|node_type, properties?, script?, groups?, children?}. Use either {name, type} or the same {node_name, node_type} keys used at the top level \u2014 both work. Unknown keys (e.g. "class", "kind", "parent") return an error instead of silently producing a generic Node.'
        },
        attach_script: {
          type: 'string',
          description: 'Optional script path to attach to root node (res://path/to/script.gd)'
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, preview the scene that would be created (root_type, child_count) without saving anything to disk. Defaults to false.'
        }
      },
      required: ['scene_path', 'root_node_type']
    }
  },
  {
    name: 'read_scene',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read and parse a scene file to get its node structure (and optionally properties). Use this to understand a scene before editing. On large scenes pass max_depth for a cheap shallow read — a depth-limited node reports children_truncated instead of expanding.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the scene file (res://path/to/scene.tscn)'
        },
        include_properties: {
          type: 'boolean',
          description: 'Include a fixed set of common properties (position, rotation, scale, size, visible, modulate, z_index, text, collision layers, mass) on every node. Prefer `properties` when you know what you want — this one is all-or-nothing and gets expensive on a big tree.'
        },
        properties: {
          type: 'array',
          items: { type: 'string' },
          description: 'Return exactly these properties on every node, e.g. ["position"] to get the whole layout of a 2D scene in one call. Overrides include_properties. A name the node does not have is reported under missing_properties rather than silently omitted, so a typo is visible.'
        },
        max_depth: {
          type: 'number',
          description: 'Max tree depth to expand (root is 0). Omit or -1 for the full tree. Use 1-2 for a cheap overview of a big scene.'
        }
      },
      required: ['scene_path']
    }
  },
  {
    name: 'add_node',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a node to an existing scene file. Supports an optional script attachment, group memberships, and a tree of children created in the same call (1 tool call instead of N). Children format: {name|node_name, type|node_type, properties?, script?, groups?, children?}. Both key styles are accepted so children can reuse the same keys you use at the top level (node_name, node_type) or the shorter form (name, type). Unknown child keys are rejected with a clear error.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the scene file (res://path/to/scene.tscn)'
        },
        node_name: {
          type: 'string',
          description: 'Name for the new node'
        },
        node_type: {
          type: 'string',
          description: 'Type of node (e.g., Sprite2D, Camera2D, RigidBody2D, CollisionShape2D)'
        },
        parent_path: {
          type: 'string',
          description: 'Path to parent node (. for root, or relative path like Sprite2D)'
        },
        properties: {
          type: 'object',
          description: 'Optional dictionary of properties to set on the node'
        },
        script: {
          type: 'string',
          description: 'Optional script path to attach to the new node (res://path/to/script.gd)'
        },
        groups: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of node groups this node should belong to. Persisted to the .tscn file.'
        },
        children: {
          type: 'array',
          items: { type: 'object', description: '{name, type, properties?, script?, groups?, children?}' },
          description: 'Optional tree of children to create under the new node. Each entry has the same shape as add_node\'s args (minus parent_path). Use this to build sub-trees in one call.'
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, preview the node (and any children) that would be added, without saving the scene. Defaults to false.'
        }
      },
      required: ['scene_path', 'node_name', 'node_type']
    }
  },
  {
    name: 'remove_node',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Remove a node from an existing scene file.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the node to remove (cannot be root, use relative path)'
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, preview the removal (returns the node\'s name, type, and child count) without saving the scene. Defaults to false.'
        }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'modify_node_property',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Modify ONE property on ONE node. Use this when you know the node and the single value to change. NOT for several properties on the same node (set_node_properties, one save instead of N) and NOT for the same property across many nodes (batch_set_property). ALWAYS use a tool to modify .tscn files \u2014 NEVER edit them as text. To attach or change a script, use attach_script (NOT modify_node_property with property="script") \u2014 modify_node_property only rewrites the .tscn on disk, leaving the editor\'s in-memory node without the script, which makes connect_signal fail.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the .tscn scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the node (. for root, or relative path like "Sprite2D")'
        },
        property_name: {
          type: 'string',
          description: 'Name of the property to modify (position, scale, rotation, modulate, visible, etc.)'
        },
        value: {
          description: 'New value for the property. ANY JSON value accepted: primitives (numbers, strings, booleans, null), arrays, or objects. Use the {type, ...} discriminated form for Godot variant types. Common forms: numeric (e.g. 1.5), boolean (true), string ("hello"), Vector2 ({type:"Vector2",x,y}), Vector3 ({type:"Vector3",x,y,z}), Color ({type:"Color",r,g,b,a}), Quaternion ({type:"Quaternion",x,y,z,w}), Basis ({type:"Basis",euler:{x,y,z}}), Transform3D ({type:"Transform3D",basis:{...},origin:{x,y,z}}), AABB ({type:"AABB",position:{x,y,z},size:{x,y,z}}), Rect2 ({type:"Rect2",x,y,width,height}), NodePath (string starting with "."). For Resource-typed properties (Texture2D, Mesh, Material, Shape, etc.) DO NOT pass values here \u2014 use set_resource_property, set_sprite_texture, set_mesh, set_material, or set_collision_shape.'
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, preview the change (returns old_value/new_value) without saving the scene. Defaults to false.'
        }
      },
      required: ['scene_path', 'property_name', 'value']
    }
  },
  {
    name: 'rename_node',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Rename a node in a scene.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the node to rename'
        },
        new_name: {
          type: 'string',
          description: 'New name for the node'
        },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path', 'new_name']
    }
  },
  {
    name: 'move_node',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Move a node to a different parent in a scene and optionally control its position among siblings.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the node to move'
        },
        new_parent_path: {
          type: 'string',
          description: 'Path to the new parent node (. for root)'
        },
        sibling_index: {
          type: 'number',
          description: 'Optional position among siblings (0 = first child). Omit or -1 to append.'
        },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path', 'new_parent_path']
    }
  },
  {
    name: 'duplicate_node',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Duplicate a node and its children within the same scene, inserted right after the original as a sibling.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the node to duplicate (cannot be root)'
        },
        new_name: {
          type: 'string',
          description: 'Optional name for the duplicate. Defaults to the original name with an incrementing number suffix.'
        },
        dry_run: { type: 'boolean', description: 'Preview what would be duplicated without writing anything. Default false. The handler has always supported this; it was missing from the schema, so the unknown-argument guard rejected it.' }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'set_anchor_preset',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Apply an anchor preset to a Control node via Control.set_anchors_preset().',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the Control node'
        },
        preset: {
          type: 'string',
          description: 'One of: top_left, top_right, bottom_left, bottom_right, center_left, center_top, center_right, center_bottom, center, top_wide, bottom_wide, left_wide, right_wide, vcenter_wide, hcenter_wide, full_rect'
        },
        keep_offsets: {
          type: 'boolean',
          description: 'Keep the current offsets instead of resetting them to match the preset (default: false)'
        },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path', 'preset']
    }
  },
  {
    name: 'attach_script',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Attach or change a script on a node in a scene.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the node (. for root, or relative path)'
        },
        script_path: {
          type: 'string',
          description: 'Path to the script file (res://path/to/script.gd)'
        },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'script_path']
    }
  },
  {
    name: 'detach_script',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Remove a script from a node in a scene.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the node (. for root)'
        },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'set_collision_shape',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Create and assign a collision shape resource to a CollisionShape2D or CollisionShape3D node. Supports: CircleShape2D, RectangleShape2D, CapsuleShape2D, SphereShape3D, BoxShape3D, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the .tscn scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the CollisionShape2D/3D node'
        },
        shape_type: {
          type: 'string',
          description: 'Shape type: CircleShape2D, RectangleShape2D, CapsuleShape2D, SphereShape3D, BoxShape3D, etc.'
        },
        shape_params: {
          type: 'object',
          description: 'Shape parameters: {radius: 32} for circles, {size: {x: 64, y: 64}} for rectangles, etc.'
        },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'shape_type']
    }
  },
  {
    name: 'set_sprite_texture',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Assign a texture resource to a Sprite2D / Sprite3D / TextureRect node in a .tscn scene file. Modes:\n  \u2022 FromPath  \u2014 load any texture file from disk (png/jpg/webp/svg/.tres) via load(). Returns whatever Texture2D the importer produced (usually CompressedTexture2D). Most common after generate_2d_asset.\n  \u2022 ImageTexture (DEPRECATED ALIAS for FromPath, kept for back-compat)\n  \u2022 NewImageTexture \u2014 force-create an ImageTexture (in-memory) from a raw image file.\n  \u2022 PlaceholderTexture2D \u2014 in-scene placeholder of a given size.\n  \u2022 GradientTexture2D / NoiseTexture2D \u2014 procedural textures.\nResponse always includes texture_class (the actual Godot class the texture decoded to), width, height, and texture_path so the agent can confirm what landed without an extra get_resource_info call.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the .tscn scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the Sprite2D/Sprite3D/TextureRect node'
        },
        texture_type: {
          type: 'string',
          enum: ['FromPath', 'ImageTexture', 'NewImageTexture', 'PlaceholderTexture2D', 'GradientTexture2D', 'NoiseTexture2D'],
          description: 'How to obtain the texture. Prefer FromPath for assets on disk.'
        },
        texture_params: {
          type: 'object',
          description: 'Texture parameters. FromPath / ImageTexture / NewImageTexture: {path: "res://assets/sprite.png"}. PlaceholderTexture2D: {size: {x: 64, y: 64}}. GradientTexture2D / NoiseTexture2D: {width, height}.'
        },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'texture_type']
    }
  },
  {
    name: 'instance_scene',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add an instance of another scene (.tscn) as a child node. This is how you compose scenes from reusable parts (like prefabs). The instance maintains a live reference to the source scene. Use this instead of add_node when you want to reuse an existing scene.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the scene file being edited (the parent scene)'
        },
        instance_path: {
          type: 'string',
          description: 'Path to the .tscn scene to instance (the child/prefab scene)'
        },
        node_name: {
          type: 'string',
          description: 'Optional name for the instance. If omitted, uses the instanced scene\'s root node name.'
        },
        parent_path: {
          type: 'string',
          description: 'Path to parent node within the scene (. for root, or relative path like Level/Enemies)'
        },
        properties: {
          type: 'object',
          description: 'Optional property overrides on the instance root (e.g., {position: {type: "Vector3", x: 5, y: 0, z: 10}})'
        },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'instance_path']
    }
  },
  {
    name: 'set_node_reference',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: "Point an exported property at another NODE in the same scene — the wiring you would otherwise do by dragging a node into an inspector slot. Use for any @export typed as a node (`@export var target: Area2D`, `@export var health: HealthComponent`) or as a NodePath. set_node_properties CANNOT do this: it takes a JSON value, and this needs a live object reference. Fails loudly if the property does not exist or is typed for a different node class, instead of silently doing nothing.",
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the .tscn scene file' },
        node_path: { type: 'string', description: 'Node that HOLDS the property (. for root, or a relative path)' },
        property: { type: 'string', description: 'Name of the exported property to set, e.g. "initial_state" or "health"' },
        target_path: { type: 'string', description: 'Node it should point AT, relative to the scene root, e.g. "StateMachine/Idle"' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path', 'property', 'target_path']
    }
  },
  {
    name: 'set_mesh',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Create and assign a mesh resource to a MeshInstance3D node. REQUIRED to make 3D geometry visible. Primitive types: BoxMesh, SphereMesh, CylinderMesh, CapsuleMesh, PlaneMesh, PrismMesh, TorusMesh, QuadMesh, TextMesh. Or load from file.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the .tscn scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the MeshInstance3D node within the scene'
        },
        mesh_type: {
          type: 'string',
          description: 'Mesh class: "BoxMesh", "SphereMesh", "CylinderMesh", "CapsuleMesh", "PlaneMesh", "PrismMesh", "TorusMesh", "QuadMesh", "TextMesh", or "file" to load from a resource path'
        },
        mesh_params: {
          type: 'object',
          description: 'BoxMesh: {size:{x,y,z}}. SphereMesh: {radius,height,radial_segments,rings}. CylinderMesh: {top_radius,bottom_radius,height}. CapsuleMesh: {radius,height}. PlaneMesh: {size:{x,y}}. PrismMesh: {left_to_right,size:{x,y,z}}. TorusMesh: {inner_radius,outer_radius,rings}. QuadMesh: {size:{x,y}}. TextMesh: {text,font_size,depth}. file: {path:"res://mesh.tres"}'
        },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'mesh_type']
    }
  },
  {
    name: 'set_material',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Create and assign a material to a MeshInstance3D, CSG, or GeometryInstance3D node. Supports StandardMaterial3D or loading from file.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the .tscn scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the target node'
        },
        material_type: {
          type: 'string',
          description: '"StandardMaterial3D" or "file" to load from a resource path'
        },
        material_params: {
          type: 'object',
          description: 'StandardMaterial3D: {albedo_color:{r,g,b,a}, metallic:0-1, roughness:0-1, emission:{r,g,b}, emission_energy:float, transparency:0=disabled/1=alpha/2=scissor/3=hash/4=depth_pre_pass}. file: {path:"res://material.tres"}'
        },
        surface_index: {
          type: 'number',
          description: 'For MeshInstance3D only: surface index for per-surface override. Omit for material_override on all surfaces.'
        },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'material_type']
    }
  },
  {
    name: 'get_node_spatial_info',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Query computed 3D spatial data for a Node3D in a scene file. Returns local/global positions, scales, rotation quaternions, and subtree bounding boxes (AABB) when available. Use this before making precise 3D placement decisions.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the .tscn scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the Node3D (. for root, or relative path like Level/Props/Crate)'
        },
        include_bounds: {
          type: 'boolean',
          description: 'Include computed subtree AABBs when visual descendants exist (default: true)'
        }
      },
      required: ['scene_path']
    }
  },
  {
    name: 'measure_node_distance',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Measure the world-space distance between two Node3D nodes in a scene file. Returns both the full 3D delta and the horizontal XZ distance.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the .tscn scene file'
        },
        from_node_path: {
          type: 'string',
          description: 'Path to the first Node3D'
        },
        to_node_path: {
          type: 'string',
          description: 'Path to the second Node3D'
        }
      },
      required: ['scene_path', 'from_node_path', 'to_node_path']
    }
  },
  {
    name: 'snap_node_to_grid',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Snap a Node3D position to a grid in local or global space. Useful for modular level building and keeping 3D scenes aligned.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: {
          type: 'string',
          description: 'Path to the .tscn scene file'
        },
        node_path: {
          type: 'string',
          description: 'Path to the Node3D to snap'
        },
        grid_size: {
          description: 'Positive grid size. Use a number for uniform snapping or {x,y,z} for per-axis snapping.',
          oneOf: [
            { type: 'number' },
            {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                z: { type: 'number' }
              },
              required: ['x', 'y', 'z']
            }
          ]
        },
        axes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Axes to snap. Any of: ["x"], ["x","z"], ["x","y","z"] (default: all axes)'
        },
        space: {
          type: 'string', enum: ['local', 'global'],
          description: 'Coordinate space: "local" or "global" (default: "global")'
        },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'grid_size']
    }
  },
  {
    name: 'set_node_properties',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Set SEVERAL properties on ONE node in a single call and a single save. Use this instead of repeating modify_node_property. NOT for the same property across many nodes — that is batch_set_property. Non-atomic: each property is applied independently; the response separates "applied" from "failed" so partial success surfaces clearly. Saves the scene once at the end. Resource-typed properties must use set_resource_property / set_sprite_texture / etc.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the .tscn scene file' },
        node_path: { type: 'string', description: 'Path to the node (. for root, or relative path)' },
        properties: {
          type: 'object',
          description: 'Map of property_name -> value. Each value follows the same form as modify_node_property.value (primitives, arrays, or {type:"Vector3",...} discriminated objects).'
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, preview the changes ("applied"/"failed" as usual) without saving the scene. Defaults to false.'
        }
      },
      required: ['scene_path', 'properties']
    }
  },
  {
    name: 'set_node_groups',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Set, add, or remove a node\'s group memberships in a .tscn scene file. Groups persist to disk so the running game can call get_tree().get_nodes_in_group(name).',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['replace', 'add', 'remove'],
          description: 'replace (default): node ends up in EXACTLY the listed groups. add: union with existing. remove: drop the listed groups.'
        },
        scene_path: { type: 'string', description: 'Path to the .tscn scene file' },
        node_path: { type: 'string', description: 'Path to the node (. for root)' },
        groups: { type: 'array', items: { type: 'string' }, description: 'List of group names to apply' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'groups']
    }
  },
  {
    name: 'get_node_groups',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read the list of groups a node belongs to in a .tscn scene file.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string' },
        node_path: { type: 'string' }
      },
      required: ['scene_path']
    }
  },
  {
    name: 'find_nodes_in_group',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Find every node in a .tscn that belongs to a given group. Returns paths, names, and types. Useful for verifying that level.gd will actually pick up the right nodes via get_tree().get_nodes_in_group().',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string' },
        group: { type: 'string', description: 'Group name to search for' }
      },
      required: ['scene_path', 'group']
    }
  },
  {
    name: 'set_resource_property',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Modify a property on a Resource that is currently held by a node (or by another resource attached to that node). Use this to tweak shape radii, material colors, gradient stops, etc., WITHOUT recreating the resource. resource_path walks from the node down to the resource using "/"-separated property names, e.g. "shape", "material", or "material/next_pass". After the change, saves the scene.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the .tscn scene file' },
        node_path: { type: 'string', description: 'Path to the node owning the resource' },
        resource_path: { type: 'string', description: 'Path from node to the target resource via property names. Examples: "shape", "material", "material/next_pass"' },
        property_name: { type: 'string', description: 'Property on the target resource to set (e.g. "radius", "albedo_color")' },
        value: { description: 'New value (same shape as modify_node_property.value)' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'resource_path', 'property_name', 'value']
    }
  },
  {
    name: 'save_resource_to_file',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Save a Resource currently held by a node (or sub-resource) to a standalone .tres file so it can be referenced by other scenes / shared / committed. The node\'s property is then re-pointed to the loaded-from-disk version, so future set_resource_property calls write through to that file. Works for any Resource subclass: Material, Mesh, Shape, Curve, Gradient, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string' },
        node_path: { type: 'string' },
        resource_path: { type: 'string', description: 'Path from node to the resource (e.g. "shape", "material")' },
        save_to: { type: 'string', description: 'Destination path (res://.../foo.tres)' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'resource_path', 'save_to']
    }
  },
  {
    name: 'get_resource_info',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Inspect ANY Godot Resource. Two modes:\n  \u2022 path mode: pass {path: "res://foo.png"} for a resource on disk (.tres / .res / image / .glb / .ogg / .tscn / etc.)\n  \u2022 node mode: pass {scene_path, node_path, resource_property} to inspect a resource attached to a node WITHOUT having to save it as .tres first (e.g. the shape on a CollisionShape2D, the material on a MeshInstance3D, the stream on an AudioStreamPlayer).\nReturns class, file size (path mode), and type-specific info: width/height for textures, vertex/surface counts and AABB for meshes, length for AudioStream/Animation, node count for PackedScene, common Material properties, Shape extents, and the resource\'s dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path mode: resource path on disk (res://...).' },
        scene_path: { type: 'string', description: 'Node mode: path to the .tscn that owns the node.' },
        node_path: { type: 'string', description: 'Node mode: path to the node within the scene.' },
        resource_property: { type: 'string', description: 'Node mode: property name on the node holding the resource (e.g. "shape", "material", "stream", "texture").' }
      }
    }
  },
  {
    name: 'list_signal_connections',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List signal connections involving a node. source="scene_file" (default) reads connections persisted to a .tscn. source="runtime" requires the game to be running and reads live connections from the SceneTree. Use the runtime mode to verify dynamically-connected signals (those connected from code in _ready, not in the editor).',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['scene_file', 'runtime'], description: 'Where to read connections from. Default: scene_file' },
        scene_path: { type: 'string', description: 'For source="scene_file": path to the .tscn' },
        node_path: { type: 'string', description: 'Path to the node. For source="runtime" use absolute (/root/Main/Player) or relative to current_scene.' },
        include_outgoing: { type: 'boolean', description: 'Include signals that this node emits (default: true)' },
        include_incoming: { type: 'boolean', description: 'Include signals from other nodes whose handler is on this node (default: true). Only honored for scene_file source.' }
      },
      required: ['node_path']
    }
  },
  {
    name: 'connect_signal',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Connect a signal between two nodes inside a .tscn scene file. The target script must define the method (will refuse otherwise). Equivalent to clicking the "+" in the editor\'s Node > Signals panel and persists the connection to the .tscn. NOTE: scripts must be attached via attach_script (NOT via modify_node_property), otherwise the editor\'s in-memory node will not see the script and this tool will reject the connection.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string' },
        from_node: { type: 'string', description: 'Path to the emitting node' },
        signal: { type: 'string', description: 'Signal name on the emitting node' },
        to_node: { type: 'string', description: 'Path to the receiving node' },
        method: { type: 'string', description: 'Method name on the receiving node\'s script' },
        flags: { type: 'number', description: 'Connection flags (CONNECT_DEFERRED=1, CONNECT_PERSIST=2, CONNECT_ONE_SHOT=4). Default 0.' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'from_node', 'signal', 'to_node', 'method']
    }
  },
  {
    name: 'wire_signal',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Connect a signal AND scaffold its typed handler in one call. Reads the emitter signal\'s argument types, writes a matching `func _on_x(...)` stub into the receiver\'s attached script (only if that method is not already defined), then persists the connection to the .tscn. Unlike connect_signal, you do NOT have to hand-write the handler first: the receiver just needs a script attached (via attach_script). If `method` is omitted, a Godot-convention name is generated (`_on_<from_node>_<signal>`). Returns stub_added, the handler name, and its parameter signature.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string' },
        from_node: { type: 'string', description: 'Path to the emitting node' },
        signal: { type: 'string', description: 'Signal name on the emitting node' },
        to_node: { type: 'string', description: 'Path to the receiving node (must have a script attached)' },
        method: { type: 'string', description: 'Handler method name. Optional — defaults to _on_<from_node>_<signal>.' },
        flags: { type: 'number', description: 'Connection flags (CONNECT_DEFERRED=1, CONNECT_PERSIST=2, CONNECT_ONE_SHOT=4). Default 0.' }
      },
      required: ['scene_path', 'from_node', 'signal', 'to_node']
    }
  },
  {
    name: 'generate_onready_refs',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Scan a scene subtree and generate typed `@onready var` declarations for named child nodes (`%Name` for scene-unique nodes, else `$RelativePath`), typed by each node\'s script class_name or engine class. Returns the ready-to-paste block. With insert:true it splices the block into the target node\'s attached script right after the @tool/class_name/extends header, skipping any var already declared (idempotent). Read-only unless insert is true. Nodes whose name is not a valid identifier, or that would collide with an already-emitted var, are reported in `skipped`.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string' },
        target_node: { type: 'string', description: 'Node whose children to reference (default "." = scene root)' },
        include_nested: { type: 'boolean', description: 'Recurse into the whole subtree instead of only direct children. Default false.' },
        insert: { type: 'boolean', description: 'Insert the block into target_node\'s attached script. Default false (returns the block only).' }
      },
      required: ['scene_path']
    }
  },
  {
    name: 'scaffold_entity',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Create a complete character/enemy/pickup scene in one call: physics body root + CollisionShape with a REAL shape resource attached (so the "no shape" warning never appears) + a sprite + an optional starter movement script. Replaces the 5-7 manual steps every Godot tutorial repeats per character. Movement templates ("platformer" = gravity/jump/run, "topdown" = 8-way) are written close to the official docs versions and require CharacterBody2D.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Where to create the scene, e.g. res://scenes/enemy.tscn' },
        entity_name: { type: 'string', description: 'Root node name. Defaults to the file name in PascalCase.' },
        body_type: { type: 'string', description: 'CharacterBody2D (default), RigidBody2D, StaticBody2D, Area2D, or the 3D variants.' },
        collision_shape: { type: 'string', description: 'capsule (default), rect, or circle. Resolved to the right 2D/3D shape class.' },
        shape_params: { type: 'object', description: 'Shape dimensions, e.g. {"radius":16,"height":48} for a capsule or {"size":[32,32]} for a rect.' },
        sprite: { type: 'string', description: 'Sprite2D (default), AnimatedSprite2D, MeshInstance3D, or "none" to skip.' },
        texture: { type: 'string', description: 'Optional texture res:// path for the sprite.' },
        script_path: { type: 'string', description: 'Where to write/attach the script. Defaults to the scene path with a .gd extension.' },
        movement: { type: 'string', enum: ['platformer', 'topdown', 'none'], description: '"platformer", "topdown", or "none" (default). Anything but "none" writes a starter script and attaches it.' },
        groups: { type: 'array', items: { type: 'string' }, description: 'Groups to add the root to, e.g. ["enemies"].' }
      },
      required: ['scene_path']
    }
  },
  {
    name: 'scaffold_state_machine',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Scaffold a working finite state machine: a StateMachine node under the host, one child node + script per state, and a shared State base class — all wired (states get a `host` reference and a transition_requested signal; the machine is pointed at the first state). Replaces copy-pasting the same FSM boilerplate between every enemy. Existing script files are never overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Scene to add the state machine to' },
        states: { type: 'array', items: { type: 'string' }, description: 'State names, e.g. ["idle","patrol","chase"]. First one becomes the initial state.' },
        host_path: { type: 'string', description: 'Node the machine hangs off of (it drives its parent). Default "." (scene root).' },
        machine_name: { type: 'string', description: 'Name of the machine node. Default "StateMachine".' },
        out_dir: { type: 'string', description: 'Folder for the generated scripts. Default: a "states" folder next to the scene.' }
      },
      required: ['scene_path', 'states']
    }
  },
  {
    name: 'disconnect_signal',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Remove a signal connection from a .tscn scene file. No-op if the connection doesn\'t exist.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string' },
        from_node: { type: 'string' },
        signal: { type: 'string' },
        to_node: { type: 'string' },
        method: { type: 'string' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'from_node', 'signal', 'to_node', 'method']
    }
  },
  {
    name: 'batch_scene_edit',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: "Apply many structural/property edits to ONE scene with a single load and a single save — much faster than N separate add_node/set_node_properties/... calls on a closed scene (each of those re-loads and re-saves the whole .tscn). For an open scene the whole batch lands on the live editor tree and marks it dirty (no disk write). Ops run in order; stop_on_error (default true) discards the entire batch — nothing saved — on the first failure. Op types: add_node {node_name,node_type,parent_path,properties?,script?,groups?,children?}, set_properties {node_path,properties}, remove_node {node_path}, rename_node {node_path,new_name}, move_node {node_path,new_parent_path,sibling_index?}.",
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the .tscn file' },
        operations: {
          type: 'array',
          description: 'Ordered edits. Each is an object with an "op" field and that op\'s args.',
          items: { type: 'object', description: '{ op: "add_node"|"set_properties"|"remove_node"|"rename_node"|"move_node", ...args }' }
        },
        stop_on_error: { type: 'boolean', description: 'Discard the whole batch (save nothing) on the first failing op. Default true.' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'operations']
    }
  }
];

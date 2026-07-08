export const COFFEE_CUP_DEMO_ID = "coffee_cup";

export function getCoffeeCupDemoScript(): string {
  return `
bpy.ops.mesh.primitive_plane_add(size=8.0, location=(0.0, 0.0, -0.75))
table = bpy.context.object
table.name = "Table"

bpy.ops.mesh.primitive_cylinder_add(radius=0.9, depth=1.4, location=(0.0, 0.0, 0.0))
cup = bpy.context.object
cup.name = "Cup"

bpy.ops.mesh.primitive_cylinder_add(radius=0.72, depth=1.1, location=(0.0, 0.0, 0.12))
coffee = bpy.context.object
coffee.name = "Coffee"

bpy.ops.mesh.primitive_torus_add(
    major_radius=0.45,
    minor_radius=0.08,
    location=(0.88, 0.0, 0.05),
    rotation=(1.5708, 0.0, 0.0)
)
handle = bpy.context.object
handle.name = "Handle"

cup.scale = (1.0, 1.0, 1.1)
coffee.scale = (1.0, 1.0, 0.15)
table.scale = (1.0, 1.0, 1.0)
`;
}

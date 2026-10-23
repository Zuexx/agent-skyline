shader_type spatial;
// warm light spilling from lit windows / the door onto the ground: additive, soft, stretched in depth by the mesh
render_mode blend_add, unshaded, depth_draw_never, cull_disabled;
uniform vec4 color : source_color = vec4(1.0, 0.62, 0.28, 1.0);
uniform float energy = 1.0;
void fragment() {
	vec2 q = (UV - 0.5) * 2.0;
	float d = length(q);
	float a = pow(max(1.0 - d, 0.0), 2.2);
	ALBEDO = color.rgb * energy * a;
}

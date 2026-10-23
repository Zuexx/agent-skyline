// shared patterns for the forbidden-zone effects (barrier, runes, curtain, wall, seal)

float mg_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// x = distance to the hex grid lines, yz = cell id
vec3 mg_hexgrid(vec2 p) {
	vec2 r = vec2(1.0, 1.732);
	vec2 h = r * 0.5;
	vec2 a = mod(p, r) - h;
	vec2 b = mod(p - h, r) - h;
	vec2 g = dot(a, a) < dot(b, b) ? a : b;
	vec2 q = abs(g);
	float d = 0.5 - max(dot(q, normalize(vec2(1.0, 1.732))), q.x);
	return vec3(d, p - g);
}

// one made-up rune in a unit cell (not letters): a stem plus bars / a diagonal / a dot chosen by hash
float mg_rune(vec2 p, float id, float w) {
	if (p.x < 0.12 || p.x > 0.88 || p.y < 0.08 || p.y > 0.92) return 0.0;
	float h1 = mg_hash(vec2(id, 1.3)), h2 = mg_hash(vec2(id, 2.7)), h3 = mg_hash(vec2(id, 3.1)), h4 = mg_hash(vec2(id, 4.9));
	float s = smoothstep(w, 0.0, abs(p.x - 0.5)) * step(0.15, p.y) * step(p.y, 0.85);
	float o = s;
	if (h1 > 0.3) o = max(o, smoothstep(w, 0.0, abs(p.y - 0.22)) * step(abs(p.x - 0.5 - (h1 - 0.65) * 0.6), 0.26));
	if (h2 > 0.45) o = max(o, smoothstep(w, 0.0, abs(p.y - 0.62)) * step(abs(p.x - 0.5 + (h2 - 0.72) * 0.6), 0.22));
	if (h3 > 0.5) o = max(o, smoothstep(w, 0.0, abs((p.y - 0.5) - (p.x - 0.5) * (h3 > 0.75 ? 1.3 : -1.3))) * step(abs(p.x - 0.5), 0.3));
	if (h4 > 0.6) o = max(o, smoothstep(0.09, 0.05, length(p - vec2(h4 > 0.8 ? 0.72 : 0.28, 0.85))));
	return o;
}

// distance to the edges of an equilateral triangle inscribed in radius R, rotated by a
float mg_tri(vec2 p, float R, float a) {
	float d = 1e9;
	for (int k = 0; k < 3; k++) {
		float t = a + float(k) * 2.0944;
		d = min(d, abs(dot(p, vec2(cos(t), sin(t))) + R * 0.5));
	}
	return d;
}

// full magic circle, p in [-1, 1]: outer rings, a rotating band of runes, a hexagram, an inner rune ring
float mg_circle(vec2 p, float t, float w) {
	float r = length(p);
	if (r > 1.0) return 0.0;
	float ang = atan(p.y, p.x);
	float o = smoothstep(w * 1.6, 0.0, abs(r - 0.97));
	o = max(o, smoothstep(w, 0.0, abs(r - 0.86)));
	if (r > 0.87 && r < 0.96) {
		float u = (ang / 6.2832 + 0.5) * 40.0 + t * 0.35;
		o = max(o, mg_rune(vec2(fract(u), (r - 0.87) / 0.09), floor(u), 0.09));
	}
	float hex = min(mg_tri(p, 0.84, t * 0.08), mg_tri(p, 0.84, t * 0.08 + 1.0472));
	o = max(o, smoothstep(w, 0.0, hex) * step(r, 0.86));
	o = max(o, smoothstep(w, 0.0, abs(r - 0.42)));
	o = max(o, smoothstep(w, 0.0, abs(r - 0.32)));
	if (r > 0.33 && r < 0.41) {
		float u = (ang / 6.2832 + 0.5) * 16.0 - t * 0.5;
		o = max(o, mg_rune(vec2(fract(u), (r - 0.33) / 0.08), floor(u) + 100.0, 0.1));
	}
	o = max(o, smoothstep(w * 2.0, 0.0, abs(r - 0.08)));
	return o;
}

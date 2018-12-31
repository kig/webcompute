// OutputSize 2073600
// Workgroups 30 270 1
// Inputs 1920 1080 0...1920:1920 0...1080:1080 4 0...30
// OutputType uint8gray 1920 1080
// Animated true
// Tiles 1 1

#version 450

#extension GL_AMD_gpu_shader_half_float: enable

layout (local_size_x = 64, local_size_y = 4, local_size_z = 1 ) in;

layout(std430, binding = 0) readonly buffer inputs {
  vec2 iResolution;
  vec2 offset;
  float subSamples;
  float frame;
};

layout(std430, binding = 1) buffer outputs {
  uint imageData[];
};




mat3 rotationXY( f16vec2 angle ) {
	float16_t cp = cos( angle.x );
	float16_t sp = sin( angle.x );
	float16_t cy = cos( angle.y );
	float16_t sy = sin( angle.y );

	return mat3(
         cy, -sy, 0.0,
         sy, cy, 0.0,
        0.0, 0.0, 1.0
	) * mat3(
        cp, 0.0, -sp,
        0.0, 1.0, 0.0,
        sp, 0.0, cp
    );
}

struct Ray {
	f16vec3 org;
	f16vec3 dir;
};
struct Sphere {
	f16vec3 center;
	float16_t radius;
};
struct Plane {
	f16vec3 p;
	f16vec3 n;
};

struct Intersection {
	float16_t t;
	f16vec3 p; // hit point
	f16vec3 n; // normal
	int hit;
};

Sphere sphere[3]; Plane plane; float16_t aspectRatio = float16_t(16.0/9.0);

void shpere_intersect(Sphere s, Ray ray, inout Intersection isect) {
	f16vec3 rs = ray.org - s.center;
	float16_t B = dot(rs, ray.dir);
	float16_t C = dot(rs, rs) - (s.radius * s.radius);
	float16_t D = B * B - C;

	if (D > 0.0)
	{
		float16_t t = -B - sqrt(D);
		if ( (t > 0.0) && (t < isect.t) )
		{
			isect.t = t;
			isect.hit = 1;

			// calculate normal.
			isect.p = ray.org + ray.dir * t;
			isect.n = normalize(isect.p - s.center);
		}
	}
}

void plane_intersect(Plane pl, Ray ray, inout Intersection isect) {
	float16_t d = -dot(pl.p, pl.n);
	float16_t v = dot(ray.dir, pl.n);

	if (abs(v) < 1.0e-6) {
		return;
	} else {
		float16_t t = -(dot(ray.org, pl.n) + d) / v;

		if ( (t > 0.0) && (t < isect.t) )
		{
			isect.hit = 1;
			isect.t = t;
			isect.n = pl.n;
			isect.p = ray.org + t * ray.dir;
		}
	}
}


void Intersect(Ray r, inout Intersection i) {
	for (int c = 0; c < 3; c++)
	{
		shpere_intersect(sphere[c], r, i);
	}
	plane_intersect(plane, r, i);
}

		
void orthoBasis(out f16vec3 basis[3], f16vec3 n) {
	basis[2] = f16vec3(n.x, n.y, n.z);
	basis[1] = f16vec3(0.0, 0.0, 0.0);

	if ((n.x < 0.6) && (n.x > -0.6))
		basis[1].x = float16_t(1.0);
	else if ((n.y < 0.6) && (n.y > -0.6))
		basis[1].y = float16_t(1.0);
	else if ((n.z < 0.6) && (n.z > -0.6))
		basis[1].z = float16_t(1.0);
	else
		basis[1].x = float16_t(1.0);


	basis[0] = cross(basis[1], basis[2]);
	basis[0] = normalize(basis[0]);

	basis[1] = cross(basis[2], basis[0]);
	basis[1] = normalize(basis[1]);

}

int seed = 0;

float16_t randomn() {
	seed = int(mod(float16_t(seed)*1364.0+626.0,5209.0));
	return float16_t(seed)/float16_t(5209.0);
}


float16_t hash2(f16vec2 n) {
	return fract(sin(dot(n, f16vec2(18.99221414, 15.839399))) * float16_t(13454.111388));
}

float16_t computeAO(inout Intersection isect) {
	const int ntheta = 8;
	const int nphi = 8;
	const float16_t eps = float16_t(0.0001);

	// Slightly move ray org towards ray dir to avoid numerical problem.
	f16vec3 p = isect.p + eps * isect.n;

	// Calculate orthogonal basis.
	 f16vec3 basis[3];
	orthoBasis(basis, isect.n);

	float16_t occlusion = float16_t(0.0);

	for (int j = 0; j < ntheta; j++)
	{
		for (int i = 0; i < nphi; i++)
		{
			// Pick a random ray direction with importance sampling.
			// p = cos(theta) / 3.141592
			float16_t r = randomn(); //hash2(isect.p.xy+vec2(i,j));
			float16_t phi = float16_t(2.0 * 3.141592 * hash2(isect.p.xy+f16vec2(float16_t(i)*9.1,float16_t(j)*9.1)));

			f16vec3 ref;
			float16_t s, c;
			s = sin(phi);
			c = cos(phi);
			ref.x = float16_t(c * sqrt(1.0 - r));
			ref.y = float16_t(s * sqrt(1.0 - r));
			ref.z = float16_t(sqrt(r));

			// local -> global
			f16vec3 rray;
			rray.x = ref.x * basis[0].x + ref.y * basis[1].x + ref.z * basis[2].x;
			rray.y = ref.x * basis[0].y + ref.y * basis[1].y + ref.z * basis[2].y;
			rray.z = ref.x * basis[0].z + ref.y * basis[1].z + ref.z * basis[2].z;

			f16vec3 raydir = f16vec3(rray.x, rray.y, rray.z);

			Ray ray;
			ray.org = p;
			ray.dir = raydir;
			
			Intersection occIsect;
			occIsect.hit = 0;
			occIsect.t = float16_t(1.0e30);
			occIsect.n = occIsect.p = f16vec3(0);
			Intersect(ray, occIsect);
			occlusion += (occIsect.hit != 0 ? float16_t(1.0) : float16_t(0.0));
		}
	}

	// [0.0, 1.0]
	occlusion = (float16_t(ntheta * nphi) - occlusion) / float16_t(ntheta * nphi);
	return occlusion;
}


void main() {
    int width = int(iResolution.x);
    int height = int(iResolution.y);
    f16vec2 fragCoord = f16vec2(gl_GlobalInvocationID.xy + offset);
    fragCoord.y = float16_t(iResolution.y) - fragCoord.y;
    f16vec2 uv = fragCoord.xy / f16vec2(iResolution.xy);
    f16vec2 duv = ((fragCoord.xy+float16_t(1.0)) / f16vec2(iResolution.xy)) - uv;
    float16_t fragColor = float16_t(0.0);
    seed = int(mod((fragCoord.x+float16_t(0.5)) * (fragCoord.y*float16_t(iResolution.y+0.5)), float16_t(65536.0)));
	
	Ray ray;
	Intersection it;

	sphere[0].center = f16vec3(-2.0, 0.0, -3.5);
	sphere[0].radius = float16_t(0.5);
	sphere[1].center = f16vec3(-0.5, 0.0, -3.0 + sin(float16_t(frame/10.0)));
	sphere[1].radius = float16_t(0.5);
	sphere[2].center = f16vec3(1.0, 0.0, -2.2);
    sphere[2].radius = float16_t(0.5);
    plane.p = f16vec3(0,-0.5, 0);
    plane.n = f16vec3(0, 1.0, 0);

    float16_t fsubSamples = float16_t(subSamples);

    for (float16_t y = float16_t(0.0); y < fsubSamples; y++) {
        for (float16_t x = float16_t(0.0); x < fsubSamples; x++) {
            f16vec2 fuv = (uv + (f16vec2(x, y) * duv / fsubSamples)) * float16_t(2.0) - float16_t(1.0);
            fuv.x *= float16_t(iResolution.x / iResolution.y);
            
            ray.org = f16vec3(0.0);
            ray.dir = normalize(f16vec3(fuv, -1.0));

            it.hit = 0;
            it.n = f16vec3(0,0,0);
            it.p = f16vec3(0,0,0);
            it.t = float16_t(10000.0);

            Intersect(ray,it);

            if (it.t < float16_t(1e3)) {
	            fragColor += computeAO(it);
            }
        }
    }
    uint tileWidth = gl_NumWorkGroups.x * gl_WorkGroupSize.x;
    uint pxoff = uint(tileWidth * gl_GlobalInvocationID.y + gl_GlobalInvocationID.x);
    uint px4off = pxoff / 4;
    uint byteIdx = pxoff - px4off * 4;
    atomicAnd(imageData[px4off], ~(uint(255) << (8 * byteIdx)));
    atomicOr(imageData[px4off], uint(255.0 * float(fragColor) / (subSamples * subSamples)) << (8 * byteIdx));
}

// OutputSize 38400
// Workgroups 30 10 1
// Inputs 1920 1080 0...1920:960 0...1080:40 4 0..200
// OutputType uint8gray 960 40
// Animated true
// Tiles 2 27

#version 450

layout (local_size_x = 32, local_size_y = 4, local_size_z = 1 ) in;

layout(std430, binding = 0) readonly buffer inputs
{
  vec2 iResolution;
  vec2 offset;
  float subSamples;
  float frame;
};

layout(std430, binding = 1) buffer outputs
{
  uint imageData[];
};




mat3 rotationXY( vec2 angle ) {
	float cp = cos( angle.x );
	float sp = sin( angle.x );
	float cy = cos( angle.y );
	float sy = sin( angle.y );

	return mat3(
         cy, -sy, 0.0,
         sy,  cy, 0.0,
        0.0, 0.0, 1.0
	) * mat3(
        cp, 0.0, -sp,
        0.0, 1.0, 0.0,
        sp, 0.0, cp
    );
}

struct Ray
{
	vec3 org;
	vec3 dir;
};
struct Sphere
{
	vec3 center;
	float radius;
};
struct Plane
{
	vec3 p;
	vec3 n;
};

struct Intersection
{
	float t;
	vec3 p;     // hit point
	vec3 n;     // normal
	int hit;
};

Sphere sphere[3];
Plane plane;
float aspectRatio = 16.0/9.0;

void shpere_intersect(Sphere s, Ray ray, inout Intersection isect)
{
	vec3 rs = ray.org - s.center;
	float B = dot(rs, ray.dir);
	float C = dot(rs, rs) - (s.radius * s.radius);
	float D = B * B - C;

	if (D > 0.0)
	{
		float t = -B - sqrt(D);
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

void plane_intersect(Plane pl, Ray ray, inout Intersection isect)
{
	float d = -dot(pl.p, pl.n);
	float v = dot(ray.dir, pl.n);

	if (abs(v) < 1.0e-6) {
		return;
	} else {
		float t = -(dot(ray.org, pl.n) + d) / v;

		if ( (t > 0.0) && (t < isect.t) )
		{
			isect.hit = 1;
			isect.t   = t;
			isect.n   = pl.n;
			isect.p = ray.org + t * ray.dir;
		}
	}
}


void Intersect(Ray r, inout Intersection i)
{
	for (int c = 0; c < 3; c++)
	{
		shpere_intersect(sphere[c], r, i);
	}
	plane_intersect(plane, r, i);
}

		
void orthoBasis(out vec3 basis[3], vec3 n)
{
	basis[2] = vec3(n.x, n.y, n.z);
	basis[1] = vec3(0.0, 0.0, 0.0);

	if ((n.x < 0.6) && (n.x > -0.6))
		basis[1].x = 1.0;
	else if ((n.y < 0.6) && (n.y > -0.6))
		basis[1].y = 1.0;
	else if ((n.z < 0.6) && (n.z > -0.6))
		basis[1].z = 1.0;
	else
		basis[1].x = 1.0;


	basis[0] = cross(basis[1], basis[2]);
	basis[0] = normalize(basis[0]);

	basis[1] = cross(basis[2], basis[0]);
	basis[1] = normalize(basis[1]);

}

int seed = 0;

float randomn()
{
	seed = int(mod(float(seed)*1364.0+626.0,5209.0));
	return float(seed)/5209.0;
}


float hash2(vec2 n) { 
	return fract(sin(dot(n, vec2(18.99221414, 15.839399))) * 13454.111388);
}

float computeAO(inout Intersection isect)
{
	const int ntheta = 8;
	const int nphi   = 8;
	const float eps  = 0.0001;

	// Slightly move ray org towards ray dir to avoid numerical problem.
	vec3 p = isect.p + eps * isect.n;

	// Calculate orthogonal basis.
	 vec3 basis[3];
	orthoBasis(basis, isect.n);

	float occlusion = 0.0;

	for (int j = 0; j < ntheta; j++)
	{
		for (int i = 0; i < nphi; i++)
		{
			// Pick a random ray direction with importance sampling.
			// p = cos(theta) / 3.141592
			float r = randomn(); //hash2(isect.p.xy+vec2(i,j));
			float phi = 2.0 * 3.141592 * hash2(isect.p.xy+vec2(float(i)*9.1,float(j)*9.1));

			vec3 ref;
			float s, c;
			s = sin(phi);
			c = cos(phi);
			ref.x = c * sqrt(1.0 - r);
			ref.y = s * sqrt(1.0 - r);
			ref.z = sqrt(r);

			// local -> global
			vec3 rray;
			rray.x = ref.x * basis[0].x + ref.y * basis[1].x + ref.z * basis[2].x;
			rray.y = ref.x * basis[0].y + ref.y * basis[1].y + ref.z * basis[2].y;
			rray.z = ref.x * basis[0].z + ref.y * basis[1].z + ref.z * basis[2].z;

			vec3 raydir = vec3(rray.x, rray.y, rray.z);

			Ray ray;
			ray.org = p;
			ray.dir = raydir;
			
			Intersection occIsect;
			occIsect.hit = 0;
			occIsect.t = 1.0e30;
			occIsect.n = occIsect.p = vec3(0);
			Intersect(ray, occIsect);
			occlusion += (occIsect.hit != 0 ? 1.0 : 0.0);
		}
	}

	// [0.0, 1.0]
	occlusion = (float(ntheta * nphi) - occlusion) / float(ntheta * nphi);
	return occlusion;
}


void main()
{
    int width = int(iResolution.x);
    int height = int(iResolution.y);
    vec2 fragCoord = gl_GlobalInvocationID.xy + offset;
    fragCoord.y = iResolution.y - fragCoord.y;
  	vec2 uv = fragCoord.xy / iResolution.xy;
	vec2 duv = ((fragCoord.xy+1.0) / iResolution.xy) - uv;
    float fragColor = 0.0;
    seed = int(mod((fragCoord.x+0.5) * (fragCoord.y*iResolution.y+0.5), 65536.0));
	
	Ray ray;
	Intersection it;

	sphere[0].center = vec3(-2.0, 0.0, -3.5);
	sphere[0].radius = 0.5;
	sphere[1].center = vec3(-0.5, 0.0, -3.0 + sin(frame/10.0));
	sphere[1].radius = 0.5;
	sphere[2].center = vec3(1.0, 0.0, -2.2);
	sphere[2].radius = 0.5;
	plane.p = vec3(0,-0.5, 0);
	plane.n = vec3(0, 1.0, 0);

    for (float y = 0.; y < subSamples; y++) {
        for (float x = 0.; x < subSamples; x++) {
            vec2 fuv = (uv + (vec2(x, y) * duv / subSamples)) * 2.0 - 1.0;
			fuv.x *= iResolution.x / iResolution.y;
            
            ray.org = vec3(0.0);
            ray.dir = normalize(vec3(fuv, -1.0));

            it.hit = 0;
            it.n = vec3(0,0,0);
            it.p = vec3(0,0,0);
            it.t = 10000.0;

            Intersect(ray,it);

            if (it.t < 1e3) {
	            fragColor += computeAO(it);
            }
        }
    }
	uint tileWidth = gl_NumWorkGroups.x * gl_WorkGroupSize.x;
	uint pxoff = uint(tileWidth * gl_GlobalInvocationID.y + gl_GlobalInvocationID.x);
	uint px4off = pxoff / 4;
	uint byteIdx = pxoff - px4off * 4;
	atomicAnd(imageData[px4off], ~(uint(255) << (8 * byteIdx)));
    atomicOr(imageData[px4off], uint(255.0 * fragColor / (subSamples * subSamples)) << (8 * byteIdx));
}

// OutputSize 122880000 
// Workgroups 100 75 1
// Inputs 3200 2400
// OutputType float32rgba 3200 2400
// Animated false
// Tiles 1 1

#version 450
#extension GL_ARB_separate_shader_objects : enable

#define WORKGROUP_SIZE 32
layout (local_size_x = WORKGROUP_SIZE, local_size_y = WORKGROUP_SIZE, local_size_z = 1 ) in;

struct Pixel{
  vec4 value;
};

layout(std140, binding = 0) buffer inputs
{
  float dimensions[];
};

layout(std140, binding = 1) buffer outputs
{
  Pixel imageData[];
};

void main() {

  int width = int(dimensions[0]);
  int height = int(dimensions[1]);

  /*
  In order to fit the work into workgroups, some unnecessary threads are launched.
  We terminate those threads here. 
  */
  if(gl_GlobalInvocationID.x >= width || gl_GlobalInvocationID.y >= height)
    return;

  float x = float(gl_GlobalInvocationID.x) / float(width);
  float y = float(gl_GlobalInvocationID.y) / float(height);

  /*
  What follows is code for rendering the mandelbrot set. 
  */
  vec2 uv = vec2(x,y);
  float n = 0.0;
  vec2 c = vec2(-.445, 0.0) +  (uv - 0.5)*(2.0+ 1.7*0.2  ), 
  z = vec2(0.0);
  const int M = 128;
  for (int i = 0; i < M; i++)
  {
    z = vec2(z.x*z.x - z.y*z.y, 2.*z.x*z.y) + c;
    if (dot(z, z) > 2) break;
    n++;
  }
  // we use a simple cosine palette to determine color:
  // http://iquilezles.org/www/articles/palettes/palettes.htm         
  float t = float(n) / float(M);
  vec3 d = vec3(0.3, 0.3 ,0.5);
  vec3 e = vec3(-0.2, -0.3 ,-0.5);
  vec3 f = vec3(2.1, 2.0, 3.0);
  vec3 g = vec3(0.0, 0.1, 0.0);
  vec4 color = vec4( d + e*cos( 6.28318*(f*t+g) ) ,1.0);
          
  // store the rendered mandelbrot set into a storage buffer:
  imageData[width * gl_GlobalInvocationID.y + gl_GlobalInvocationID.x].value = color;
}
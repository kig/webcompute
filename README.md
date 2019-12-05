# WebCompute

Run compute kernels across all your CPUs and GPUs.

What does it do? Compiles GLSL compute shaders to SPIR-V and runs them on the GPU using Vulkan, or on the CPU via ISPC.

## Quickstart (only run this on a trusted network / behind firewall / inside a VM)

```
git clone https://github.com/kig/webcompute
cd webcompute
yarn
node src/server.js
open http://localhost:7172
```

(HTTPS and authentication is coming.)

## Build your own binaries

On Windows you need VS2017, on Mac and Linux you need `clang++` and Vulkan libraries installed. On Mac, you need MoltenVK in `$HOME/code/MoltenVK`. There's a big bunch of utility & compiler binaries for different platforms `ispc/` and `spirv/`.

To build the runner programs and objects:

```
(cd spirv/build && make all)
(cd ispc/build && make all)
```

## How does it work?

`glslangValidator` converts GLSL to SPIR-V, `spirv-cross` converts SPIR-V to ISPC. The `vulkanRunner` program loads the SPIR-V kernel and receives its parameters and input buffer via its `STDIN` and outputs its output buffer to its `STDOUT`. 

Running the ISPC kernel is a bit more involved. First the ISPC is compiled into an object file, then the kernel object file is linked with a pre-compiled runner object file to create the kernel runner program. The kernel runner reads its parameters and input buffer from `STDIN` and writes the output to `STDOUT`.

The current version uses mDNS to do local network service discovery.

## License

MIT

## Support

Contact us at hei@heichen.hk

Heichen Ltd
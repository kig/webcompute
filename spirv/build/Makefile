GLSL_VALIDATOR=glslangValidator
SPIRV_CROSS_ISPC=spirv-cross

FLAGS=
TARGET=kernel
BITS=64

PLATFORM=linux
ARCH=x86-64

MY_PLATFORM=macos
MY_ARCH=x86-64

default: spirv ispc-cross

spirv:
	mkdir -p targets/$(TARGET)
	../$(GLSL_VALIDATOR)-$(MY_PLATFORM)-$(MY_ARCH) --target-env vulkan1.0 targets/$(TARGET)/program.comp.glsl -o targets/$(TARGET)/program.spv

runner:
	mkdir -p bin
	clang++ -Iobjs/ -m$(BITS) -O2 -o bin/vulkanRunner-$(PLATFORM)-$(ARCH) vulkanRunner.cpp -lm -fopenmp -lomp -lstdc++

ispc-cross:
	../$(SPIRV_CROSS_ISPC)-$(MY_PLATFORM)-$(MY_ARCH) --ispc targets/$(TARGET)/program.spv --output targets/$(TARGET)/program.ispc

all: runner spirv ispc-cross

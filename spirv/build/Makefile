GLSL_VALIDATOR=glslangValidator
SPIRV_CROSS_ISPC=spirv-cross

FLAGS=
TARGET=kernel
BITS=64

MY_PLATFORM := $(shell uname | tr [[:upper:]] [[:lower:]] | sed s/darwin/macos/)
MY_ARCH := $(shell uname -m | tr _ -)

PLATFORM := $(MY_PLATFORM)
ARCH := $(MY_ARCH)

default: spirv ispc-cross ispc ispc-bin

spirv:
	mkdir -p targets/$(TARGET)
	../$(GLSL_VALIDATOR)-$(MY_PLATFORM)-$(MY_ARCH) --target-env vulkan1.0 targets/$(TARGET)/program.comp.glsl -o targets/$(TARGET)/program.spv

runner:
	mkdir -p bin
	clang++ -Iobjs/ -m$(BITS) -O2 -o bin/vulkanRunner-$(PLATFORM)-$(ARCH) vulkanRunner.cpp -lvulkan -lpthread -lm -lstdc++ -std=c++11 $(FOMP) $(OMP)

ispc-runner:
	clang++ -Iobjs/ -m$(BITS) -O2 -c -o objs/ispcRunner-$(PLATFORM)-$(ARCH).o ispcRunner.cpp -std=c++11

ispc-cross:
	../$(SPIRV_CROSS_ISPC)-$(MY_PLATFORM)-$(MY_ARCH) --ispc targets/$(TARGET)/program.spv --output targets/$(TARGET)/program.ispc-raw
	sed -E 's/static SPIRV_INLINE void program_ispc_main\(varying int3 gl_GlobalInvocationID,\s*uniform struct outputs& ([^,]+),\s*uniform struct inputs& ([^\)]+)/static SPIRV_INLINE void program_ispc_main\(varying int3 gl_GlobalInvocationID, uniform struct inputs\& \2, uniform struct outputs\& \1/' targets/$(TARGET)/program.ispc-raw | ruby -e 'print STDIN.read.split("export void")[0]' > targets/$(TARGET)/program.ispc

ispc:
	cp runner.ispc targets/$(TARGET)/runner.ispc
	cp spirvcross_stdlib.ispc targets/$(TARGET)/spirvcross_stdlib.ispc
	../../ispc/ispc-$(ARCH)-$(MY_PLATFORM)-$(MY_ARCH) -O2 targets/$(TARGET)/runner.ispc -o targets/$(TARGET)/program.o

ispc-bin:
	clang++ -O2 -m$(BITS) ../../ispc/build/objs/tasksys-$(PLATFORM)-$(ARCH).o targets/$(TARGET)/program.o objs/ispcRunner-$(PLATFORM)-$(ARCH).o -o targets/$(TARGET)/program -lm -lstdc++ -lpthread -std=c++11

all: runner ispc-runner spirv ispc-cross ispc ispc-bin

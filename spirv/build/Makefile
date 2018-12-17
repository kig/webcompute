GLSL_VALIDATOR=glslangValidator
SPIRV_CROSS_ISPC=spirv-cross

FLAGS=
TARGET=kernel
BITS=64

PLATFORM=macos
ARCH=x86-64

MY_PLATFORM=macos
MY_ARCH=x86-64

default: spirv ispc-cross

spirv:
	mkdir -p targets/$(TARGET)
	../$(GLSL_VALIDATOR)-$(MY_PLATFORM)-$(MY_ARCH) --target-env vulkan1.0 targets/$(TARGET)/program.comp.glsl -o targets/$(TARGET)/program.spv

runner:
	mkdir -p bin
	clang++ -Iobjs/ -m$(BITS) -O2 -o bin/vulkanRunner-$(PLATFORM)-$(ARCH) vulkanRunner.cpp -lm -lstdc++ $(FOMP) $(OMP)

ispc-runner:
	clang++ -Iobjs/ -m$(BITS) -O2 -c -o objs/ispcRunner-$(PLATFORM)-$(ARCH).o ispcRunner.cpp

ispc-cross:
	../$(SPIRV_CROSS_ISPC)-$(MY_PLATFORM)-$(MY_ARCH) --ispc targets/$(TARGET)/program.spv --output targets/$(TARGET)/program.ispc

ispc:
	cp runner.ispc targets/$(TARGET)/runner.ispc
	cp spirvcross_stdlib.ispc targets/$(TARGET)/spirvcross_stdlib.ispc
	../../ispc/ispc-$(ARCH)-$(MY_PLATFORM)-$(MY_ARCH) -O2 targets/$(TARGET)/runner.ispc -o targets/$(TARGET)/program.o

ispc-bin:
	clang++ -O2 -m$(BITS) ../../ispc/build/objs/tasksys-$(PLATFORM)-$(ARCH).o targets/$(TARGET)/program.o objs/ispcRunner-$(PLATFORM)-$(ARCH).o -o targets/$(TARGET)/program -lm -lstdc++ -lpthread

all: runner ispc-runner spirv ispc-cross ispc ispc-bin

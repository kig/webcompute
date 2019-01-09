GLSL_VALIDATOR=glslangValidator
SPIRV_CROSS_ISPC=spirv-cross

FLAGS=
TARGET=kernel
BITS=64

MY_PLATFORM := $(shell uname | tr [[:upper:]] [[:lower:]] | sed s/darwin/macos/ | sed -E s/mingw.*/windows/ )
MY_ARCH := $(shell uname -m | tr _ -)

ifeq ($(MY_PLATFORM),linux)
  ifeq ($(shell uname -o),Android)
    MY_PLATFORM := android
	export LD_LIBRARY_PATH=/system/lib64:$(PREFIX)/lib
  endif
endif

PLATFORM := $(MY_PLATFORM)
ARCH := $(MY_ARCH)

LIBS=-lm -lpthread -lstdc++

ifeq ($(PLATFORM),windows)
  LIBS=
endif

ifeq ($(ARCH),arm)
	# Raspberry Pi settings
	LINK_FLAGS=-stdlib=libc++ -lunwind -mfloat-abi=hard
	BITS=32
endif

default: spirv ispc-cross ispc ispc-bin

spirv:
	mkdir -p targets/$(TARGET)
	../$(GLSL_VALIDATOR)-$(MY_PLATFORM)-$(MY_ARCH) --target-env vulkan1.0 targets/$(TARGET)/program.comp.glsl -o targets/$(TARGET)/program.spv

ispc-cross:
	../$(SPIRV_CROSS_ISPC)-$(MY_PLATFORM)-$(MY_ARCH) --ispc targets/$(TARGET)/program.spv --output targets/$(TARGET)/program.ispc-raw
	ruby bin/fix_ispc_input_output_order <targets/$(TARGET)/program.ispc-raw >targets/$(TARGET)/program.ispc

ispc:
	cp runner.ispc targets/$(TARGET)/runner.ispc
	cp spirvcross_stdlib.ispc targets/$(TARGET)/spirvcross_stdlib.ispc
	/bin/bash -c "../../ispc/ispc-$(ARCH)-$(MY_PLATFORM)-$(MY_ARCH) $(FLAGS) -O2 targets/$(TARGET)/runner.ispc -o targets/$(TARGET)/program.o 2> >(ruby -e 'STDIN.read.split(/^.*spirvcross_stdlib.ispc/, 2)[0].display')"

ifeq ($(PLATFORM),windows)
runner:
	mkdir -p bin
	clang++ -Iobjs/ -DWIN32 -m$(BITS) -O2 -o bin/vulkanRunner-$(PLATFORM)-$(ARCH).exe vulkanRunner.cpp -lvulkan-1 -std=c++14 -I /c/VulkanSDK/*/Include -L /c/VulkanSDK/*/Lib

ispc-runner:
	(cd windows/; "/c/Program Files (x86)/Microsoft Visual Studio/2017/Community/MSBuild/15.0/Bin/amd64/MSBuild.exe" "-p:Configuration=Release;Platform=x64"; mv x64/Release/ispcRunner.obj runtime/ispcRunner.obj)

ispc-bin:
	mkdir -p targets/$(TARGET)/windows/
	cp windows/runtime/* targets/$(TARGET)/windows/
	cp targets/$(TARGET)/program.o targets/$(TARGET)/windows/program.obj
	(cd targets/$(TARGET)/windows; "/c/Program Files (x86)/Microsoft Visual Studio/2017/Community/MSBuild/15.0/Bin/amd64/MSBuild.exe" "-p:Configuration=Release;Platform=x64"; mv x64/Release/ispcRunner.exe ../program.exe)

else
runner:
	mkdir -p bin
	clang++ -Iobjs/ -m$(BITS) -O2 -o bin/vulkanRunner-$(PLATFORM)-$(ARCH) vulkanRunner.cpp -lvulkan -std=c++11 $(LINK_FLAGS)

ispc-runner:
	clang++ -Iobjs/ -m$(BITS) -O2 -c -o objs/ispcRunner-$(PLATFORM)-$(ARCH).o ispcRunner.cpp -std=c++11 $(LINK_FLAGS)

ispc-bin:
	clang++ -O2 -m$(BITS) ../../ispc/build/objs/tasksys-$(PLATFORM)-$(ARCH).o targets/$(TARGET)/program.o objs/ispcRunner-$(PLATFORM)-$(ARCH).o -o targets/$(TARGET)/program $(LIBS) -std=c++11 $(LINK_FLAGS)
endif

all: runner ispc-runner spirv ispc-cross ispc ispc-bin

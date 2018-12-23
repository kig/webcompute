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

FOMP=
OMP=

ifeq ($(ARCH),aarch64)
	ifeq ($(PLATFORM),android)
		# Android Termux, use OpenMP since pthreads semaphores are missing
		FOMP=-fopenmp
		OMP=-lomp $(FOMP)
	endif
endif

ifeq ($(ARCH),arm)
	# Raspberry Pi settings
	OMP=-stdlib=libc++ -lunwind -mfloat-abi=hard
	BITS=32
endif

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
	ruby bin/fix_ispc_input_output_order <targets/$(TARGET)/program.ispc-raw >targets/$(TARGET)/program.ispc

ispc:
	cp runner.ispc targets/$(TARGET)/runner.ispc
	cp spirvcross_stdlib.ispc targets/$(TARGET)/spirvcross_stdlib.ispc
	../../ispc/ispc-$(ARCH)-$(MY_PLATFORM)-$(MY_ARCH) $(FLAGS) -O2 targets/$(TARGET)/runner.ispc -o targets/$(TARGET)/program.o

ifeq ($(PLATFORM),windows)
ispc-bin:
	mkdir -p targets/$(TARGET)/windows
	cp windows/* targets/$(TARGET)/windows/
	cp targets/$(TARGET)/program.o targets/$(TARGET)/windows/program.obj
	(cd targets/$(TARGET)/windows; "/c/Program Files (x86)/Microsoft Visual Studio/2017/Community/MSBuild/15.0/Bin/amd64/MSBuild.exe" "-p:Configuration=Release;Platform=x64"; mv x64/Release/ispcRunner.exe ../program.exe)

else
ispc-bin:
	clang++ -O2 -m$(BITS) ../../ispc/build/objs/tasksys-$(PLATFORM)-$(ARCH).o targets/$(TARGET)/program.o objs/ispcRunner-$(PLATFORM)-$(ARCH).o -o targets/$(TARGET)/program $(LIBS) -std=c++11 $(OMP)
endif

all: runner ispc-runner spirv ispc-cross ispc ispc-bin

ISPC=ispc
FLAGS=
TARGET=kernel
BITS=64

MY_PLATFORM := $(shell uname | tr [[:upper:]] [[:lower:]] | sed s/darwin/macos/)
MY_ARCH := $(shell uname -m | tr _ -)

PLATFORM := $(MY_PLATFORM)
ARCH := $(MY_ARCH)

RUNNER=objs/runner-$(PLATFORM)-$(ARCH).o
TASKSYS=objs/tasksys-$(PLATFORM)-$(ARCH).o

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

default: ispc link

ispc:
	../$(ISPC)-$(ARCH)-$(MY_PLATFORM)-$(MY_ARCH) $(FLAGS) -O2 targets/$(TARGET)/program.ispc -o targets/$(TARGET)/program.o

link:
	clang++ -Iobjs/ -O2 -m$(BITS) -o targets/$(TARGET)/program $(RUNNER) $(TASKSYS) targets/$(TARGET)/program.o -lm -lpthread -lstdc++ $(OMP)

runner:
	clang++ runner.cpp -Iobjs/ -O2 -m$(BITS) -c -o $(RUNNER)

tasksys:
	clang++ tasksys.cpp -Iobjs/ -O2 -m$(BITS) -c -o $(TASKSYS) $(FOMP)

all: tasksys runner ispc link

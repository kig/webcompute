ISPC=ispc
FLAGS=
TARGET=kernel
BITS=64
ARCH=default
PLATFORM=default

RUNNER=objs/runner-$(PLATFORM)-$(ARCH).o
TASKSYS=objs/tasksys-$(PLATFORM)-$(ARCH).o

FOMP=
OMP=

ifeq ($(PLATFORM),aarch64)
	FOMP=-fopenmp
	OMP=-lomp $(FOMP)
endif

default: ispc link

ispc:
	../$(ISPC) $(FLAGS) -O2 targets/$(TARGET)/program.ispc -o targets/$(TARGET)/program.o

link:
	clang++ -Iobjs/ -O2 -m$(BITS) -o targets/$(TARGET)/program $(RUNNER) $(TASKSYS) targets/$(TARGET)/program.o -lm -lpthread -lstdc++ $(OMP)

runner:
	clang++ runner.cpp -Iobjs/ -O2 -m$(BITS) -c -o $(RUNNER)

tasksys:
	clang++ tasksys.cpp -Iobjs/ -O2 -m$(BITS) -c -o $(TASKSYS) $(FOMP)

all: tasksys runner ispc link

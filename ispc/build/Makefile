ISPC=ispc
FLAGS=
TARGET=kernel
BITS=64
ARCH=default
PLATFORM=default

RUNNER=objs/runner-$(PLATFORM)-$(ARCH).o
TASKSYS=objs/tasksys-$(PLATFORM)-$(ARCH).o

default: ispc link

ispc:
	$(ISPC) $(FLAGS) -O2 targets/$(TARGET)/program.ispc -o targets/$(TARGET)/program.o

link:
	clang++ -Iobjs/ -O2 -m$(BITS) -o targets/$(TARGET)/program $(RUNNER) $(TASKSYS) targets/$(TARGET)/program.o -lm -lpthread -lstdc++

runner:
	clang++ runner.cpp -Iobjs/ -O2 -m$(BITS) -c -o $(RUNNER)

tasksys:
	clang++ tasksys.cpp -Iobjs/ -O2 -m$(BITS) -c -o $(TASKSYS)

all: tasksys runner ispc link

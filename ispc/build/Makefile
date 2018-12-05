ISPC=ispc
FLAGS=""
TARGET=kernel
BITS=64

default: ispc link

ispc:
	../$(ISPC) $(FLAGS) -O2 targets/$(TARGET)/program.ispc -o targets/$(TARGET)/program.o

link:
	clang++ -Iobjs/ -O2 -m$(BITS) -o targets/$(TARGET)/program objs/runner.o objs/tasksys.o targets/$(TARGET)/program.o -lm -lpthread -lstdc++

runner:
	clang++ runner.cpp -Iobjs/ -O2 -m$(BITS) -c -o objs/runner.o

tasksys:
	clang++ tasksys.cpp -Iobjs/ -O2 -m$(BITS) -c -o objs/tasksys.o

all: tasksys runner ispc link

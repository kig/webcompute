TARGET=kernel

default:
	ispc -O2 --arch=x86-64 --target=avx2-i32x16 targets/$(TARGET)/program.ispc -o targets/$(TARGET)/program.o
	clang++ -Iobjs/ -O2 -m64 -o targets/$(TARGET)/program objs/runner.o objs/tasksys.o targets/$(TARGET)/program.o -lm -lpthread -lstdc++

runner:
	clang++ runner.cpp -Iobjs/ -O2 -m64 -c -o objs/runner.o

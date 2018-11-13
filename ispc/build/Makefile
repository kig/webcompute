default:
	ispc -O2 --arch=x86-64 --target=avx2-i32x16 runner.ispc -o objs/runner_ispc.o -h objs/runner_ispc.h;
	clang++ -Iobjs/ -O2 -m64 -o runner objs/runner.o objs/tasksys.o objs/runner_ispc.o -lm -lpthread -lstdc++;

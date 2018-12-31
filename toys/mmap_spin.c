#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/mman.h>
#include <unistd.h>
#include <string.h>

int main() {
	size_t size = 8294400;
	int fd = open("/tmp/testmmap", O_RDWR | O_CREAT, S_IRUSR | S_IWUSR);
	ftruncate(fd, size + 64);
	char *buf = (char*)mmap(NULL, 64 + size, PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0);
	char *src = (char*)malloc(size);
	buf[0] = 1;
	for (size_t i = 0; i < size; i++) {
		src[i] = i;
	}
	for (int j = 0; j < 100; j++) {
		printf("send %d\n", j);
		#pragma omp parallel for
		for (size_t i = 0; i < size; i += size/4) {
			memcpy(buf+(i+64), src+i, size/4);
		}
		buf[0] = 0;
	}
	return 0;
}

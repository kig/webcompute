#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/mman.h>
#include <unistd.h>
#include <string.h>

int main() {
	int threads = 16;
	size_t size = threads * 2e5;
	int fd = open("/tmp/testmmap", O_RDWR);
	volatile char *buf = (char*)mmap(NULL, 4096 + size, PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0);
	char *dst = (char*)malloc(size);
	for (size_t i = 0; i < size; i++) {
		dst[i] = 0xff & i;
	}
	#pragma omp parallel for
	for (size_t i = 0; i < threads; i++) {
		size_t off = i * size/threads;
		size_t k = 0;
		size_t res = 0;
		for (int j = 0; j < 1e5; j++) {
			while (buf[i] == 1) {
				k = (k + 1) % (size / threads);
				res ^= dst[off+k] ^ j;
			}
			// printf("recv %zd, %d\n", i, j);
			// memcpy(buf+4096, src, size);
			memcpy(dst+off, buf+(off+4096), size/threads);
			buf[i] = 1;
		}
		printf("%zd: %zd\n", i, res);
	}
	ftruncate(fd, 0);
	return 0;
}

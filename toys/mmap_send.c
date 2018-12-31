#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/mman.h>
#include <unistd.h>
#include <string.h>

int main() {
	size_t size = 4e5;
	int fd = open("/tmp/testmmap", O_RDWR | O_CREAT, S_IRUSR | S_IWUSR);
	ftruncate(fd, size + 4096);
	char *buf = (char*)mmap(NULL, 4096 + size, PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0);
	char *src = (char*)malloc(size);
	buf[0] = 1;
	for (size_t i = 0; i < size; i++) {
		src[i] = i;
	}
	#pragma omp parallel for
	for (size_t i = 0; i < 2; i++) {
		size_t off = i * size/2;
		size_t k = 0;
		for (int j = 0; j < 1e5; j++) {
			memset(src+off, (char)j, size/2);
			while (buf[i] == 0) {
				k = (k + 1) % (size / 2);
				src[off+k] ^= k ^ j;
			}
			// printf("send %zd, %d\n", i, j);
			// memcpy(buf+4096, src, size);
			memcpy(buf+(off+4096), src+off, size/2);
			buf[i] = 0;
		}
	}
	return 0;
}

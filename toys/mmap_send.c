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
	int msg_size = 1e5;
	size_t size = threads * msg_size;
	int fd = open("/tmp/testmmap", O_RDWR | O_CREAT, S_IRUSR | S_IWUSR);
	ftruncate(fd, size + 4096);
	volatile char *buf = (char*)mmap(NULL, 4096 + size, PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0);
	char *src = (char*)malloc(size);
	for (size_t i = 0; i < threads; i++) {
		buf[i] = 1;
	}
	for (size_t i = 0; i < size; i++) {
		src[i] = i;
	}
	#pragma omp parallel for
	for (size_t i = 0; i < threads; i++) {
		size_t off = i * size/threads;
		for (int j = 0; j < 1e4; j++) {
			memset(src+off, (char)i, size/threads);
			while (buf[i] == 0) {
			}
			memcpy(buf+(off+4096), src+off, size/threads);
			buf[i] = 0;
		}
	}
	return 0;
}

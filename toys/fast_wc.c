#include <stdio.h>
#include <stdlib.h>

int main() {
	ssize_t size = 8294400;
	char *buf = (char*)malloc(size);
	ssize_t bytes_read = 0;
	while (!feof(stdin) && !ferror(stdin)) {
		bytes_read += fread(buf, 1, size, stdin);
	}
	printf("%zd\n", bytes_read);
	return 0;
}

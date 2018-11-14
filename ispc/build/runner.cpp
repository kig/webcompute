#include <cstdio>
#include <cstdlib>
#include <stdlib.h>
#include <algorithm>
#include <string.h>
#include "runner_ispc.h"

using namespace ispc;

int main(int argc, char *argv[]) {
    /*
      Read stdin into a memory buffer.
      Pass memory buffer to main_ispc as void*.
      Get output buffer as void*.
    */
    ssize_t input_length = 0, read_bytes = 0, input_buffer_size = 4096;

    int output_size = 0;
    read_bytes = fread(&output_size, 1, 4, stdin);

    if (read_bytes < 4) {
      output_size = 4;
    }

    char *input = (char*)malloc(input_buffer_size);
    do {
        read_bytes = fread((void*)(input + input_length), 1, 4096, stdin);
        input_length += read_bytes;
        if (input_length + 4096 > input_buffer_size) {
            input_buffer_size *= 2;
            input = (char*)realloc((void*)input, input_buffer_size);
        }
    } while (!feof(stdin));

    void *output = malloc(output_size);

    main_ispc((float*)input, (int*)output);

    fwrite(output, 1, output_size, stdout);

    return 0;
}

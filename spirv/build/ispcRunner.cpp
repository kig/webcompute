#include <stdio.h>
#include <stdlib.h>
#include "program.h"

#ifdef WIN32
#include <io.h>
#include <fcntl.h>
#endif

static uint32_t bufferSize = 0;
static ::size_t inputBufferSize = 0;
static uint32_t vulkanDeviceIndex = 0;
static int32_t workSize[3] = {1, 1, 1};

static char *input;

void readInput()
{
    ::size_t input_length = 0, read_bytes = 0, input_buffer_size = 4096;

#ifdef WIN32
	_setmode(_fileno(stdout), _O_BINARY);
	_setmode(_fileno(stdin), _O_BINARY);
#endif


    bufferSize = 0;
    read_bytes = fread(&bufferSize, 1, 4, stdin);
    if (read_bytes < 4)
    {
        fprintf(stderr, "read only %zd bytes, using default bufferSize\n", read_bytes);
        bufferSize = 4;
    }

    vulkanDeviceIndex = 0;
    read_bytes = fread(&vulkanDeviceIndex, 1, 4, stdin);
    if (read_bytes < 4)
    {
        fprintf(stderr, "read only %zd bytes, using default vulkanDeviceIndex\n", read_bytes);
        vulkanDeviceIndex = 0;
    }

    read_bytes = fread(workSize, 1, 12, stdin);
    if (read_bytes < 12)
    {
        fprintf(stderr, "read only %zd bytes, using default workSize\n", read_bytes);
        workSize[0] = workSize[1] = workSize[2] = 1;
    }

    input = (char *)malloc(sizeof(ispc::inputs) - 4 + input_buffer_size);
    input_length = sizeof(ispc::inputs) - 4;
    do
    {
        read_bytes = fread((void *)(input + input_length), 1, 4096, stdin);
        input_length += read_bytes;
        if (input_length + 4096 > input_buffer_size)
        {
            input_buffer_size *= 2;
            input = (char *)realloc((void *)input, input_buffer_size);
        }
    } while (!feof(stdin));

    inputBufferSize = input_length;
}

int main(int argc, char *argv[])
{
    readInput();
    // fprintf(stderr, "%d %d %d %d %d %d\n", bufferSize, vulkanDeviceIndex, workSize[0], workSize[1], workSize[2], inputBufferSize);

    ispc::inputs *inputs = (ispc::inputs *)input;
    ispc::outputs *outputs = (ispc::outputs *)malloc(sizeof(ispc::outputs) - 4 + bufferSize);

    ispc::runner_main(workSize, *inputs, *outputs);
    fwrite(outputs->outputData, 1, bufferSize, stdout);

    return 0;
}

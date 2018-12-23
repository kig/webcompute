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

void readHeader()
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

    inputBufferSize = 0;
    read_bytes = fread(&inputBufferSize, 1, 4, stdin);
    if (read_bytes < 4)
    {
        fprintf(stderr, "read only %zd bytes, using default inputBufferSize\n", read_bytes);
        inputBufferSize = 4;
    }

    input = (char *)malloc(sizeof(ispc::inputs) - 4 + inputBufferSize);
}

bool readInput()
{
	if (feof(stdin)) {
		return false;
	}
	
    ::size_t input_length = 0, read_bytes = 0;
    ::size_t off = sizeof(ispc::inputs) - 4;

    while (input_length < inputBufferSize && !feof(stdin))
    {
        read_bytes = fread((void *)(input + input_length + off), 1, inputBufferSize, stdin);
        input_length += read_bytes;
    }
    return input_length > 0;
}

int main(int argc, char *argv[])
{
    readHeader();
    // fprintf(stderr, "%d %d %d %d %d %d\n", bufferSize, vulkanDeviceIndex, workSize[0], workSize[1], workSize[2], inputBufferSize);

    ispc::outputs *outputs = (ispc::outputs *)malloc(sizeof(ispc::outputs) - 4 + bufferSize);

	while (readInput()) {
	    ispc::inputs *inputs = (ispc::inputs *)input;
	    ispc::runner_main(workSize, *inputs, *outputs);
	    fwrite(outputs->outputData, 1, bufferSize, stdout);
    }

    return 0;
}

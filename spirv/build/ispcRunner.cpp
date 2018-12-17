#include <stdio.h>
#include <stdlib.h>
#include "program.h"

int main(int argc, char *argv[])
{
  ssize_t input_length = 0, read_bytes = 0, input_buffer_size = 4096;

  int32_t workSize[3] = {1, 1, 1};
  int output_size = 0;

  read_bytes = fread(&output_size, 1, 4, stdin);

  if (read_bytes < 4)
  {
    output_size = 4;
  }

  read_bytes = fread(workSize, 4, 3, stdin);

  char *input = (char *)malloc(sizeof(ispc::inputs) + input_buffer_size);
  input_length = sizeof(ispc::inputs);
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

  ispc::inputs *inputs = (ispc::inputs *)input;
  ispc::outputs *outputs = (ispc::outputs *)malloc(sizeof(ispc::outputs) + output_size);

  ispc::runner_main(workSize, *inputs, *outputs);
  fwrite(outputs->outputData, 1, output_size, stdout);

  return 0;
}

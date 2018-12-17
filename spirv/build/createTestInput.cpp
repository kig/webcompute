#include <stdio.h>
#include <stdlib.h>

int main(int argc, char *argv[])
{
    int32_t header[4] = {3200 * 2400 * 4 * 4, 100, 75, 1};
    float dims[2] = {3200.0f, 2400.0f};
    fwrite(header, sizeof(header), 1, stdout);
    fwrite(dims, sizeof(dims), 1, stdout);
}

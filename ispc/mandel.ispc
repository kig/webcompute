static inline unsigned int8
mandel(float c_re, float c_im, int count) {
    float z_re = c_re, z_im = c_im;
    int i;
    for (i = 0; i < count; ++i) {
        if (z_re * z_re + z_im * z_im > 4.)
            break;

        float new_re = z_re*z_re - z_im*z_im;
        float new_im = 2.f * z_re * z_im;
        unmasked {
            z_re = c_re + new_re;
            z_im = c_im + new_im;
        }
    }

    return i;
}


/* Task to compute the Mandelbrot iterations for a single scanline.
 */
task void
mandelbrot_scanline(uniform float x0, uniform float dx,
                    uniform float y0, uniform float dy,
                    uniform int width, uniform int height,
                    uniform int xspan, uniform int yspan,
                    uniform int maxIterations, uniform unsigned int8 output[]) {
    const uniform int xstart = taskIndex0 * xspan;
    const uniform int xend   = min(xstart  + xspan, width);
    const uniform int ystart = taskIndex1 * yspan;
    const uniform int yend   = min(ystart  + yspan, height);

    foreach (yi = ystart ... yend, xi = xstart ... xend) {
        float x = x0 + xi * dx;
        float y = y0 + yi * dy;

        int index = yi * width + xi;
        output[index] = mandel(x, y, maxIterations);
    }
}


export void
main_ispc(uniform float input[], uniform unsigned int8 output[]) {

    uniform float x0 = input[0];
    uniform float y0 = input[1];
    uniform float x1 = x0+input[2]; 
    uniform float y1 = y0+input[3];
    uniform int width = input[4];
    uniform int height = input[5];
    uniform int maxIterations = input[6];

    uniform float dx = (x1 - x0) / width;
    uniform float dy = (y1 - y0) / height;
    const uniform int xspan = width / 4;
    const uniform int yspan = 4;


    launch [width/xspan, height/yspan]
    mandelbrot_scanline(x0, dx, y0, dy, width, height, xspan, yspan,
                          maxIterations, output);
}


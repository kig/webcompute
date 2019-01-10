var createTexture = function(gl, buf, width, height, unit, pixelFormat) {
    gl.activeTexture( gl.TEXTURE0+(unit||0) );
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (buf instanceof Float32Array) {
        gl.texImage2D(gl.TEXTURE_2D, 0, pixelFormat, width, height, 0, pixelFormat, gl.FLOAT, buf);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, pixelFormat, width, height, 0, pixelFormat, gl.UNSIGNED_BYTE, buf);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }
    return tex;
};
var updateTexture = function(gl, tex, buf, width, height, unit, pixelFormat) {
    gl.activeTexture( gl.TEXTURE0+(unit||0) );
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (buf instanceof Float32Array) {
        gl.texImage2D(gl.TEXTURE_2D, 0, pixelFormat, width, height, 0, pixelFormat, gl.FLOAT, buf);
    } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, pixelFormat, width, height, 0, pixelFormat, gl.UNSIGNED_BYTE, buf);
    }
};
var createBuffer = function(gl) {
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    var arr = new Float32Array([
        -1,-1, 0,
         1,-1, 0,
         1, 1, 0,
        -1,-1, 0,
         1, 1, 0,
        -1, 1, 0
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    return buf;
};
var createShader = function(gl, source, type) {
    var s = source;
    if (typeof source === 'string') {
        s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(s));
        }
    }
    return s;
};
var createProgram = function(gl, vert, frag) {
    var t0 = Date.now();
    var p = gl.createProgram();
    var vs = createShader(gl, vert, gl.VERTEX_SHADER);
    var fs = createShader(gl, frag, gl.FRAGMENT_SHADER);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);

    return p;
};
var getUniform = function(gl, p, name) {
    if (!p.uniforms) p.uniforms = {};
    if (!p.uniforms[name]) p.uniforms[name] = gl.getUniformLocation(p, name);
    return p.uniforms[name];
};
var u4fv = function(gl, p, name, v) {
    gl.uniform4fv(getUniform(gl, p, name), v);
};
var u3fv = function(gl, p, name, v) {
    gl.uniform3fv(getUniform(gl, p, name), v);
};
var u3f = function(gl, p, name, x,y,z) {
    gl.uniform3f(getUniform(gl, p, name), x,y,z);
};
var u1f = function(gl, p, name, x) {
    gl.uniform1f(getUniform(gl, p, name), x);
};
var u1i = function(gl, p, name, x) {
    gl.uniform1i(getUniform(gl, p, name), x);
};

class VideoScreen {
    constructor(width, height, channels=4) {
        this.canvas = document.createElement('canvas');
        this.width = width;
        this.height = height;
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.update = () => this.update(true);
        var glc = this.canvas;
        var gl = this.gl = this.canvas.getContext('webgl2', {preserveDrawingBuffer: true, alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true});
        gl.clearColor(0,0,0,1);
        var buf = this.buf = createBuffer(gl);
        var aspect = `float(${width/height})`;
        var rtVert = 'precision highp float;attribute vec3 position;void main() {gl_Position = vec4(position, 1.0);}';
        var rtFrag = `precision highp float; uniform sampler2D iChannel0; uniform vec3 iResolution; void main() {gl_FragColor = texture2D(iChannel0, vec2(0.5) + (vec2(iResolution.x / iResolution.y / (${aspect}), -1.0) * (gl_FragCoord.xy / iResolution.xy - vec2(0.5))));}`;
        this.pixelFormat = gl.RGBA;
        if (channels === 1) {
            this.pixelFormat = gl.LUMINANCE;
            var rtFrag = `precision highp float; uniform sampler2D iChannel0; uniform vec3 iResolution; void main() {gl_FragColor = vec4(texture2D(iChannel0, vec2(0.5) + (vec2(iResolution.x / iResolution.y / (${aspect}), -1.0) * (gl_FragCoord.xy / iResolution.xy - vec2(0.5)))).rrr, 1.0);}`;
        } else if (channels === 3) {
            this.pixelFormat = gl.RGB;
            var rtFrag = `precision highp float; uniform sampler2D iChannel0; uniform vec3 iResolution; void main() {gl_FragColor = vec4(texture2D(iChannel0, vec2(0.5) + (vec2(iResolution.x / iResolution.y / (${aspect}), -1.0) * (gl_FragCoord.xy / iResolution.xy - vec2(0.5)))).rgb, 1.0);}`;
        }
        var p = this.program = createProgram(gl, rtVert, rtFrag);
        gl.useProgram(p);
        var tex = this.tex = createTexture(gl, null, width, height, 0, this.pixelFormat);
        var iResolution = this.iResolution = [glc.width, glc.height, 1]; 
        u3fv(gl, p, 'iResolution', iResolution);
        u1i(gl, p, 'iChannel0', 0);
        var pos = gl.getAttribLocation(p, 'position');
        gl.enableVertexAttribArray(pos);
        gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 0, 0);
        // var resize = function() {
		// 	glc.width = window.innerWidth * (window.devicePixelRatio || 1);
		// 	glc.height = window.innerHeight * (window.devicePixelRatio || 1);
		// 	iResolution[0] = glc.width;
		// 	iResolution[1] = glc.height;
		// 	gl.viewport(0,0, glc.width, glc.height);
		// 	u3fv(gl, p, 'iResolution', iResolution);
		// 	forceRedraw = true;
        // };
        // window.addEventListener('resize', resize, false);

        this.canvas.className = 'video-canvas';

        this.element = this.canvas;

        this.videoChanged = false;
        this.videoFrame = -1;
        this.stopped = false;
    }

    updateTexture(uint8array, x, y, width, height) {
        if (!this.stopped) {
            var gl = this.gl;
            gl.activeTexture( gl.TEXTURE0 );
            gl.bindTexture(gl.TEXTURE_2D, this.tex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, this.pixelFormat, gl.UNSIGNED_BYTE, uint8array);
            this.videoChanged = true;
        }
    }

    update(force = false) {
        if (force || this.videoChanged) {
            var bbox = this.canvas.getBoundingClientRect();
            var dpr = (window.devicePixelRatio || 1);
            if (this.canvas.width !== bbox.width * dpr || this.canvas.height !== bbox.height * dpr) {
                this.canvas.width = bbox.width * dpr;
                this.canvas.height = bbox.height * dpr;
                this.iResolution[0] = this.canvas.width;
                this.iResolution[1] = this.canvas.height;
                this.gl.viewport(0,0, this.canvas.width, this.canvas.height);
                u3fv(this.gl, this.program, 'iResolution', this.iResolution);
            }
            var gl = this.gl;
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.activeTexture( gl.TEXTURE0 );
            gl.bindTexture(gl.TEXTURE_2D, this.tex);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            this.videoFrame++;
            this.videoChanged = false;
        }
    }

    hide() {
        this.canvas.style.display = 'none';
    }

    show() {
        this.canvas.style.display = 'block';
    }

    stop() {
        this.stopped = true;
    }

    start() {
        this.stopped = false;
    }
}

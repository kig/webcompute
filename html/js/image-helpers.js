var ppmToCanvas = function (u8, canvas) {
    var header = u8.slice(0, u8.indexOf(10));
    var dimensions = u8.slice(header.length + 1, u8.indexOf(10, header.length + 1));
    var maxValue = u8.slice(header.length + dimensions.length + 2, u8.indexOf(10, header.length + dimensions.length + 2));
    var hstr = String.fromCharCode.apply(null, header);
    var dstr = String.fromCharCode.apply(null, dimensions);
    var mstr = String.fromCharCode.apply(null, maxValue);
    var [width, height] = dstr.split(/\\s+/).map((x) => parseInt(x));
    canvas = canvas || document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    var id = ctx.getImageData(0, 0, width, height);
    var idx = header.length + dimensions.length + maxValue.length + 3;
    for (var i = idx, j = 0; i < u8.length; i++ , j++) {
        if (j % 4 === 3) { id.data[j++] = 255; }
        id.data[j] = u8[i];
    }
    ctx.putImageData(id, 0, 0);
    return canvas;
}

var rawGrayUint8ToCanvas = function (u8, width, height, canvas) {
    canvas = canvas || document.createElement('canvas');
    var d, id, i, j;
    if (!canvas.ctx) {
        canvas.ctx = canvas.getContext('2d');
    }
    var ctx = canvas.ctx;
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        canvas.imageData = null;
    }
    if (!canvas.imageData) {
        canvas.imageData = ctx.getImageData(0, 0, width, height);
        d = canvas.imageData.data;
        for (j = 3; j < d.length; j += 4) {
            d[j] = 255;
        }
    }
    id = canvas.imageData;
    d = id.data;
    for (i = 0, j = 0; i < u8.length; i++, j += 4) {
        d[j] = d[j + 1] = d[j + 2] = u8[i];
    }
    ctx.putImageData(id, 0, 0);
    return canvas;
};

var rawRGBAUint8ToCanvas = function (u8, width, height, canvas) {
    canvas = canvas || document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        canvas.imageData = ctx.getImageData(0, 0, width, height);
    }
    canvas.imageData.data.set(u8);
    ctx.putImageData(canvas.imageData, 0, 0);
    return canvas;
};

var rawGrayUint32ToCanvas = function (u32, width, height, canvas) {
    canvas = canvas || document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    var id = ctx.getImageData(0, 0, width, height);
    for (var i = 0, j = 0; i < u32.length; i++ , j += 4) {
        id.data[j] = id.data[j + 1] = id.data[j + 2] = u32[i]; id.data[j + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return canvas;
};

var rawGrayFloat32ToCanvas = function (f32, width, height, canvas) {
    canvas = canvas || document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    var id = ctx.getImageData(0, 0, width, height);
    for (var i = 0, j = 0; i < f32.length; i++ , j += 4) {
        id.data[j] = id.data[j + 1] = id.data[j + 2] = f32[i] * 255; id.data[j + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return canvas;
};

var rawRGBAFloat32ToCanvas = function (f32, width, height, canvas) {
    canvas = canvas || document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    var id = ctx.getImageData(0, 0, width, height);
    for (var i = 0, j = 0; i < f32.length; i++ , j++) {
        id.data[j] = f32[i] * 255;
    }
    ctx.putImageData(id, 0, 0);
    return canvas;
};

async function sha256(message) {
    if (! (window.crypto && window.crypto.subtle && window.crypto.subtle.digest)) {
        return message;
    }

    // encode as UTF-8
    const msgBuffer = new TextEncoder('utf-8').encode(message);

    // hash the message
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    
    // convert ArrayBuffer to Array
    const hashArray = Array.from(new Uint8Array(hashBuffer));

    // convert bytes to hex string
    const hashHex = hashArray.map(b => ('00' + b.toString(16)).slice(-2)).join('');
    return hashHex;
}

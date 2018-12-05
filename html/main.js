class Cluster {
	constructor(nodes) {
		this.buildNodes = nodes.filter(n => n.canBuild === 'true');
		this.nodes = nodes;
		this.workQueue = [];
		this.buildCache = {};
	}

	processWorkQueue() {
		if (this.workQueue.length > 0 && this.nodes.length > 0) {
			var node = this.nodes.shift();
			var callback = this.workQueue.shift();
			var doNext = () => {
				this.nodes.push(node);
				this.processWorkQueue();
			};
			callback(node).then(doNext).catch(doNext);
		}
	}

	getNode(callback) {
		this.workQueue.push(callback);
		this.processWorkQueue();
	}

	async build(node, source) {
		if (node.canBuild) {
			return { blob: new Blob(source), isBinary: false };
		} else {
			const fd = new FormData();
			fd.append('args', JSON.stringify({arch: node.arch, target: node.target, addressing: node.addressing}));
			fd.append('source', source);
			const res = await fetch(this.buildNodes[0].url + '/build', { method: 'POST', body: fd });
			const blob = await res.blob();
			return { blob, isBinary: true };
		}
	}

	static parse(nodeString) {
		const defaultParams = { canBuild: 'true', arch: 'x86-64', target: 'avx2-i32x16', addressing: '32' };
		const nodes = nodeString.split(",").map(s => s.replace(/\s+/, '')).filter(s => s !== '').map(n => {
			var [url, ...paramList] = n.split(/,/);
			const params = paramList.reduce((obj, p) => {
				var [k, v] = p.split("=");
				obj[k] = v;
				return obj
			}, {})
			if (!url.includes(":")) {
				url = "http://" + url + ":7172";
			}
			return { url, ...defaultParams, ...params };
		});
		if (nodes === []) {
			nodes.push({ url: '', ...defaultParams });
		}
		return new Cluster(nodes);
	}
}

function expandParam(param) {
	if ((/\.\./).test(param)) {
		const [startStr, endStr, stepStr] = param.split(/\.\.\.?|,/);
		const step = stepStr ? Math.abs(parseFloat(stepStr)) : 1;
		const start = parseFloat(startStr);
		const end = parseFloat(endStr);
		if (isNaN(start + end + step)) {
			throw new Error("Invalid range param");
		}
		var a = [];
		if (start < end) {
			for (var x = start; x < end; x += step) {
				a.push(x);
			}
		} else {
			for (var x = start; x > end; x -= step) {
				a.push(x);
			}
		}
		if (!(/\.\.\./).test(param)) {
			a.push(parseFloat(end));
		}
		return a;
	} else {
		return [parseFloat(param)];
	}
}

function expandParams(params) {
	if (params.length === 0) {
		return [];
	}
	var expanded = [];
	var colParams = params.map(expandParam);
	var indices = colParams.map(() => 0);
	while (true) {
		var arr = [];
		expanded.push(arr);
		for (var i = 0; i < indices.length; i++) {
			arr.push(colParams[i][indices[i]]);
		}
		indices[0]++;
		for (var i = 0; i < indices.length - 1; i++) {
			if (indices[i] === colParams[i].length) {
				indices[i] = 0;
				indices[i + 1]++;
			} else {
				break;
			}
		}
		if (indices[i] === colParams[i].length) {
			break;
		}
	}
	return expanded;
}

function send() {
	window.event.preventDefault();
	output.textContent = '';
	var green = '';
	var cluster = Cluster.parse(this.vmnodes.value);
	var inputs = expandParams(this.vmparams.value.replace(/\s+/, '').split(","));
	var outputLength = parseInt(this.vmoutputsize.value);
	var vmSuffix = '/new' + green + '/' + this.vmname.value;
	var sourceString = window.vmsrcEditor.getValue();
	var outputType = this.vmoutputtype.value;
	var outputWidth = parseInt(this.vmoutputwidth.value);
	var outputHeight = parseInt(this.vmoutputheight.value);
	inputs.forEach((input) => {
		cluster.getNode(async (node) => {
			const program = await cluster.build(node, sourceString);
			var fd = new FormData();
			fd.append('args', JSON.stringify({ input, outputLength, binary: program.isBinary }));
			fd.append('program', program.blob);
			var url = node.url + vmSuffix;
			const res = await fetch(url, { method: 'POST', body: fd });
			return processResponse(res, outputType, outputWidth, outputHeight);
		});
	});
}

function processResponse(response, outputType, outputWidth, outputHeight) {
	const output = document.createElement('span');
	document.getElementById('output').append(output);
	const reader = response.body.getReader();
	const stream = new ReadableStream({
		start(controller) {
			var decoder = new TextDecoder('utf-8');
			var typeDecoder = new TextDecoder('utf-8');
			var gotHeader = false;
			var gotType = false;
			var resultBuffer = [];
			var resultHeader = {};
			var typeString = '';
			function push() {
				reader.read().then(({ done, value }) => {
					if (done) {
						controller.close();
						window.resultBlob = new Blob(resultBuffer, { type: resultHeader.type });
						if (resultHeader.type === 'image/ppm' || outputType === 'ppm') {
							var fileReader = new FileReader();
							fileReader.onload = function (event) {
								output.append(ppmToCanvas(new Uint8Array(event.target.result)));
							};
							fileReader.readAsArrayBuffer(window.resultBlob);
						} else {
							var fileReader = new FileReader();
							fileReader.onload = function (event) {
								var resultArray = null;
								var outputFunc = (txt) => document.createTextNode(txt);
								if (outputType === 'uint8gray' || outputType === 'uint8rgba') {
									resultArray = new Uint8Array(event.target.result);
									outputFunc = outputType === 'uint8gray' ? rawGrayUint8ToCanvas : rawRGBAUint8ToCanvas;
								} else if (outputType === 'float32gray' || outputType === 'float32rgba') {
									resultArray = new Float32Array(event.target.result);
									outputFunc = outputType === 'float32gray' ? rawGrayFloat32ToCanvas : rawRGBAFloat32ToCanvas;
								} else {
									resultArray = String.fromCharCode.apply(null, new Uint8Array(event.target.result));
								}
								output.append(outputFunc(resultArray, outputWidth, outputHeight));
							};
							fileReader.readAsArrayBuffer(window.resultBlob);
						}
						return;
					}
					if (!gotHeader) {
						var endOfHeader = value.indexOf(10);
						var headerSlice = value.slice(0, endOfHeader);
						output.textContent += decoder.decode(headerSlice, { stream: true });
						if (endOfHeader > -1) {
							resultHeader = window.resultHeader = JSON.parse(output.textContent);
							gotHeader = true;
							value = value.slice(endOfHeader + 1);
						}
					}
					if (!gotType) {
						var endOfType = value.indexOf(10);
						var typeSlice = value.slice(0, endOfType);
						typeString += typeDecoder.decode(typeSlice, { stream: true });
						if (endOfType > -1) {
							resultHeader.type = typeString;
							output.textContent = JSON.stringify(resultHeader);
							gotType = true;
							resultBuffer.push(value.slice(endOfType + 1));
						}
					} else {
						resultBuffer.push(value);
					}
					push();
				});
			};

			push();
		}
	});

	return new Response(stream, { headers: { "Content-Type": "text/html" } });
}

window.vmsrcEditor = null;
require.config({ paths: { 'vs': 'monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], function () {
	window.vmsrcEditor = monaco.editor.create(document.getElementById('container'), {
		value: [
		].join('\\n'),
		language: 'c'
	});
});

window.onresize = function () {
	window.vmsrcEditor.layout();
};

class Cluster {
	constructor(nodes) {
		this.buildNodes = nodes.filter(n => n.canBuild === 'true');
		this.nodes = nodes;
		this.availableNodes = nodes.slice();
		this.workQueue = [];
		this.buildCache = {};
	}

	processWorkQueue() {
		if (this.workQueue.length > 0 && this.availableNodes.length > 0) {
			var node = this.availableNodes.shift();
			var callback = this.workQueue.shift();
			var doNext = () => {
				this.availableNodes.push(node);
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
			fd.append('args', JSON.stringify({ arch: node.arch, target: node.target, addressing: node.addressing }));
			fd.append('source', source);
			const res = await fetch(this.buildNodes[0].url + '/build', { method: 'POST', body: fd });
			const blob = await res.blob();
			return { blob, isBinary: true };
		}
	}

	static async run(options) {
		const {
			nodes,
			name,
			source,
			params,
			outputLength,
			onResponse
		} = options;
		var green = '';
		var cluster = Cluster.parse(nodes);
		var inputs = Cluster.expandParams(params);
		var vmSuffix = '/new' + green + '/' + name;
		inputs.forEach((input) => {
			cluster.getNode(async (node) => {
				const program = await cluster.build(node, source);
				var fd = new FormData();
				fd.append('args', JSON.stringify({ input, outputLength, binary: program.isBinary }));
				fd.append('program', program.blob);
				var url = node.url + vmSuffix;
				const res = await fetch(url, { method: 'POST', body: fd });
				return onResponse(res);
			});
		});
		return cluster;
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

	static expandParam(param) {
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

	static expandParams(params) {
		if (params.length === 0) {
			return [];
		}
		var expanded = [];
		var colParams = params.map(Cluster.expandParam);
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

	static responseToBlob(response, onheader, ondata) {
		return new Promise((resolve, reject) => {
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
					var headerString = '';
					function push() {
						reader.read().then(({ done, value }) => {
							if (done) {
								controller.close();
								var resultBlob = new Blob(resultBuffer, { type: resultHeader.type });
								resultBlob.header = resultHeader;
								resolve(resultBlob);
								return;
							}
							if (!gotHeader) {
								var endOfHeader = value.indexOf(10);
								var headerSlice = value.slice(0, endOfHeader);
								headerString += decoder.decode(headerSlice, { stream: true });
								if (endOfHeader > -1) {
									resultHeader = JSON.parse(headerString);
									gotHeader = true;
									if (onheader) {
										onheader(resultHeader);
									}
									value = value.slice(endOfHeader + 1);
								}
							}
							if (!gotType) {
								var endOfType = value.indexOf(10);
								var typeSlice = value.slice(0, endOfType);
								typeString += typeDecoder.decode(typeSlice, { stream: true });
								if (endOfType > -1) {
									resultHeader.type = typeString;
									gotType = true;
									if (onheader) {
										onheader(resultHeader);
									}
									value = value.slice(endOfType + 1);
								}
							}
							if (gotType) {
								resultBuffer.push(value);
								if (ondata) {
									ondata(value);
								}
							}
							push();
						});
					};

					push();
				},

				error: reject
			});

			return new Response(stream, { headers: { "Content-Type": "text/html" } });
		});
	}

	static async responseToArrayBuffer(response, onheader, ondata) {
		return new Promise(async (resolve, reject) => {
			const resultBlob = await this.responseToBlob(response, onheader, ondata);
			var fileReader = new FileReader();
			fileReader.onload = function (event) {
				event.target.header = resultBlob.header;
				resolve(event.target.result);
			};
			fileReader.onerror = reject;
			fileReader.readAsArrayBuffer(resultBlob);
		});
	}
}
class Cluster {
	constructor(nodes) {
		this.buildNodes = nodes.filter(n => n.info.canBuild);
		this.nodes = nodes;
		this.availableNodes = nodes.slice();
		this.workQueue = [];
		this.buildCache = {};
	}

	processWorkQueue() {
		if (this.workQueue.length > 0 && this.availableNodes.length > 0) {
			var node = this.availableNodes.shift();
			while (node && node.disabled) {
				node = this.availableNodes.shift();
			}
			if (!node) {
				return;
			}
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

	async build(node, name, source) {
		if (node.info.canBuild) {
			return { blob: new Blob([source]), isBinary: false };
		} else {
			const vmSuffix = '/build/' + name;
			const args = { platform: node.info.platform, arch: node.info.arch, target: node.info.target, addressing: 32 };
			const buildNode = this.buildNodes.find(bn => {
				return (
					bn.info.platform === args.platform &&
					(bn.info.canCrossCompile || bn.info.arch === args.arch)
				);
			});
			if (!buildNode) {
				return false;
			}
			const bin = JSON.stringify(source);
			const body = new Blob([ JSON.stringify(args), '\n', bin ]);
			const url = buildNode.url + vmSuffix;
			const res = await fetch(url, { method: 'POST', body });
			const blob = await Cluster.responseToBlob(res);
			return { blob, isBinary: true };
		}
	}

	disableNode(node) {
		node.disabled = true;
	}

	static run(options) {
		const {
			nodes,
			name,
			source,
			params,
			outputLength,
			onResponse
		} = options;
		var green = '';
		var cluster = this.parse(nodes);
		var inputs = this.expandParams(params);
		var vmSuffix = '/new' + green + '/' + name;
		var runJob = (input) => {
			cluster.getNode(async (node) => {
				const program = await cluster.build(node, name, source);
				if (!program) {
					cluster.disableNode(node);
					return runJob(input);
				}
				const args = { input, outputLength, binary: program.isBinary };
				const bin = program.blob;
				const body = new Blob([ JSON.stringify(args), '\n', bin ]);
				const url = node.url + vmSuffix;
				const res = await fetch(url, { method: 'POST', body });
				return onResponse(res);
			});
		};
		inputs.forEach(runJob);
		return cluster;
	}

	static parse(nodeString) {
		return new Cluster(JSON.parse(nodeString));

		const defaultParams = { canBuild: 'true', arch: 'x86-64', target: 'avx2-i32x16', addressing: '32' };
		const nodes = nodeString.split(",").map(s => s.replace(/\s+/, '')).filter(s => s !== '').map(n => {
			var [url, ...paramList] = n.split(';');
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
		if (nodes.length === 0) {
			nodes.push({ url: '', ...defaultParams });
		}
		return new Cluster(nodes);
	}

	static expandParam(param) {
		if ((/\.\./).test(param)) {
			const [startStr, endStr, stepStr] = param.split(/\.\.\.?|:/);
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
		var colParams = params.map(this.expandParam);
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

	static responseToArrayBuffer(response, onheader, ondata) {
		return new Promise(async (resolve, reject) => {
			const resultBlob = await this.responseToBlob(response, onheader, ondata);
			var fileReader = new FileReader();
			fileReader.onload = function (event) {
				const arrayBuffer = event.target.result;
				arrayBuffer.header = resultBlob.header;
				resolve(arrayBuffer);
			};
			fileReader.onerror = reject;
			fileReader.readAsArrayBuffer(resultBlob);
		});
	}
}
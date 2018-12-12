const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const escape = require('escape-html');
const multer = require('multer'); // v1.0.5
const upload = multer();
const crypto = require('crypto');
const { NodeVM } = require('vm2');
const fs = require('fs');
const os = require('os');
const bonjour = require('bonjour')({ interface: '0.0.0.0' });
const http = require('http');

const { fork, execFile, execSync, execFileSync } = require('child_process');

const app = express();
const port = 7172;

app.use(cors());
app.use(bodyParser.text({ type: "*/*" }));
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

app.use('/monaco-editor/min/vs', express.static('node_modules/monaco-editor/min/vs'));

app.use('/', express.static('html'));



// Main app



var vmuid = 0;

const findName = (name) => {
    if (name === undefined) {
        return `VM ${vmuid++}`;
    }
    var nameIdx = {};
    Object.values(processes).forEach(p => nameIdx[p.name] = true);
    if (nameIdx[name]) {
        var uid = 2;
        var uniqueName = name;
        do {
            uniqueName = name + " " + uid;
            uid++;
        } while (nameIdx[uniqueName]);
        return uniqueName;
    }
    return name;
};

function getStatus() {
    const pid = this.pid;
    const psOutput = execFileSync('/bin/ps', ['--ppid', pid, '--pid', pid, '--forest', '-u']);
    return psOutput;
}

const processes = {};
const processesByName = {};

function sendResult(res, result) {
    try {
        if (ArrayBuffer.isView(result)) {
            res.write(Buffer.from(result.buffer, result.byteOffset, result.byteLength));
        } else if (result instanceof ArrayBuffer) {
            res.write(Buffer.from(result));
        } else if (typeof result === 'string') {
            res.write(result);
        } else {
            var json = JSON.stringify(result);
            if (json === undefined) {
                json = 'undefined';
            }
            res.write(json);
        }
    } catch (err) {
        res.write(err.stack.toString());
    }
}


app.post('/newGreen/:name?', upload.none(), (req, res) => {
    const t0 = Date.now();
    const startTime = Date.now();
    const psName = findName(req.params.name);
    const info = { pid: process.pid, name: psName, time: t0 };
    const state = { waiting: false, result: undefined };
    const script = req.body;
    const vm = new NodeVM({
        wrapper: 'none',
        sandbox: { state, info },
        require: {
            external: true
        }
    });

    try {
        var result = vm.run(script, info.name);
    } catch (err) {
        res.writeHead(500);
        sendResult(res, err.stack.toString());
        res.end();
        return;
    }

    res.writeHead(200);

    if (state.waiting) {
        var waitInterval = setInterval(() => {
            if (!state.waiting) {
                clearInterval(waitInterval);
                var t1 = Date.now();
                sendResult(res, state.result);
                res.write("\n------ Elapsed: " + (t1 - t0) + " ms\n")
                res.end("------ Total Elapsed: " + (t1 - startTime) + " ms\n")
            }
        }, 30);
    } else {
        var t1 = Date.now();
        sendResult(res, result);
        res.write("\n------ Elapsed: " + (t1 - t0) + " ms\n")
        res.end("------ Total Elapsed: " + (t1 - startTime) + " ms\n")
    }
});

var getTarget = function (nodeInfo) {
    if (nodeInfo.arch === 'aarch64' || nodeInfo.arch === 'armv7l') {
        return 'neon-i32x4';
    }
    if (nodeInfo.arch === 'x86-64') {
        if (nodeInfo.platform === 'linux') {
            var keys = execSync(`grep -o -E ' mmx\\S* | sse\\S* | avx\\S* ' /proc/cpuinfo | sort -u`).toString().replace(/^\s+|\s+$/g, '').split(/\s+/);
            if (keys.indexOf('avx2') > -1) {
                return 'avx2-i32x8';
            } else if (keys.indexOf('avx') > -1) {
                return 'avx1-i32x8';
            } else if (keys.indexOf('sse4_1') > -1 || keys.indexOf('sse4a') > -1) {
                return 'sse4-i32x8';
            } else {
                return 'sse2-i32x8';
            }
        } else if (nodeInfo.platform === 'macos') {
            var keys = execSync(`sysctl -a | grep machdep.cpu | grep -o -E ' MMX\\S* | SSE\\S* | AVX\\S* '`).toString().toLowerCase().replace(/^\s+|\s+$/g, '').split(/\s+/);
            if (keys.indexOf('avx2') > -1) {
                return 'avx2-i32x8';
            } else if (keys.indexOf('avx1.0') > -1) {
                return 'avx1-i32x8';
            } else if (keys.indexOf('sse4.1') > -1) {
                return 'sse4-i32x8';
            } else {
                return 'sse2-i32x8';
            }
        }
    }
    throw new Error("Unknown architecture");
}

var getThreadCount = function (nodeInfo) {
    if (nodeInfo.platform === 'linux') {
        return parseInt(execSync(`grep processor /proc/cpuinfo | wc -l`).toString());
    } else if (nodeInfo.platform === 'macos') {
        return parseInt(execSync(`sysctl -a | grep machdep.cpu.thread_count | awk '{ print $2 }'`).toString());
    }
    throw new Error("Unknown platform");
}

var getMemorySize = function (nodeInfo) {
    if (nodeInfo.platform === 'linux') {
        return parseInt(execSync(`grep MemTotal /proc/meminfo | awk '{ print $2 }'`).toString()) * 1000;
    } else if (nodeInfo.platform === 'macos') {
        return parseInt(execSync(`sysctl -a | grep hw.memsize | awk '{ print $2 }'`).toString());
    }
    throw new Error("Unknown platform");
}

var getCPUFreq = function (nodeInfo) {
    if (nodeInfo.platform === 'linux') {
        return execSync(`cat /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq`).toString().replace(/^\s+|\s+$/g, '').split(/\s+/).map(s => parseInt(s));
    } else {
        var freq = parseInt(execSync(`sysctl -a | grep hw.cpufrequency_max | awk '{ print $2 }'`).toString());
        var freqs = [];
        for (var i = 0; i < nodeInfo.threadCount; i++) {
            freqs.push(freq);
        }
        return freqs;
    }
    return [];
}

var nodeInfo = {
    platform: fs.existsSync('/proc/cpuinfo') ? 'linux' : 'macos',
    arch: execSync('uname -m').toString().replace(/\s/g, '').replace('_', '-')
};
nodeInfo.target = getTarget(nodeInfo);
nodeInfo.threadCount = getThreadCount(nodeInfo);
nodeInfo.memorySize = getMemorySize(nodeInfo);
nodeInfo.cpuMaxFreq = getCPUFreq(nodeInfo);
nodeInfo.canBuild = nodeInfo.arch === 'x86-64';
nodeInfo.canCrossCompile = nodeInfo.canBuild && nodeInfo.platform === 'linux';


app.get('/info', (req, res) => {
    res.writeHead(200);
    res.end(JSON.stringify(nodeInfo));
});


const getBuildTarget = () => {
    var cpusig;
    var platform = 'linux';
    var arch = execSync('uname -m').toString().replace(/\s/g, '').replace('_', '-');
    if (/^arm/.test(arch)) {
        arch = 'arm';
    }
    if (fs.existsSync('/proc/cpuinfo')) {
        if (execSync('uname -o').toString().replace(/\s/g, '') === 'Android') {
            platform = 'android';
        }
        cpusig = platform + '-' + execSync("grep -o -E ' mmx\\S* | sse\\S* | avx\\S* ' /proc/cpuinfo | sort -u | md5sum").toString().split(" ")[0];
    } else if (fs.existsSync('/Library/ColorSync')) {
        platform = 'macos';
        cpusig = platform + '-' + execSync(`sysctl -a | grep machdep.cpu | grep features | sed 's/.*: //' | tr '[:upper:]' '[:lower:]' | tr ' ' "\n" | sort | uniq | grep -E 'avx|sse|mmx' | md5`).toString().replace(/\s/g, '');
    } else {
        throw new Error("Unknown platform");
    }
    return {
        cpusig: cpusig,
        platform: platform,
        arch: arch
    };
};

const BuildTarget = getBuildTarget();

const runVM_ = function (name, body, res) {
    function sendResult(result) {
        try {
            res.write(result);
        } catch (err) {
            res.write('error\n');
            res.write(err.stack.toString());
            res.end();
        }
    }

    var time = Date.now();

    try {
        const firstLine = body.indexOf(10);
        const programInputObj = JSON.parse(body.slice(0, firstLine).toString());
        const program = body.slice(firstLine + 1);

        const programInput = new ArrayBuffer(programInputObj.input.length * 4 + 4);
        const i32 = new Int32Array(programInput, 0, 1);
        i32[0] = programInputObj.outputLength;
        const f32 = new Float32Array(programInput, 4);
        f32.set(programInputObj.input);

        var programHash = crypto.createHash('sha256').update(program).digest('hex');
        var target = BuildTarget.cpusig + '/' + programHash;

        if (!fs.existsSync(`./ispc/build/targets/${target}/program`)) {
            if (!fs.existsSync(`./ispc/build/targets/${target}`)) {
                execFileSync('mkdir', ['-p', `./ispc/build/targets/${target}`]);
            }
            if (programInputObj.executable) {
                fs.writeFileSync(`./ispc/build/targets/${target}/program`, program);
            } else if (programInputObj.binary) {
                fs.writeFileSync(`./ispc/build/targets/${target}/program.o`, program);
                execFileSync('/usr/bin/make', [
                    `TARGET=${target}`,
                    `PLATFORM=${BuildTarget.platform}`,
                    `ARCH=${BuildTarget.arch}`,
                    `MY_PLATFORM=${BuildTarget.platform}`,
                    `MY_ARCH=${BuildTarget.arch}`,
                    `link`
                ], {cwd: './ispc/build'});
            } else {
                fs.writeFileSync(`./ispc/build/targets/${target}/program.ispc`, program);
                execFileSync('/usr/bin/make', [
                    `TARGET=${target}`,
                    `PLATFORM=${BuildTarget.platform}`,
                    `ARCH=${BuildTarget.arch}`,
                    `MY_PLATFORM=${BuildTarget.platform}`,
                    `MY_ARCH=${BuildTarget.arch}`,
                    `ispc`,
                    `link`
                ], {cwd: './ispc/build'});
            }
        }

        fs.writeFileSync(`./ispc/build/targets/${target}/input`, Buffer.from(programInput));

        // Set OMP_NUM_THREADS=8 for Android targets

        const ps = execFile(`./targets/${target}/program`, [], { encoding: 'buffer', stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: Infinity, env: { ...process.env, 'OMP_NUM_THREADS': '8' }, cwd: './ispc/build'});

        ps.name = findName(name);
        Object.defineProperty(ps, 'status', { get: getStatus });

        processes[ps.pid] = ps;
        processesByName[ps.name] = ps;
        ps.on('exit', (code, signal) => {
            process.stderr.write('Exit: ' + code + ' ' + signal + '\n')
            delete processes[ps.pid];
            delete processesByName[ps.name];
        });
        ps.on('close', () => res.end());
        ps.imageHash = programHash;

        res.writeHead(200);
        res.write(JSON.stringify({ pid: ps.pid, name: ps.name, hash: 'sha256:' + ps.imageHash, startTime: time }) + '\n');
        res.write("application/octet-stream\n");

        ps.stdout.encoding

        ps.stdout.on('data', (msg) => res.write(msg));
        ps.stdout.on('close', () => res.end());

        ps.stdin.write(Buffer.from(programInput));
        ps.stdin.end();
        
    } catch (e) {

        res.write("error\n");
        sendResult(e.stack.toString());
        res.end();

    }
};

const runVM = function (instance, name, body, res) {
    var time = Date.now();

    var ps = fork(instance, { stdio: 'pipe' });
    ps.name = findName(name);
    Object.defineProperty(ps, 'status', { get: getStatus });
    ps.stdin.write(JSON.stringify({ pid: ps.pid, name: ps.name, time: time }) + '\n');
    ps.stdin.write(body);
    ps.stdin.end();
    ps.on('exit', (err) => {
        delete processes[ps.pid];
        delete processesByName[ps.name];
    });
    processes[ps.pid] = ps;
    processesByName[ps.name] = ps;
    res.writeHead(200);
    ps.imageHash = crypto.createHash('sha256').update(body).digest('hex');
    res.write(JSON.stringify({ pid: ps.pid, name: ps.name, hash: 'sha256:' + ps.imageHash, startTime: time }) + '\n');
    ps.stdout.on('close', () => res.end());
    ps.stdout.on('data', (msg) => res.write(msg));
}

app.post('/new/:name?', (req, res) =>
    bodyAsBuffer(req, buffer => runVM_(req.params.name, buffer, res))
);

app.post('/build/:name?', (req, res) =>
    bodyAsBuffer(req, buffer => runVM('./build-instance', 'build-' + req.params.name, buffer, res))
);

app.get('/list', (req, res) => {
    res.send(
        "<h3>Running processes</h3>"
        + "<ul>"
        + Object.keys(processes).map(pid => `<li><a href="/vm/${pid}">${processes[pid].name} (PID ${pid}, hash ${processes[pid].imageHash})</a></li>`).join("")
        + "</ul>"
    );
});

app.get('/vm/:pid', (req, res) => {
    var pid = req.params.pid;
    var ps = processes[pid] || processesByName[pid];
    if (ps) {
        res.send(`
            <p>PID: ${pid}</p>
            <pre>${ escape(ps.status)}</pre>
            <form method="POST" action="/signal/${pid}/SIGTSTP"><button>Pause</button></form>
            <form method="POST" action="/signal/${pid}/SIGCONT"><button>Continue</button></form>
            <form method="POST" action="/signal/${pid}/SIGTERM"><button>Terminate</button></form>
            <form method="POST" action="/signal/${pid}/SIGKILL"><button>Kill</button></form>
        `);
    } else {
        res.send('Not found<br><a href=\"/list\">Back to process list</a>');
    }
});

app.post('/signal/:pid/:signal', upload.none(), (req, res) => {
    var pid = req.params.pid;
    var signal = req.params.signal || 'SIGTERM';
    if (processes[pid] || processesByName[pid]) {
        execFile('/usr/bin/pkill', [`-${signal}`, '-P', pid.toString()]);
        processes[pid].kill(signal);
        res.send(`OK<br><a href="/vm/${pid}">Back to process</a>`);
    } else {
        res.send("Not found<br><a href=\"/list\">Back to process list</a>");
    }
});

const bodyAsBuffer = (req, cb) => {
    var chunks = [];
    req.on('data', b => chunks.push(b));
    req.on('end', () => cb(Buffer.concat(chunks)));
}
const bodyAsString = (req, cb) => bodyAsBuffer(req, b => cb(b.toString()));
const bodyAsJson = (req, cb) => bodyAsString(req, s => cb(JSON.parse(s)));

const availableNodes = [];

app.get('/nodes', (req, res) => {
    res.end(JSON.stringify(availableNodes.map(n => ({
        url: n.url,
        info: n.info,
        addresses: n.addresses,
        name: n.name
    }))));
});

app.post('/nodes/add', (req, res) => {
    bodyAsString(req, s => {
        registerNode(JSON.parse(s))
        res.end('ok');
    });
});




// Service registration

/*
    Service discovery protocol:
        1. Advertise on mdns
        2. On receiving an advertisement (or manually adding a node), process the node
            a. node/info - Connect to the advertised node to get its details
            b. node/nodes - Fetch the list of nodes known to the advertised node
            c. Add the list of nodes to known nodes
        3. Process known nodes list in the background
*/


const fetchJson = (url, ok, fail) => {
    const onError = (err) => {
        if (fail) {
            fail(err);
        } else {
            console.error(err);
        }
    };
    http.get(url, (res) => {
        bodyAsJson(res, ok);
        res.on('error', onError);
    }).on('error', onError);
};

const pingNode = (service, ok, fail) => {
    fetchJson(service.url + '/info', (info) => {
        service.info = info;
        if (ok) {
            ok(service);
        }
    }, fail);
};

const fetchNodes = (service, ok, fail) => {
    fetchJson(service.url + '/nodes', (nodes) => {
        nodes.forEach(registerNode);
        if (ok) {
            ok(nodes);
        }
    }, fail);
};

const updateNodes = () => {
    setTimeout(updateNodes, 10000);
    availableNodes.forEach(n => fetchNodes(n, null, () => unregisterNode(n)));
}

const getServiceURL = (service) => 'http://' + service.addresses.find(addr => /^(192\.168\.|10\.)/.test(addr)) + ':' + service.port;
const parseService = (service) => ({ ...service, url: service.url || getServiceURL(service) });

const serviceIndex = (service) => availableNodes.findIndex(n => n.url === service.url);

const registerNode = (rawService) => {
    const service = parseService(rawService);
    if (serviceIndex(service) === -1) {
        pingNode(service, s => {
            if (serviceIndex(service) === -1) {
                console.log("Added node ", s.url);
                availableNodes.push(s);
                fetchNodes(s);
            }
        });
    }
};

const unregisterNode = (service) => {
    service.url = getServiceURL(service);
    const idx = serviceIndex(service);
    if (idx > -1) {
        console.log("Removed node ", service.url);
        availableNodes.splice(idx, 1);
        var bidx = browser.services.indexOf(service);
        if (bidx > -1) {
            browser.services.splice(bidx, 1);
        }
    }
};

var service, browser;

if (process.argv.length > 2) {
    process.argv.slice(2).forEach(host => {
        registerNode({
            url: 'http://' + host + ':' + 7172,
            host: host,
            port: 7172,
            addresses: [host]
        });
    });
}

app.listen(port, () => {
    console.log(`NodeVM server up on port ${port} @ ${Date.now()}`)

    // Service discovery

    service = bonjour.publish({ name: 'Compute Worker ' + os.hostname() + " " + Date.now(), type: 'compute', port: port.toString() });
    browser = bonjour.find({ type: 'compute' }, registerNode);
    browser.on('down', unregisterNode);
    setInterval(() => browser.update(), 10000);

    updateNodes();

});





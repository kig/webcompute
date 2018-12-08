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
const bonjour = require('bonjour')();
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
    if (nodeInfo.arch === 'aarch64' || nodeInfo.arch === 'arm') {
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

app.post('/new/:name?', (req, res) => {
    var chunks = [];
    req.on('data', function (chunk) {
        chunks.push(chunk);
    });
    req.on('end', function () {
        var buffer = Buffer.concat(chunks);
        runVM('./vm-instance', req.params.name, buffer, res);
    });
});

app.post('/build/:name?', (req, res) => {
    var chunks = [];
    req.on('data', function (chunk) {
        chunks.push(chunk);
    });
    req.on('end', function () {
        var buffer = Buffer.concat(chunks);
        runVM('./build-instance', 'build-' + req.params.name, buffer, res);
    });
});

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

const availableNodes = [];

app.get('/nodes', (req, res) => {
    res.end(JSON.stringify(availableNodes.map(n => ({
        url: 'http://' + n.host + ':' + n.port,
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



const pingNode = (service, ok, fail) => {
    const onError = (err) => {
        if (fail) {
            fail(err);
        } else {
            console.error(err);
        }
    };
    http.get('http://' + service.host + ':' + service.port + '/info', (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
            const info = JSON.parse(Buffer.concat(chunks).toString());
            service.info = info;
            if (ok) {
                ok(service);
            }
        });
        res.on('error', onError);
    }).on('error', onError);
};

const pruneNodes = () => {
    setTimeout(pruneNodes, 60000);
    availableNodes.forEach(n => pingNode(n, null, () => unregisterNode(n)));
}

const registerNode = (service) => {
    const idx = availableNodes.findIndex(n => n.name === service.name);
    if (idx === -1) {
        pingNode(service, s => {
            console.log("Added node ", s.host, s.port);
            availableNodes.push(s);
        });
    }
};

const unregisterNode = (service) => {
    const idx = availableNodes.findIndex(n => n.name === service.name);
    if (idx > -1) {
        console.log("Removed node ", service.host, service.port);
        availableNodes.splice(idx, 1);
    }
};


app.listen(port, () => {
    console.log(`NodeVM server up on port ${port} @ ${Date.now()}`)

    // Service discovery

    var service = bonjour.publish({ name: 'Compute Worker ' + os.hostname(), type: 'compute', port: port.toString() });
    var browser = bonjour.find({ type: 'compute' }, registerNode);
    browser.on('down', unregisterNode);

    pruneNodes();

});





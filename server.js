const express = require('express');
const bodyParser = require('body-parser');
const escape = require('escape-html');
const multer = require('multer'); // v1.0.5
const upload = multer(); // for parsing multipart/form-data
const crypto = require('crypto');
const { NodeVM } = require('vm2');

const { fork, execFile, execFileSync } = require('child_process');

const app = express();
const port = 7172;

app.use(bodyParser.text({type: "*/*"}));
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

app.use('/monaco-editor/min/vs', express.static('node_modules/monaco-editor/min/vs'));

app.get('/', (req, res) => res.send(
`<!doctype html><html><body>
<script>
function send() {
 window.event.preventDefault();
 output.textContent = '';
 var green = '';
 fetch('/new' + green + '/' + this.vmname.value, {
   method: 'POST',
   body: window.vmsrcEditor.getValue()
 })
 .then(response => {
  const reader = response.body.getReader();
  const stream = new ReadableStream({
    start(controller) {
      var decoder = new TextDecoder('utf-8');
      function push() {
        reader.read().then(({ done, value }) => {
          if (done) {
            controller.close();
            return;
          }

          output.textContent += decoder.decode(value, {stream: true});
          push();
        });
      };

      push();
    }
  });

  return new Response(stream, { headers: { "Content-Type": "text/html" } });
 });
}
</script>
<style>
#container {
width: 80em;
height: 25em;
}
</style>
	<nav>
		<a href="list/">List running VMs</a>
	</nav>
	<h3>Create new VM</h3>
        <form onsubmit="send()">
	<p><input id="vmname" placeholder="VM Name">
	<div id="container"></div>
	<p><button>Run</button>
        </form>
	<p>VM output
	<pre id="output"></pre>

<script src="monaco-editor/min/vs/loader.js"></script>
<script>
    window.vmsrcEditor = null;
    require.config({ paths: { 'vs': 'monaco-editor/min/vs' }});
    require(['vs/editor/editor.main'], function() {
        window.vmsrcEditor = monaco.editor.create(document.getElementById('container'), {
            value: [
                'console.log("Hello world!");',
                'return 1234;'
            ].join('\\n'),
            language: 'javascript'
        });
    });
</script>

</body></html>
`));

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
    } catch(err) {
	res.write(err.stack.toString());
    }
}


app.post('/newGreen/:name?', upload.none(), (req, res) => {
  const t0 = Date.now();
  const startTime = Date.now();
  const psName = findName(req.params.name);
  const info = {pid: process.pid, name: psName, time: t0};
  const state = {waiting: false, result: undefined};
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
  } catch(err) {
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
	    res.write("\n------ Elapsed: " + (t1-t0) + " ms\n")
	    res.end("------ Total Elapsed: " + (t1-startTime) + " ms\n")
	}
    }, 30);
  } else {
    var t1 = Date.now();
    sendResult(res, result);
    res.write("\n------ Elapsed: " + (t1-t0) + " ms\n")
    res.end("------ Total Elapsed: " + (t1-startTime) + " ms\n")
  }
});

app.post('/new/:name?', upload.none(), (req, res) => {

    var time = Date.now();

    var ps = fork('./vm-instance', {stdio: 'pipe'});
    ps.name = findName(req.params.name);
    Object.defineProperty(ps, 'status', { get: getStatus });
    ps.stdin.write(JSON.stringify({pid: ps.pid, name: ps.name, time: time}) + '\n');
    ps.stdin.write(req.body);
    ps.stdin.end();
    ps.on('exit', (err) => {
        delete processes[ps.pid];
        delete processesByName[ps.name];
    });
    processes[ps.pid] = ps;
    processesByName[ps.name] = ps;
    res.writeHead(200);
    res.write(`${ps.pid.toString()}\n${ps.name}\n`)
    ps.imageHash = crypto.createHash('sha256').update(req.body).digest('hex');
    res.write(`${ps.imageHash}\n`);
    ps.stdout.on('close', () => res.end());
    ps.stdout.on('data', (msg) => res.write(msg));
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
            <pre>${ escape(ps.status) }</pre>
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

app.listen(port, () => console.log(`NodeVM server up on port ${port} @ ${Date.now()}`));


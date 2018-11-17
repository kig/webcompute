var t0 = Date.now();

const fs = require('fs');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');

function sendResult(result) {
    try {
        process.stdout.write(result);
    } catch(err) {
	process.stdout.write(err.stack.toString());
    }
}

const stdinBuffer = fs.readFileSync(0);
const firstLine = stdinBuffer.indexOf(10);
const secondLine = stdinBuffer.indexOf(10, firstLine + 1);
const infoString = stdinBuffer.slice(0, firstLine).toString();
const info = JSON.parse(infoString);
const program = JSON.parse(stdinBuffer.slice(firstLine + 1, secondLine).toString());
const programInputObj = JSON.parse(stdinBuffer.slice(secondLine + 1).toString());

const programInput = new ArrayBuffer(programInputObj.input.length*4 + 4);
const i32 = new Int32Array(programInput, 0, 1);
i32[0] = programInputObj.outputLength;
const f32 = new Float32Array(programInput, 4);
f32.set(programInputObj.input);

const startTime = info.time;

try {

    var target = crypto.createHash('sha256').update(program).digest('hex');

    process.chdir('./ispc/build');

    if (!fs.existsSync(`./targets/${target}/program`)) {
	if (!fs.existsSync(`./targets/${target}`)) {
	    fs.mkdirSync(`./targets/${target}`, {recursive: true});
	}
	fs.writeFileSync(`./targets/${target}/program.ispc`, program);
	execFileSync('/usr/bin/make', [`TARGET=${target}`]);
    }

    fs.writeFileSync(`./targets/${target}/input`, Buffer.from(programInput));

    const output = execFileSync(`./targets/${target}/program`, [], {input: Buffer.from(programInput)});

    var t1 = Date.now();

    process.stdout.write("application/octet-stream\n");
    sendResult(output);


} catch(e) {

    sendResult(e.stack.toString());

}

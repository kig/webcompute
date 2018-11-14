var t0 = Date.now();

function sendResult(result) {
    try {
        process.stdout.write(result);
    } catch(err) {
	process.stdout.write(err.stack.toString());
    }
}

const fs = require('fs');
const { execSync, execFileSync } = require('child_process');
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

  var target = info.hash;

  process.chdir('./ispc/build');

  if (!fs.existsSync(`./targets/${target}/program`)) {
    if (!fs.existsSync(`./targets/${target}`)) {
      fs.mkdirSync(`./targets/${target}`, {recursive: true});
    }
    fs.writeFileSync(`./targets/${target}/program.ispc`, program);
    execSync('make', [`TARGET=${target}`]);
  }

  const output = execFileSync(`./targets/${target}/program`, [], {input: Buffer.from(programInput)});

  var t1 = Date.now();

  process.stdout.write("application/octet-stream\n");
  sendResult(output);


} catch(e) {

  sendResult(e.stack.toString());

}

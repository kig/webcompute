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
const stdinString = stdinBuffer.toString();
const [infoString] = stdinString.split('\n', 1);
const info = JSON.parse(infoString);
const script = stdinString.slice(infoString.length+1);

console.log(info, script);

const startTime = info.time;

try {

  process.chdir('./ispc/build');

  fs.writeFileSync('runner.ispc', script);

  execSync('make');

  const output = execFileSync('./runner', info.args, {input: ''});

  var t1 = Date.now();
  process.stdout.write("\n------ Elapsed: " + (t1-t0) + " ms\n")
  process.stdout.write("------ Total Elapsed: " + (t1-startTime) + " ms\n")

  sendResult(output);


} catch(e) {

  sendResult(e.stack.toString());

}

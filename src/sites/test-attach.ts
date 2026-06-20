import * as path from "node:path";
import * as fs from "node:fs";

const args = process.argv.slice(2);
console.log("[test-attach] 所有参数:", JSON.stringify(args));

let prompt = "";
let filePath: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--file") {
    filePath = args[++i];
    console.log("[test-attach] 找到 --file:", filePath);
  } else if (!args[i].startsWith("--")) {
    prompt = args[i];
  }
}

console.log("[test-attach] prompt:", prompt);
console.log("[test-attach] filePath:", filePath);

if (filePath) {
  const absPath = path.resolve(filePath);
  console.log("[test-attach] absPath:", absPath);
  console.log("[test-attach] 文件存在:", fs.existsSync(absPath));
}

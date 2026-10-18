import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)];
if (scripts.length !== 1) {
  throw new Error(`Expected exactly one inline script in public/index.html, found ${scripts.length}.`);
}
new vm.Script(scripts[0][1], { filename: "public/index.html:inline-script" });
console.log("Responsive UI inline JavaScript syntax is valid.");

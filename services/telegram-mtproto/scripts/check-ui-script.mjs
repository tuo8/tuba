import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const startTag = "<script>";
const endTag = "</script>";
const start = html.indexOf(startTag);
const end = html.indexOf(endTag, start + startTag.length);
if (start < 0 || end < 0 || html.indexOf(startTag, start + startTag.length) >= 0) {
  throw new Error("Expected exactly one inline script in public/index.html.");
}
new vm.Script(html.slice(start + startTag.length, end), { filename: "public/index.html:inline-script" });
console.log("Responsive UI inline JavaScript syntax is valid.");

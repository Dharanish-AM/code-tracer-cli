#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const acorn = require("acorn");
const madge = require("madge");
const chalk = require("chalk");
const { program } = require("commander");

program
  .version("1.0.0")
  .option("-d, --dir <directory>", "Project directory")
  .parse(process.argv);

const projectDir = path.resolve(program.opts().dir || process.cwd());

console.log(chalk.blue(`📊 Scanning project: ${projectDir}\n`));

/**
 * Recursively generate a directory tree structure
 */
function getProjectStructure(dir, ignoredDirs = [".git", "node_modules", "dist"], prefix = "") {
  let structure = "";
  const files = fs.readdirSync(dir);

  files.forEach((file, index) => {
    let fullPath = path.join(dir, file);
    const isLast = index === files.length - 1;
    const prefixBranch = isLast ? "└── " : "├── ";

    if (fs.statSync(fullPath).isDirectory()) {
      if (!ignoredDirs.includes(file)) {
        structure += `${prefix}${prefixBranch}📂 ${file}/\n`;
        structure += getProjectStructure(fullPath, ignoredDirs, prefix + (isLast ? "    " : "│   "));
      }
    } else {
      structure += `${prefix}${prefixBranch}📄 ${file}\n`;
    }
  });

  return structure;
}

/**
 * Get all JavaScript & TypeScript files
 */
function getAllFiles(dir, ignoredDirs = [".git", "node_modules", "dist"]) {
  let results = [];
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    let fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (!ignoredDirs.includes(file)) {
        results = results.concat(getAllFiles(fullPath, ignoredDirs));
      }
    } else if (fullPath.endsWith(".js") || fullPath.endsWith(".ts")) {
      results.push(fullPath);
    }
  });

  return results;
}

/**
 * Analyze JavaScript files
 */
function analyzeFiles(files) {
  let functionSizes = [];
  let imports = {};

  function traverseAst(node, file) {
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      let size = node.loc.end.line - node.loc.start.line;
      functionSizes.push({
        name: node.id ? node.id.name : `(anonymous)`,
        size,
        file,
      });
    } else if (node.type === "ImportDeclaration") {
      imports[node.source.value] = (imports[node.source.value] || 0) + 1;
    } else if (
      node.type === "CallExpression" &&
      node.callee.name === "require" &&
      node.arguments.length > 0 &&
      node.arguments[0].type === "Literal"
    ) {
      imports[node.arguments[0].value] =
        (imports[node.arguments[0].value] || 0) + 1;
    }

    for (let key in node) {
      if (node[key] && typeof node[key] === "object") {
        traverseAst(node[key], file);
      }
    }
  }

  for (let file of files) {
    try {
      let code = fs.readFileSync(file, "utf-8");
      let ast = acorn.parse(code, {
        sourceType: "module",
        ecmaVersion: "latest",
        locations: true,
      });

      traverseAst(ast, file);
    } catch (error) {
      console.warn(
        chalk.yellow(`⚠ Skipping file due to parsing error: ${file}\n  Reason: ${error.message}`)
      );
    }
  }

  return { functionSizes, imports };
}

/**
 * Detect Circular Dependencies
 */
async function checkCircularDependencies() {
  try {
    const result = await madge(projectDir);
    const circularDeps = result.circular();

    if (circularDeps.length) {
      console.log(chalk.red("\n🔄 Circular Dependencies:"));
      circularDeps.forEach(dep => console.log(`  - ${dep.join(" → ")}`));
    } else {
      console.log(chalk.green("\n✔ No Circular Dependencies Found"));
    }
  } catch (error) {
    console.error(
      chalk.red("❌ Error analyzing circular dependencies:"),
      error
    );
  }
}

/**
 * 🎯 Display Overview
 */
async function displayOverview() {
  try {
    let files = getAllFiles(projectDir);

    console.log(chalk.bold.bgBlue("\n📂 PROJECT BREAKDOWN:"));
    console.log(chalk.yellow(getProjectStructure(projectDir)));

    console.log(chalk.bold.bgMagenta(`\n📊 FOUND: ${chalk.white.bold(files.length)} JavaScript/TypeScript files`));

    let { functionSizes, imports } = analyzeFiles(files);

    console.log(chalk.bold.bgRed("\n🚀 LARGE FUNCTIONS DETECTED:"));
    let largeFunctions = functionSizes.filter(fn => fn.size > 50);
    if (largeFunctions.length) {
      largeFunctions.forEach(({ name, size, file }) =>
        console.log(chalk.redBright.bold(`  ⚠ ${chalk.white.bold(name)} (${chalk.yellow.bold(size)} lines) in ${chalk.cyan(file)}`))
      );
    } else {
      console.log(chalk.green.bold("  ✔ No large functions found 🎉"));
    }

    console.log(chalk.bold.bgGreen("\n📦 MOST USED IMPORTS:"));
    let sortedImports = Object.entries(imports).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (sortedImports.length) {
      sortedImports.forEach(([module, count]) =>
        console.log(chalk.cyan.bold(`  🔹 ${chalk.white.bold(module)}: ${chalk.yellowBright.bold(count)} times`))
      );
    } else {
      console.log(chalk.green.bold("  ✔ No significant imports found 🏆"));
    } 

    await checkCircularDependencies();
  } catch (error) {
    console.error(
      chalk.bold.bgRed.white("❌ ERROR: An error occurred during the analysis!"), 
      chalk.red(error)
    );
  }
}

displayOverview().then(() => process.exit(0));

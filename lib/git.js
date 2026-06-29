// lib/git.js
// Integração Git para projetos (pastas conectadas). Operações determinísticas
// via child_process — sem LLM. Commit exige mensagem do usuário (aprovação humana).

const { execFile, exec } = require("child_process");
const path = require("path");

// Procura git no PATH e em locais comuns do Windows
const GIT_CANDIDATES = [
  "git",
  "C:\\Program Files\\Git\\bin\\git.exe",
  "C:\\Program Files (x86)\\Git\\bin\\git.exe",
  "C:\\Users\\70854\\AppData\\Local\\Programs\\Git\\bin\\git.exe",
];

let _gitPath = null;
async function findGit() {
  if (_gitPath) return _gitPath;
  for (const candidate of GIT_CANDIDATES) {
    try {
      await new Promise((resolve, reject) =>
        execFile(candidate, ["--version"], { timeout: 3000, windowsHide: true }, (err) =>
          err ? reject(err) : resolve()
        )
      );
      _gitPath = candidate;
      return _gitPath;
    } catch {}
  }
  return "git"; // fallback
}

async function run(cwd, args, { timeout = 60000 } = {}) {
  const gitBin = await findGit();
  return new Promise((resolve) => {
    execFile(gitBin, args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? (err.code || 1) : 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || (err ? err.message : "")),
      });
    });
  });
}

async function isRepo(cwd) {
  const r = await run(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return r.ok && /true/.test(r.stdout);
}

async function init(cwd) {
  const r = await run(cwd, ["init"]);
  return { ok: r.ok, message: (r.stdout || r.stderr).trim() };
}

// status resumido: branch + arquivos modificados/staged/untracked
async function status(cwd) {
  if (!(await isRepo(cwd))) return { repo: false };
  const br = await run(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const st = await run(cwd, ["status", "--porcelain=v1"]);
  const remoteR = await run(cwd, ["remote", "-v"]);
  const remotes = remoteR.ok
    ? [...new Set(
        remoteR.stdout
          .split("\n")
          .filter(Boolean)
          .map((l) => l.split(/\s+/)[1])
          .filter(Boolean)
      )]
    : [];

  // ahead/behind
  let ahead = 0, behind = 0;
  const upstream = await run(cwd, ["rev-list", "--count", "--left-right", "@{upstream}...HEAD"]);
  if (upstream.ok) {
    const parts = upstream.stdout.trim().split(/\s+/);
    behind = parseInt(parts[0]) || 0;
    ahead = parseInt(parts[1]) || 0;
  }

  const files = st.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const x = line.slice(0, 2);
      const file = line.slice(3).trim();
      let state = "modificado";
      if (/\?\?/.test(x)) state = "novo (não rastreado)";
      else if (/^A/.test(x)) state = "adicionado";
      else if (/^D/.test(x) || /D/.test(x)) state = "removido";
      else if (/^R/.test(x)) state = "renomeado";
      const staged = x[0] !== " " && x[0] !== "?";
      return { file, state, staged, raw: x };
    });

  return {
    repo: true,
    branch: (br.stdout || "").trim() || "(sem commits)",
    files,
    clean: files.length === 0,
    remotes,
    ahead,
    behind,
  };
}

async function diff(cwd, file) {
  const args = ["diff"];
  if (file) args.push("--", file);
  const unstaged = await run(cwd, args);
  const stagedArgs = ["diff", "--staged"];
  if (file) stagedArgs.push("--", file);
  const staged = await run(cwd, stagedArgs);
  return { unstaged: unstaged.stdout, staged: staged.stdout };
}

async function log(cwd, n = 15) {
  const r = await run(cwd, ["log", `-${n}`, "--pretty=format:%h\x1f%an\x1f%ar\x1f%s"]);
  if (!r.ok) return [];
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [hash, author, when, subject] = l.split("\x1f");
      return { hash, author, when, subject };
    });
}

async function branches(cwd) {
  const r = await run(cwd, ["branch", "--all"]);
  return r.stdout
    .split("\n")
    .map((s) => s.replace(/^[*\s]+/, "").trim())
    .filter(Boolean);
}

// Commit: add (tudo ou arquivos dados) + commit com a mensagem do usuário.
async function commit(cwd, message, { addAll = true, files = null } = {}) {
  if (!message || !message.trim()) return { ok: false, error: "mensagem de commit obrigatória" };
  if (addAll) await run(cwd, ["add", "-A"]);
  else if (files && files.length) await run(cwd, ["add", ...files]);
  const r = await run(cwd, ["commit", "-m", message]);
  return { ok: r.ok, output: (r.stdout || r.stderr).trim() };
}

// Push para o remoto
async function push(cwd, remote = "origin", branch = null) {
  const args = ["push", remote];
  if (branch) args.push(branch);
  const r = await run(cwd, args, { timeout: 120000 });
  return { ok: r.ok, output: (r.stdout || r.stderr).trim() };
}

// Pull do remoto
async function pull(cwd, remote = "origin", branch = null) {
  const args = ["pull", remote];
  if (branch) args.push(branch);
  const r = await run(cwd, args, { timeout: 120000 });
  return { ok: r.ok, output: (r.stdout || r.stderr).trim() };
}

// Clona um repositório remoto para dentro de `parent`, na subpasta do nome do repo.
async function clone(url, parent) {
  const fs = require("fs");
  if (!/^(https?:\/\/|git@)/.test(url)) return { ok: false, error: "URL de repositório inválida." };
  if (!parent || !fs.existsSync(parent)) return { ok: false, error: "Pasta de destino não existe." };
  const name = (url.split("/").pop() || "repo").replace(/\.git$/, "").replace(/[^a-z0-9._-]/gi, "_");
  const dest = path.join(parent, name);
  if (fs.existsSync(dest)) return { ok: false, error: "Já existe uma pasta '" + name + "' no destino." };
  const r = await run(parent, ["clone", url, name], { timeout: 300000 });
  if (!r.ok) return { ok: false, error: (r.stderr || "falha no clone").slice(0, 400) };
  return { ok: true, folder: dest, name };
}

// Verifica se git está disponível no sistema
async function checkGitAvailable() {
  const gitBin = await findGit();
  const r = await run(process.cwd(), ["--version"]);
  return { ok: r.ok, version: r.stdout.trim(), path: gitBin };
}

module.exports = { isRepo, init, status, diff, log, branches, commit, push, pull, clone, checkGitAvailable };

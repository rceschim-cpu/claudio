#!/usr/bin/env node

const readline = require("readline");
const fetch = require("node-fetch");

const SERVER_URL = "http://localhost:3344";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let conversationId = null;
let conversation = [];
let projectId = null;
let autoApply = false;

console.log("\n=============================================");
console.log("🤖 Cowork LLM - Modo CLI de Código Direto");
console.log("=============================================\n");

async function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function selectProject() {
  let data;
  try {
    const res = await fetch(`${SERVER_URL}/api/projects`);
    data = await res.json();
  } catch (err) {
    console.log("Servidor offline ou inacessível. Inicie o servidor antes (npm start).\n");
    process.exit(1);
  }
  if (data.projects && data.projects.length > 0) {
    console.log("Pastas de projetos disponíveis:");
    data.projects.forEach((p, idx) => {
      console.log(`[${idx + 1}] ${p.name} (${p.folder})`);
    });
    console.log("[0] Continuar sem conectar pasta (Chat apenas)");

    const choice = await askQuestion("\nEscolha uma opção: ");
    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < data.projects.length) {
      projectId = data.projects[idx].id;
      console.log(`Conectado ao projeto: ${data.projects[idx].name}\n`);
    }
  }
}

async function loop() {
  await selectProject();
  
  if (projectId) {
    const ans = await askQuestion("Deseja ativar auto-aplicar alterações de arquivos/comandos? (s/n): ");
    autoApply = ans.toLowerCase().trim() === "s";
    console.log(`Auto-aplicar: ${autoApply ? "ATIVADO" : "DESATIVADO"}\n`);
  }

  console.log("Fale com o cowork (digite 'sair' para encerrar):\n");
  
  while (true) {
    const text = await askQuestion("Você > ");
    if (text.toLowerCase().trim() === "sair") {
      console.log("\nEncerrando CLI. Até mais!");
      rl.close();
      break;
    }
    
    if (!text.trim()) continue;
    
    conversation.push({ role: "user", content: text });
    console.log("\nPensando...\n");
    
    try {
      const res = await fetch(`${SERVER_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          messages: conversation,
          mode: "auto",
          projectId,
          autoApply
        })
      });
      
      const r = await res.json();
      if (!r.ok) {
        console.log(`❌ Erro do servidor: ${r.error}\n`);
        conversation.pop();
        continue;
      }
      
      if (r.conversationId) conversationId = r.conversationId;
      
      conversation.push({ role: "assistant", content: r.text });
      
      console.log("---------------------------------------------");
      console.log(`🤖 Cowork [${r.usedProviderLabel || r.usedProvider} · ${r.usedName}]:`);
      console.log(r.text);
      console.log("---------------------------------------------\n");
      
      if (r.pendingActions && r.pendingActions.length > 0) {
        console.log(`⚠️  Existem ${r.pendingActions.length} ações pendentes aguardando aprovação:\n`);
        
        for (const action of r.pendingActions) {
          if (action.type === "write") {
            console.log(`📄 GRAVAR ARQUIVO: ${action.path}`);
            console.log("--- DIFF ---");
            action.diff.forEach(line => {
              console.log(`${line.t} ${line.line}`);
            });
            console.log("------------");
            
            const approve = await askQuestion(`Deseja aplicar esta escrita em ${action.path}? (s/n): `);
            if (approve.toLowerCase().trim() === "s") {
              const applyRes = await fetch(`${SERVER_URL}/api/projects/${projectId}/apply`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: action.path, content: action.newContent })
              });
              const applyData = await applyRes.json();
              if (applyData.ok) {
                console.log("✓ Escrita aplicada!\n");
              } else {
                console.log(`✕ Falha ao aplicar escrita: ${applyData.error}\n`);
              }
            } else {
              console.log("Ação recusada.\n");
            }
          } else if (action.type === "command") {
            console.log(`💻 EXECUTAR COMANDO: ${action.command}`);
            const approve = await askQuestion(`Deseja rodar este comando? (s/n): `);
            if (approve.toLowerCase().trim() === "s") {
              const execRes = await fetch(`${SERVER_URL}/api/projects/${projectId}/exec`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command: action.command })
              });
              const execData = await execRes.json();
              console.log(`STDOUT:\n${execData.stdout}`);
              if (execData.stderr) {
                console.log(`STDERR:\n${execData.stderr}`);
              }
              console.log(`✓ Executado com código: ${execData.code}\n`);
            } else {
              console.log("Ação recusada.\n");
            }
          }
        }
      }
      
    } catch (err) {
      console.log(`❌ Erro de rede/conexão: ${err.message}\n`);
      conversation.pop();
    }
  }
}

loop();

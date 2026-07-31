// lib/roi.js
// Consolidação de HORAS ECONOMIZADAS pelos agentes.
// Fonte: data/agent-runs.jsonl (cada execução de agente registra minutos
// economizados, vindos do mapeamento de atividade / job description).
// Produz visões por usuário, departamento, VP e empresa (geral).

const agents = require("./agents");

const DIMS = {
  user: (r) => r.owner?.user || r.owner?.email || "(sem dono)",
  department: (r) => r.owner?.department || "(sem departamento)",
  vp: (r) => r.owner?.vp || "(sem VP)",
  company: (r) => r.owner?.company || "(empresa)",
  agent: (r) => r.agentName || r.agentId,
  task: (r) => r.task || "(sem atividade)",
};

function groupBy(runs, dim) {
  const keyOf = DIMS[dim] || DIMS.user;
  const map = new Map();
  for (const r of runs) {
    const k = keyOf(r);
    const cur = map.get(k) || { key: k, runs: 0, minutes: 0 };
    cur.runs += 1;
    cur.minutes += Number(r.minutesSaved) || 0;
    map.set(k, cur);
  }
  return [...map.values()]
    .map((x) => ({ ...x, hours: +(x.minutes / 60).toFixed(1) }))
    .sort((a, b) => b.minutes - a.minutes);
}

// Série mensal (YYYY-MM) para gráfico de evolução.
function timeline(runs) {
  const map = new Map();
  for (const r of runs) {
    const m = String(r.at || "").slice(0, 7);
    if (!m) continue;
    const cur = map.get(m) || { month: m, runs: 0, minutes: 0 };
    cur.runs += 1;
    cur.minutes += Number(r.minutesSaved) || 0;
    map.set(m, cur);
  }
  return [...map.values()]
    .map((x) => ({ ...x, hours: +(x.minutes / 60).toFixed(1) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// Painel completo. hourlyRate (opcional) converte horas em R$ — só é
// calculado se você informar a taxa; nada é inventado.
function summary({ since = null, hourlyRate = null } = {}) {
  const runs = agents.runs({ since });
  const all = agents.list();

  const totalMinutes = runs.reduce((s, r) => s + (Number(r.minutesSaved) || 0), 0);
  const potentialMonthly = all.reduce((s, a) => s + agents.monthlyPotentialMinutes(a), 0);

  const out = {
    generatedAt: new Date().toISOString(),
    since,
    totals: {
      agents: all.length,
      runs: runs.length,
      minutes: totalMinutes,
      hours: +(totalMinutes / 60).toFixed(1),
      potentialMonthlyHours: +(potentialMonthly / 60).toFixed(1),
    },
    byUser: groupBy(runs, "user"),
    byDepartment: groupBy(runs, "department"),
    byVp: groupBy(runs, "vp"),
    byCompany: groupBy(runs, "company"),
    byAgent: groupBy(runs, "agent"),
    byTask: groupBy(runs, "task"),
    timeline: timeline(runs),
  };

  if (hourlyRate && Number(hourlyRate) > 0) {
    const rate = Number(hourlyRate);
    out.totals.value = +(out.totals.hours * rate).toFixed(2);
    out.totals.hourlyRate = rate;
    for (const dim of ["byUser", "byDepartment", "byVp", "byCompany", "byAgent", "byTask"]) {
      out[dim] = out[dim].map((x) => ({ ...x, value: +(x.hours * rate).toFixed(2) }));
    }
  }
  return out;
}

module.exports = { summary, groupBy, timeline, DIMS };
